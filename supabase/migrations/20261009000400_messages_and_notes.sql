-- =====================================================================
-- 민원별 채팅(messages)과 직원 내부 메모(complaint_notes)
--
-- messages        : 민원인 ↔ 담당자 채팅. 그 민원을 볼 수 있는 사람이면 읽고 쓸 수 있다.
--                   담당자가 확인한 뒤 민원인이 내용을 고치고 싶으면 여기로 요청한다.
-- complaint_notes : 직원끼리만 보는 처리 메모. 민원인에게는 안 보인다.
-- 둘 다 수정·삭제는 없다(기록 보존).
-- =====================================================================

create table public.messages (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
comment on table public.messages is '민원별 채팅. 보낸 사람이 민원인(complaints.requester_id)이면 민원인 말풍선, 아니면 담당자 말풍선';

create index on public.messages (complaint_id, created_at);

alter table public.messages enable row level security;

-- complaints의 RLS가 그대로 적용되므로 "그 민원을 볼 수 있는 사람"만 통과한다
create policy "볼 수 있는 민원의 채팅 조회" on public.messages for select to authenticated
  using (exists (select 1 from public.complaints c where c.id = complaint_id));

create policy "볼 수 있는 민원에 본인 이름으로 전송" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and exists (select 1 from public.complaints c where c.id = complaint_id));

alter publication supabase_realtime add table public.messages;


create table public.complaint_notes (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
comment on table public.complaint_notes is '직원 내부 처리 메모. 담당 staff·admin만 보고 쓴다';

alter table public.complaint_notes enable row level security;

create policy "담당자만 메모 조회" on public.complaint_notes for select to authenticated
  using (exists (select 1 from public.complaints c where c.id = complaint_id
                 and public.can_handle_complaint(c.department, c.target_college)));

create policy "담당자만 메모 작성" on public.complaint_notes for insert to authenticated
  with check (author_id = auth.uid()
              and exists (select 1 from public.complaints c where c.id = complaint_id
                          and public.can_handle_complaint(c.department, c.target_college)));
