-- =====================================================================
-- 민원(complaints)과 권한
--
-- 누가 무엇을 볼 수 있나 (RLS)
--   민원인 : 자기 민원만
--   staff  : 자기 부서 민원 + 자기 민원
--            행정실(COLLEGE_OFFICE·GRAD_OFFICE) staff는 target_college가 담당 단과대인 것만
--   admin  : 전체 (부서가 비었거나 UNASSIGNED인 미분류 민원도 admin이 배정)
--
-- 누가 무엇을 고칠 수 있나 (guard_complaint 트리거가 강제)
--   민원인       : 담당자가 읽기 전(read_at이 비어 있을 때)만 본문·건물·첨부 수정
--   담당 staff/admin : 상태, 부서(재배정), target_college
--   서버(Edge Function) : 분류 결과 칸(ai_*, department, target_college)
--   삭제는 아무도 못 한다
-- =====================================================================

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content text not null check (octet_length(content) between 1 and 500),
  building_id text references public.buildings (id),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3),
  doc_paths text[] not null default '{}' check (cardinality(doc_paths) <= 2),
  status text not null default 'received' check (status in ('received', 'in_progress', 'resolved')),
  department text references public.departments (code),
  target_college text references public.colleges (code),
  ai_confidence real check (ai_confidence between 0 and 1),
  ai_summary text,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.complaints is '민원. 분류 결과 칸(department, target_college, ai_*)은 비어 있어도 접수된다';
comment on column public.complaints.content is '민원 본문. 최대 500byte(한글 약 166자)';
comment on column public.complaints.building_id is '지도에서 고른 건물. 채팅 접수 등 장소가 없으면 null';
comment on column public.complaints.photo_paths is 'Storage complaint-files 버킷의 사진 경로, 최대 3개. 경로는 반드시 "{본인 user id}/"로 시작';
comment on column public.complaints.doc_paths is 'Storage complaint-files 버킷의 문서(pdf·hwp·hwpx·docx) 경로, 최대 2개';
comment on column public.complaints.status is 'received = 접수 완료, in_progress = 해결 중, resolved = 해결 완료';
comment on column public.complaints.department is '담당 부서. null = 아직 분류 안 됨, UNASSIGNED = AI가 판단 못함(admin이 배정)';
comment on column public.complaints.target_college is 'COLLEGE_OFFICE·GRAD_OFFICE일 때 보낼 단과대. 비면 민원인 소속으로 자동 채움';
comment on column public.complaints.ai_confidence is 'AI 분류 신뢰도 0~1. null이면서 department가 있으면 직원이 직접 고른 부서';
comment on column public.complaints.ai_summary is 'AI 한 줄 요약';
comment on column public.complaints.read_at is '담당자가 처음 열어 본 시각. 이 값이 생기면 민원인은 더 이상 본문을 못 고친다(채팅으로 요청)';
comment on column public.complaints.resolved_at is '해결 완료 시각. status가 resolved가 되면 자동 기록';

create index on public.complaints (requester_id);
create index on public.complaints (department, target_college);

-- ---------------------------------------------------------------------
-- 지금 로그인한 사람이 이 부서(+단과대) 민원의 담당자인가?
-- 여러 정책·트리거가 같이 쓴다. profiles를 직접 읽으므로 security definer.
-- ---------------------------------------------------------------------
create function public.can_handle_complaint(dept text, target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'staff' and p.department = dept
            and (dept not in ('COLLEGE_OFFICE', 'GRAD_OFFICE') or p.staff_college_code = target))
      )
  )
$$;
comment on function public.can_handle_complaint is '로그인한 사람이 해당 부서(행정실이면 단과대까지) 민원의 담당자이거나 admin이면 true';

-- profiles 정책 안에서 profiles를 다시 읽으면 무한 반복이 나서 security definer 함수로 뺀다
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- ---------------------------------------------------------------------
-- 수정·등록 규칙 트리거
-- ---------------------------------------------------------------------
create function public.guard_complaint() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();  -- null이면 서버(Edge Function의 service_role)
  my_role text;
begin
  select role into my_role from public.profiles where id = uid;

  if tg_op = 'INSERT' then
    -- 접수는 항상 '접수 완료' 상태로 시작, 서버 전용 칸은 비운다
    new.status := 'received';
    new.read_at := null;
    new.resolved_at := null;
    new.ai_confidence := null;
    new.ai_summary := null;
    -- 일반 사용자는 부서를 고를 수 없다(AI가 채움). staff/admin은 직접 골라도 된다
    if uid is not null and coalesce(my_role, 'user') = 'user' then
      new.department := null;
      new.target_college := null;
    end if;
  elsif uid is not null then
    if (new.requester_id, new.created_at, new.ai_confidence, new.ai_summary)
       is distinct from (old.requester_id, old.created_at, old.ai_confidence, old.ai_summary) then
      raise exception '바꿀 수 없는 칸이에요';
    end if;
    if (new.content, new.building_id, new.photo_paths, new.doc_paths)
       is distinct from (old.content, old.building_id, old.photo_paths, old.doc_paths)
       and not (old.requester_id = uid and old.read_at is null) then
      raise exception '담당자가 이미 확인한 민원은 수정할 수 없어요. 채팅으로 요청해 주세요';
    end if;
    if (new.status, new.department, new.target_college)
       is distinct from (old.status, old.department, old.target_college)
       and not public.can_handle_complaint(old.department, old.target_college) then
      raise exception '담당자만 상태와 부서를 바꿀 수 있어요';
    end if;
    if new.read_at is distinct from old.read_at
       and not (old.read_at is null and public.can_handle_complaint(old.department, old.target_college)) then
      raise exception '읽음 표시는 mark_complaint_read로만 바꿀 수 있어요';
    end if;
  end if;

  -- 첨부 경로는 민원인 본인 폴더의 파일이어야 한다 (남의 파일을 끌어와 열람하는 것 방지)
  if exists (select 1 from unnest(new.photo_paths || new.doc_paths) p
             where p not like new.requester_id::text || '/%') then
    raise exception '첨부 파일 경로는 "{본인 user id}/"로 시작해야 해요';
  end if;

  -- 행정실이 아니면 target_college는 비우고, 행정실인데 비었으면 민원인 소속으로 채운다
  if new.department is null or new.department not in ('COLLEGE_OFFICE', 'GRAD_OFFICE') then
    new.target_college := null;
  elsif new.target_college is null then
    select college_code into new.target_college from public.profiles where id = new.requester_id;
  end if;

  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_complaint
  before insert or update on public.complaints
  for each row execute function public.guard_complaint();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.complaints enable row level security;

create policy "자기 민원 또는 담당 민원 조회" on public.complaints for select to authenticated
  using (requester_id = auth.uid() or public.can_handle_complaint(department, target_college));

create policy "본인 이름으로 접수" on public.complaints for insert to authenticated
  with check (requester_id = auth.uid());

-- 어떤 칸을 바꿀 수 있는지는 guard_complaint 트리거가 판단한다.
-- 주의: Postgres는 수정된 행도 조회 정책을 통과해야 해서, staff가 남의 부서로 넘기는 직접 update는 막힌다.
--       재배정은 아래 reassign_complaint 함수로 한다.
create policy "자기 민원 또는 담당 민원 수정" on public.complaints for update to authenticated
  using (requester_id = auth.uid() or public.can_handle_complaint(department, target_college))
  with check (true);

-- profiles 조회: 본인, admin, 그리고 담당자는 자기가 볼 수 있는 민원의 민원인 프로필
create policy "본인·담당 민원인 프로필 조회" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (select 1 from public.complaints c where c.requester_id = profiles.id
               and public.can_handle_complaint(c.department, c.target_college))
    or public.is_admin()
  );

-- ---------------------------------------------------------------------
-- 담당자가 민원 상세를 처음 열 때 부르는 함수
-- 앱: await supabase.rpc('mark_complaint_read', { complaint_id: id })
-- ---------------------------------------------------------------------
create function public.mark_complaint_read(complaint_id uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.complaints set read_at = now()
  where id = complaint_id and read_at is null
    and public.can_handle_complaint(department, target_college)
$$;
comment on function public.mark_complaint_read is '담당자가 민원을 처음 열람했음을 기록. 이후 민원인은 본문 수정 불가';

-- ---------------------------------------------------------------------
-- 담당자가 민원을 다른 부서로 넘길 때 부르는 함수 (넘긴 뒤에는 원래 담당자에게 안 보인다)
-- 앱: await supabase.rpc('reassign_complaint', { complaint_id: id, new_department: 'IT' })
--     행정실이면 new_target_college: 'software' 도 넘긴다(비우면 민원인 소속으로 채워짐)
-- ---------------------------------------------------------------------
create function public.reassign_complaint(complaint_id uuid, new_department text, new_target_college text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.complaints c where c.id = complaint_id
                 and public.can_handle_complaint(c.department, c.target_college)) then
    raise exception '담당자만 재배정할 수 있어요';
  end if;
  update public.complaints set department = new_department, target_college = new_target_college
  where id = complaint_id;
end $$;
comment on function public.reassign_complaint is '담당 staff·admin이 민원을 다른 부서(행정실이면 단과대까지)로 넘긴다';

-- 상태 변경을 앱에서 실시간으로 받는다(해결 완료 알림 등)
alter publication supabase_realtime add table public.complaints;
