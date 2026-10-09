-- =====================================================================
-- 민원 배정 대기열과 담당자 권한 (docs/decisions.md '민원 배정과 상태', 2026-10-10)
--
-- 바뀌는 것
--   - 민원마다 담당자(assignee_id)가 생긴다. 직원은 목록에서 고르지 않고
--     claim_next_complaint()로 가장 오래 기다린 민원 1건을 받는다
--   - 민원 내용은 민원인과 담당자만 본다. 같은 부서 직원은 department_board()로
--     읽기 전용 요약만 보고, 배정 전 민원은 요약도 비공개
--   - 상태는 직원이 직접 바꾸지 않는다. 받기·해제·넘기기·처리 완료·재문의 함수가 바꾼다
--   - admin은 운영 계정. 민원 업무 권한이 없다
--   - 넘기기·해제·자동 되돌리기 이력은 complaint_events에 남는다
--
-- 앱이 부르는 함수
--   claim_next_complaint()                         다음 민원 받기 → 받은 민원 id (없으면 null)
--   release_complaint(complaint_id)                담당 해제
--   reassign_complaint(complaint_id, new_department, reason, note, new_target_college)  다른 부서로 넘기기
--   resolve_complaint(complaint_id, letter)        처리 완료 (letter가 있으면 답변서로 저장)
--   reopen_complaint(complaint_id, body)           민원인 재문의 (처리 완료 후 7일 안)
--   department_board()                             부서 현황 (읽기 전용 요약)
--   queue_status()                                 대기 건수와 가장 오래 기다린 시각
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. complaints 칸 추가
-- ---------------------------------------------------------------------
alter table public.complaints
  add column seq bigint generated always as identity,
  add column no text,
  add column channel text not null default 'form'
    check (channel in ('chat', 'chatbot_handoff', 'form', 'decorate')),
  add column chatbot_log jsonb not null default '[]'::jsonb,
  add column assignee_id uuid references public.profiles (id) on delete set null,
  add column assigned_at timestamptz,
  add column reopened_at timestamptz;

update public.complaints
set no = to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MMDD') || '-' || lpad(seq::text, 3, '0');
alter table public.complaints alter column no set not null, add constraint complaints_no_key unique (no);

comment on column public.complaints.no is '접수번호. 접수일(한국 시간)-일련번호, 예: 2026-1010-004. 일련번호는 날짜와 상관없이 계속 오른다';
comment on column public.complaints.channel is 'chat = 챗봇 대화 후 접수, chatbot_handoff = 챗봇 이관, form = 접수서 직접 작성, decorate = 꾸미기(전후 이미지는 photo_paths)';
comment on column public.complaints.chatbot_log is '접수 전 AI 챗봇 대화 기록. [{"who":"bot"|"user","text":"..."}]. 접수할 때만 넣는다';
comment on column public.complaints.assignee_id is '담당 직원. null = 배정 대기. claim_next_complaint로만 정해진다';
comment on column public.complaints.assigned_at is '담당자가 받은(또는 재문의로 다시 열린) 시각. 자동 되돌리기 계산 기준';
comment on column public.complaints.reopened_at is '민원인이 마지막으로 재문의한 시각. 있으면 화면에 재문의 표시';
comment on column public.complaints.status is 'received = 배정 대기(담당자 없음), in_progress = 처리 중, resolved = 처리 완료. 함수가 자동으로 바꾼다';
comment on column public.complaints.department is '담당 부서. null = 아직 분류 안 됨, UNASSIGNED = 미분류 대기열';
comment on column public.complaints.read_at is '담당자가 처음 받은 시각. 이 값이 생기면 민원인은 본문을 못 고친다(채팅으로 요청)';

create index on public.complaints (assignee_id);
create index complaints_queue_idx on public.complaints (department, created_at) where assignee_id is null and status = 'received';

-- ---------------------------------------------------------------------
-- 2. 채팅과 답변서
-- ---------------------------------------------------------------------
alter table public.messages
  add column kind text not null default 'chat' check (kind in ('chat', 'letter'));
comment on column public.messages.kind is 'chat = 채팅, letter = 공식 답변서(resolve_complaint로만 생김)';

-- ---------------------------------------------------------------------
-- 3. 이력: 받기·해제·자동 되돌리기·넘기기·처리 완료·재문의
-- ---------------------------------------------------------------------
create table public.complaint_events (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  kind text not null check (kind in ('claimed', 'released', 'auto_released', 'transferred', 'resolved', 'reopened')),
  actor_id uuid references public.profiles (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  from_department text references public.departments (code),
  to_department text references public.departments (code),
  reason text check (reason in ('not_our_work', 'other_dept_facility', 'academic_scholarship', 'other')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint transfer_needs_reason check ((kind = 'transferred') = (reason is not null)),
  constraint other_needs_note check (reason is distinct from 'other' or nullif(btrim(note), '') is not null)
);
comment on table public.complaint_events is '민원 배정 이력. 함수만 쓴다. 넘기는 이유는 받는 담당자와 분류 담당(대시보드)만 본다';
comment on column public.complaint_events.actor_id is '한 사람. null = 자동 되돌리기';
comment on column public.complaint_events.assignee_id is '그때의 담당자(해제·넘기기·자동 되돌리기면 풀려난 사람)';
comment on column public.complaint_events.reason is 'not_our_work = 우리 부서 업무가 아님, other_dept_facility = 다른 부서가 관리하는 시설, academic_scholarship = 학사·장학 관련 문의, other = 기타(note 필수)';

create index on public.complaint_events (complaint_id, created_at);
alter table public.complaint_events enable row level security;

-- 지금 담당자는 그 민원의 이력을, 풀려난 사람은 자기 관련 이력(자동 되돌리기 알림)을 본다. 민원인은 못 본다
create policy "담당자와 풀려난 사람만 이력 조회" on public.complaint_events for select to authenticated
  using (
    assignee_id = auth.uid()
    or exists (select 1 from public.complaints c where c.id = complaint_id and c.assignee_id = auth.uid())
  );

alter publication supabase_realtime add table public.complaint_events;

-- ---------------------------------------------------------------------
-- 4. 권한: 부서 직원 판별(admin 제외), 민원은 민원인과 담당자만
-- ---------------------------------------------------------------------
create or replace function public.can_handle_complaint(dept text, target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'staff' and p.department = dept
      and (dept not in ('COLLEGE_OFFICE', 'GRAD_OFFICE') or p.staff_college_code = target)
  )
$$;
comment on function public.can_handle_complaint is '로그인한 사람이 해당 부서(행정실이면 단과대까지) 소속 staff면 true. 대기열·부서 현황 판별용';

drop policy "자기 민원 또는 담당 민원 조회" on public.complaints;
drop policy "자기 민원 또는 담당 민원 수정" on public.complaints;
create policy "자기 민원 또는 내가 맡은 민원 조회" on public.complaints for select to authenticated
  using (requester_id = auth.uid() or assignee_id = auth.uid());
create policy "자기 민원 수정" on public.complaints for update to authenticated
  using (requester_id = auth.uid()) with check (requester_id = auth.uid());

-- 앱에서 직접 고칠 수 있는 칸은 민원인 본문·첨부뿐. 상태·부서·담당자는 아래 함수로만
revoke update on public.complaints from anon, authenticated;
grant update (content, building_id, photo_paths, doc_paths) on public.complaints to authenticated;

drop policy "본인·담당 민원인 프로필 조회" on public.profiles;
create policy "본인·내 담당 민원의 민원인 프로필 조회" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (select 1 from public.complaints c where c.requester_id = profiles.id and c.assignee_id = auth.uid())
    or public.is_admin()
  );

-- 채팅: 민원인과 담당자, 처리 완료 전까지. 답변서(letter)는 resolve_complaint로만
drop policy "볼 수 있는 민원에 본인 이름으로 전송" on public.messages;
create policy "민원인·담당자가 채팅 전송" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid() and kind = 'chat'
    and exists (select 1 from public.complaints c where c.id = complaint_id and c.status <> 'resolved')
  );

drop policy "담당자만 메모 조회" on public.complaint_notes;
drop policy "담당자만 메모 작성" on public.complaint_notes;
create policy "담당자만 메모 조회" on public.complaint_notes for select to authenticated
  using (exists (select 1 from public.complaints c where c.id = complaint_id and c.assignee_id = auth.uid()));
create policy "담당자만 메모 작성" on public.complaint_notes for insert to authenticated
  with check (author_id = auth.uid()
              and exists (select 1 from public.complaints c where c.id = complaint_id and c.assignee_id = auth.uid()));

drop function public.mark_complaint_read(uuid);       -- 받는 순간 read_at이 찍힌다
drop function public.reassign_complaint(uuid, text, text);  -- 넘기는 이유가 필수라 아래에서 새로 만든다

-- ---------------------------------------------------------------------
-- 5. 수정 규칙 트리거 (칸별 권한은 위 grant가 막고, 여기서는 값 규칙만)
-- ---------------------------------------------------------------------
create or replace function public.guard_complaint() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();  -- null이면 서버(Edge Function·대시보드 SQL)
  my_role text;
begin
  if tg_op = 'INSERT' then
    if uid is not null then
      -- 앱에서 접수: 서버가 정하는 칸은 비우고, 대기 순서를 앞당기지 못하게 접수 시각도 서버가 정한다
      select role into my_role from public.profiles where id = uid;
      new.status := 'received';
      new.created_at := now();
      new.assignee_id := null;
      new.assigned_at := null;
      new.reopened_at := null;
      new.read_at := null;
      new.resolved_at := null;
      new.ai_confidence := null;
      new.ai_summary := null;
      -- 부서는 staff만 직접 고른다(AI 분류 생략). 일반 사용자는 AI가 채운다
      if coalesce(my_role, 'user') <> 'staff' then
        new.department := null;
        new.target_college := null;
      end if;
    end if;
    new.no := to_char(new.created_at at time zone 'Asia/Seoul', 'YYYY-MMDD') || '-' || lpad(new.seq::text, 3, '0');
  elsif uid is not null
        and (new.content, new.building_id, new.photo_paths, new.doc_paths)
            is distinct from (old.content, old.building_id, old.photo_paths, old.doc_paths)
        and not (old.requester_id = uid and old.read_at is null) then
    raise exception '담당자가 이미 받은 민원은 수정할 수 없어요. 채팅으로 요청해 주세요';
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

  if new.status = 'resolved' then
    if tg_op = 'INSERT' then new.resolved_at := coalesce(new.resolved_at, now());
    elsif old.status <> 'resolved' then new.resolved_at := now();
    end if;
  else
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. 다음 민원 받기
-- 앱: const { data: id } = await supabase.rpc('claim_next_complaint')  // null이면 대기 0건
-- ---------------------------------------------------------------------
create function public.claim_next_complaint() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  cid uuid;
  old_dept text;
begin
  select * into me from public.profiles where id = uid and role = 'staff';
  if not found then raise exception '부서 직원만 민원을 받을 수 있어요'; end if;

  -- 내 부서 대기 → 없으면 미분류 대기. 처음 접수 시각 순.
  -- skip locked: 여러 명이 동시에 눌러도 같은 민원을 두 번 주지 않고 다음 민원을 준다
  select c.id, c.department into cid, old_dept from public.complaints c
  where c.assignee_id is null and c.status = 'received' and c.requester_id <> uid
    and public.can_handle_complaint(c.department, c.target_college)
  order by c.created_at limit 1
  for update skip locked;

  if cid is null then
    select c.id, c.department into cid, old_dept from public.complaints c
    where c.assignee_id is null and c.status = 'received' and c.requester_id <> uid
      and (c.department is null or c.department = 'UNASSIGNED')
    order by c.created_at limit 1
    for update skip locked;
  end if;
  if cid is null then return null; end if;

  -- 미분류에서 받은 민원은 내 부서 민원이 된다. 맞지 않으면 담당자가 다른 부서로 넘긴다
  update public.complaints set
    assignee_id = uid, assigned_at = now(), status = 'in_progress',
    read_at = coalesce(read_at, now()),
    department = me.department,
    target_college = case when me.department in ('COLLEGE_OFFICE', 'GRAD_OFFICE') then me.staff_college_code end
  where id = cid;

  insert into public.complaint_events (complaint_id, kind, actor_id, assignee_id, from_department, to_department)
  values (cid, 'claimed', uid, uid, old_dept, me.department);
  return cid;
end $$;
comment on function public.claim_next_complaint is '내 부서(없으면 미분류)에서 가장 오래 기다린 민원 1건을 나에게 배정하고 id를 돌려준다';

-- ---------------------------------------------------------------------
-- 7. 담당 해제
-- 앱: await supabase.rpc('release_complaint', { complaint_id: id })
-- ---------------------------------------------------------------------
create function public.release_complaint(complaint_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  dept text;
begin
  update public.complaints c set assignee_id = null, assigned_at = null, status = 'received'
  where c.id = release_complaint.complaint_id and c.assignee_id = uid and c.status = 'in_progress'
  returning c.department into dept;
  if not found then raise exception '내가 처리 중인 민원만 담당 해제할 수 있어요'; end if;

  insert into public.complaint_events (complaint_id, kind, actor_id, assignee_id, from_department)
  values (release_complaint.complaint_id, 'released', uid, uid, dept);
end $$;
comment on function public.release_complaint is '담당자가 민원을 내려놓는다. 처음 접수 시각 순서대로 대기열에 돌아간다';

-- ---------------------------------------------------------------------
-- 8. 다른 부서로 넘기기
-- 앱: await supabase.rpc('reassign_complaint', {
--       complaint_id: id, new_department: 'SCHOLARSHIP', reason: 'academic_scholarship', note: null })
--     행정실이면 new_target_college: 'software' 도 (비우면 민원인 소속)
-- ---------------------------------------------------------------------
create function public.reassign_complaint(
  complaint_id uuid, new_department text, reason text, note text default null, new_target_college text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  old_dept text;
  clean_note text := nullif(btrim(reassign_complaint.note), '');
begin
  select c.department into old_dept from public.complaints c
  where c.id = reassign_complaint.complaint_id and c.assignee_id = uid and c.status = 'in_progress'
  for update;
  if not found then raise exception '내가 처리 중인 민원만 다른 부서로 넘길 수 있어요'; end if;

  if reassign_complaint.reason is null
     or reassign_complaint.reason not in ('not_our_work', 'other_dept_facility', 'academic_scholarship', 'other') then
    raise exception '넘기는 이유를 골라 주세요';
  end if;
  if reassign_complaint.reason = 'other' and clean_note is null then
    raise exception '기타를 고르면 덧붙일 말을 적어 주세요';
  end if;
  if new_department = old_dept and new_department not in ('COLLEGE_OFFICE', 'GRAD_OFFICE') then
    raise exception '지금 부서와 다른 부서를 골라 주세요';
  end if;

  update public.complaints set
    department = new_department, target_college = new_target_college,
    assignee_id = null, assigned_at = null, status = 'received'
  where id = reassign_complaint.complaint_id;

  insert into public.complaint_events (complaint_id, kind, actor_id, assignee_id, from_department, to_department, reason, note)
  values (reassign_complaint.complaint_id, 'transferred', uid, uid, old_dept, new_department, reassign_complaint.reason, clean_note);
end $$;
comment on function public.reassign_complaint is '담당자가 민원을 다른 부서 대기열로 넘긴다. 이유 필수(기타는 덧붙일 말도 필수)';

-- ---------------------------------------------------------------------
-- 9. 처리 완료 (채팅 종료 또는 답변서 전송)
-- 앱: 채팅 종료  await supabase.rpc('resolve_complaint', { complaint_id: id })
--     답변서     await supabase.rpc('resolve_complaint', { complaint_id: id, letter: text })
-- ---------------------------------------------------------------------
create function public.resolve_complaint(complaint_id uuid, letter text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  dept text;
begin
  select c.department into dept from public.complaints c
  where c.id = resolve_complaint.complaint_id and c.assignee_id = uid and c.status = 'in_progress'
  for update;
  if not found then raise exception '내가 처리 중인 민원만 처리 완료할 수 있어요'; end if;

  if nullif(btrim(letter), '') is not null then
    insert into public.messages (complaint_id, sender_id, body, kind)
    values (resolve_complaint.complaint_id, uid, btrim(letter), 'letter');
  end if;
  update public.complaints set status = 'resolved' where id = resolve_complaint.complaint_id;
  insert into public.complaint_events (complaint_id, kind, actor_id, assignee_id, from_department)
  values (resolve_complaint.complaint_id, 'resolved', uid, uid, dept);
end $$;
comment on function public.resolve_complaint is '담당자가 처리 완료한다. letter가 있으면 공식 답변서로 남긴다';

-- ---------------------------------------------------------------------
-- 10. 재문의 (민원인, 처리 완료 후 7일 안)
-- 앱: await supabase.rpc('reopen_complaint', { complaint_id: id, body: '아직 바람이 약해요' })
-- ---------------------------------------------------------------------
create function public.reopen_complaint(complaint_id uuid, body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.complaints;
begin
  select * into c from public.complaints x
  where x.id = reopen_complaint.complaint_id and x.requester_id = uid and x.status = 'resolved'
  for update;
  if not found then raise exception '처리 완료된 내 민원만 다시 문의할 수 있어요'; end if;
  if c.resolved_at < now() - interval '7 days' then
    raise exception '처리 완료 후 7일이 지났어요. 새 민원으로 접수해 주세요';
  end if;

  -- 같은 담당자에게 다시 간다. 담당자가 없으면(계정 삭제 등) 부서 대기열로
  update public.complaints set
    status = case when c.assignee_id is null then 'received' else 'in_progress' end,
    reopened_at = now(), assigned_at = case when c.assignee_id is null then null else now() end
  where id = c.id;
  insert into public.messages (complaint_id, sender_id, body, kind) values (c.id, uid, reopen_complaint.body, 'chat');
  insert into public.complaint_events (complaint_id, kind, actor_id, assignee_id, from_department)
  values (c.id, 'reopened', uid, c.assignee_id, c.department);
end $$;
comment on function public.reopen_complaint is '민원인이 처리 완료 7일 안에 같은 민원을 다시 연다. 같은 담당자에게 간다';

-- ---------------------------------------------------------------------
-- 11. 자동 되돌리기: 받은 뒤 영업일 2일 동안 담당자 채팅·처리가 없으면 대기열로
-- ---------------------------------------------------------------------
create function public.add_business_days(t timestamptz, n int) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  d timestamptz := t;
  i int := 0;
begin
  -- 주말만 건너뛴다(공휴일은 계산 안 함, 한국 시간 기준)
  while i < n loop
    d := d + interval '1 day';
    if extract(isodow from d at time zone 'Asia/Seoul') < 6 then i := i + 1; end if;
  end loop;
  return d;
end $$;

create function public.auto_release_stale() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with stale as (
    select c.id, c.assignee_id, c.department from public.complaints c
    where c.status = 'in_progress' and c.assignee_id is not null
      and public.add_business_days(
            greatest(c.assigned_at, (select max(m.created_at) from public.messages m
                                     where m.complaint_id = c.id and m.sender_id = c.assignee_id)),
            2) <= now()
    for update skip locked
  ), ev as (
    insert into public.complaint_events (complaint_id, kind, assignee_id, from_department)
    select id, 'auto_released', assignee_id, department from stale
  )
  update public.complaints c set assignee_id = null, assigned_at = null, status = 'received'
  from stale where c.id = stale.id;
  get diagnostics n = row_count;
  return n;
end $$;
comment on function public.auto_release_stale is '오래 손대지 않은 담당 민원을 대기열로 돌린다. pg_cron이 30분마다 부른다. 이력의 assignee_id로 원래 담당자에게 알린다';

revoke execute on function public.auto_release_stale() from public, anon, authenticated;

-- Supabase에서는 pg_cron으로 30분마다 실행. pg_cron이 없는 곳(로컬 점검)에서는 건너뛴다
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('auto-release-stale', '*/30 * * * *', 'select public.auto_release_stale()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. 부서 현황(읽기 전용)과 대기 건수
-- 앱: const { data } = await supabase.rpc('department_board')
--     const { data: [q] } = await supabase.rpc('queue_status')
-- ---------------------------------------------------------------------
create function public.department_board()
returns table (
  id uuid, no text, created_at timestamptz, summary text,
  assignee_id uuid, assignee_name text, status text, resolved_at timestamptz, reopened_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  -- 배정 전 민원은 요약도 비공개: 받을 사람만 내용을 본다
  select c.id, c.no, c.created_at,
         case when c.assignee_id is null then null else c.ai_summary end,
         c.assignee_id, p.display_name, c.status, c.resolved_at, c.reopened_at
  from public.complaints c
  left join public.profiles p on p.id = c.assignee_id
  where public.can_handle_complaint(c.department, c.target_college)
  order by c.created_at
$$;
comment on function public.department_board is '내 부서 민원 요약(번호·접수 시각·요약·담당자·상태). 배정 전 민원은 요약 null';

create function public.queue_status() returns table (mine int, unassigned int, oldest timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    (count(*) filter (where public.can_handle_complaint(c.department, c.target_college)))::int,
    (count(*) filter (where c.department is null or c.department = 'UNASSIGNED'))::int,
    min(c.created_at)
  from public.complaints c
  where c.assignee_id is null and c.status = 'received' and c.requester_id <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff')
    and (public.can_handle_complaint(c.department, c.target_college)
         or c.department is null or c.department = 'UNASSIGNED')
$$;
comment on function public.queue_status is '다음 민원 받기 옆에 보여줄 대기 건수(내 부서, 미분류)와 가장 오래 기다린 접수 시각';

revoke execute on function
  public.claim_next_complaint(), public.release_complaint(uuid),
  public.reassign_complaint(uuid, text, text, text, text), public.resolve_complaint(uuid, text),
  public.reopen_complaint(uuid, text), public.department_board(), public.queue_status()
from anon;
