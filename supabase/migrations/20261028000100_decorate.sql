-- 꾸미기 모드 (승원). 설계: docs/decorate-mode-ai.md
-- "내 지도" = 원본 지도 + 내가 저장한 꾸미기 조각들. 원본은 절대 안 바뀌고, 다른 사람 꾸미기는 안 보인다.
-- 좌표는 모두 지도 픽셀 좌표 = 완성 지도 assets/map_final.png (6028×4176) 기준.
--
-- 기록 추가는 Edge Function(decorate)만. 사용자는 내 기록 읽기 + 아래 함수로 저장·삭제·초기화·전달 표시만.

create table public.decorate_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  session_id      uuid not null,                 -- 꾸미기 창 하나 (수정하기는 같은 세션으로 이어짐)
  map_id          text not null default 'final', -- 어느 원본 지도 위에서 만들었는지. 지도가 바뀌면 예전 것은 내 지도에 안 겹침
  map_x           integer not null,              -- 핀을 꽂은 자리
  map_y           integer not null,
  crop_x          integer,                       -- 잘라낸 영역 왼쪽 위·크기 (지도 위에 겹칠 자리)
  crop_y          integer,
  crop_size       integer,
  place_id        integer,                       -- buildings.map_no. 가까운 장소가 없으면 null
  building_id     text references public.buildings (id),
  place_name      text not null,
  message         text not null,                 -- 사용자 원문
  claude_json     jsonb,                         -- Claude 판단 결과 전체
  request_type    text check (request_type in ('edit', 'question', 'not_visual', 'reject')),
  final_prompt    text,                          -- 이미지 AI에 보낸 프롬프트
  result_path     text,                          -- Storage decorate-results 경로. 있으면 "이미지 생성이 일어난 요청"
  before_path     text,                          -- 꾸미기 전 조각
  status          text not null default 'draft' check (status in ('draft', 'saved', 'proposed')),
  saved_at        timestamptz,                   -- 저장한 시각 = 내 지도에 쌓는 순서
  hidden_at       timestamptz,                   -- 삭제·초기화한 시각 (기록은 남김)
  complaint_id    uuid references public.complaints (id), -- "의견 전달하기"로 접수한 민원
  error           text,
  claude_model    text,
  image_model     text,
  credits_charged numeric,
  elapsed_ms      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.decorate_requests is '꾸미기 요청 기록 (decorate Edge Function이 씀). 하루 제한·내 지도·히스토리의 원본';

create index decorate_requests_user_day on public.decorate_requests (user_id, created_at);
create index decorate_requests_my_map on public.decorate_requests (user_id, saved_at)
  where saved_at is not null and hidden_at is null;

create function public.decorate_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger decorate_requests_updated before update on public.decorate_requests
  for each row execute function public.decorate_touch_updated_at();

alter table public.decorate_requests enable row level security;
create policy "내 꾸미기 읽기" on public.decorate_requests
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.decorate_requests from anon, authenticated;
grant select on public.decorate_requests to authenticated;

-- 저장: 결과가 있는 내 요청만. 같은 창에서 먼저 저장한 것은 숨김 (수정을 여러 번 했으면 마지막 것 하나만)
create function public.decorate_save(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.decorate_requests;
begin
  select * into r from public.decorate_requests where id = request_id and user_id = auth.uid() for update;
  if r.id is null or r.result_path is null then raise exception '저장할 수 없는 꾸미기예요'; end if;
  if r.hidden_at is not null then raise exception '이미 지운 꾸미기예요'; end if;
  update public.decorate_requests set hidden_at = now()
    where user_id = auth.uid() and session_id = r.session_id and id <> r.id
      and saved_at is not null and hidden_at is null;
  update public.decorate_requests
    set status = case when status = 'draft' then 'saved' else status end, saved_at = coalesce(saved_at, now())
    where id = r.id;
end $$;

-- 삭제: 내 지도에서 가장 최근에 저장한 것만 (새 꾸미기는 이전 꾸미기가 얹힌 지도에서 그리기 때문)
create function public.decorate_delete_latest(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare latest uuid;
begin
  select id into latest from public.decorate_requests
    where user_id = auth.uid() and saved_at is not null and hidden_at is null
    order by saved_at desc limit 1;
  if latest is null or latest <> request_id then raise exception '최근 꾸미기부터 지울 수 있어요'; end if;
  update public.decorate_requests set hidden_at = now() where id = request_id;
end $$;

-- 초기화: 내 지도 전체를 원본으로 (학교에 전달한 민원은 그대로)
create function public.decorate_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.decorate_requests set hidden_at = now()
    where user_id = auth.uid() and saved_at is not null and hidden_at is null;
end $$;

-- 의견 전달하기로 접수한 민원을 꾸미기 기록에 잇는다 (내 민원, 내 꾸미기만)
create function public.decorate_mark_sent(request_id uuid, sent_complaint_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.complaints c where c.id = sent_complaint_id and c.requester_id = auth.uid()) then
    raise exception '내 민원이 아니에요';
  end if;
  update public.decorate_requests set status = 'proposed', complaint_id = sent_complaint_id
    where id = request_id and user_id = auth.uid() and result_path is not null;
end $$;

revoke execute on function public.decorate_save(uuid), public.decorate_delete_latest(uuid),
  public.decorate_reset(), public.decorate_mark_sent(uuid, uuid) from public, anon;
grant execute on function public.decorate_save(uuid), public.decorate_delete_latest(uuid),
  public.decorate_reset(), public.decorate_mark_sent(uuid, uuid) to authenticated;

-- Storage
--  decorate-maps    : 서버가 잘라낼 원본 지도 조각 (비공개, 서버만 읽음). supabase/decorate-map/final/*.png 를 올린다
--  decorate-results : 꾸미기 전·후 그림 (공개 읽기, 경로는 추측 불가능한 uuid)
insert into storage.buckets (id, name, public) values
  ('decorate-maps', 'decorate-maps', false),
  ('decorate-results', 'decorate-results', true)
on conflict (id) do nothing;

-- 완성 지도(assets/map_final.png) 기준 건물 좌표 (지도 픽셀). 지도 담당(승원)이 이름표 위치를 맞춘 값
update public.buildings b set x = v.x, y = v.y from (values
  ('main_gate', 4578, 565),
  ('aejiwon', 5614, 905),
  ('renaissance_park', 4182, 584),
  ('woojungwon', 3617, 320),
  ('turf_field', 4257, 942),
  ('engineering', 4483, 1263),
  ('reactor_center', 4935, 1338),
  ('engineering_lab', 5161, 1462),
  ('physical_education', 3391, 1300),
  ('foreign_languages', 3315, 565),
  ('kyunghee_park', 3127, 226),
  ('multimedia', 2656, 302),
  ('dorm2', 1658, 433),
  ('main_stadium', 2468, 735),
  ('ceramics', 3636, 1677),
  ('greenhouse', 3334, 1753),
  ('seonseung', 2355, 1338),
  ('life_science', 2844, 1734),
  ('herbal_processing', 3994, 2299),
  ('research_lab', 2976, 3524),
  ('art_design', 2976, 2525),
  ('international_business', 2129, 1771),
  ('student_center', 1752, 1300),
  ('central_library', 904, 1300),
  ('plaza', 1507, 1960),
  ('bus_terminal', 2261, 2977),
  ('sports_complex', 1658, 3618),
  ('baseball_field', 904, 3731),
  ('peace_theater', 414, 2977),
  ('pond', 885, 2996),
  ('electronics', 1451, 2751),
  ('international_studies', 867, 2016),
  ('observatory', 283, 2318)
) as v(id, x, y) where b.id = v.id;
comment on column public.buildings.x is '완성 지도(assets/map_final.png, 6028×4176) 기준 픽셀 x';
comment on column public.buildings.y is '완성 지도 기준 픽셀 y';
