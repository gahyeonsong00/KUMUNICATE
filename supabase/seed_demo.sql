-- =====================================================================
-- 시연용 민원 데이터 (마이그레이션 아님. 필요할 때 SQL Editor에서 직접 실행)
--
-- 먼저 할 일: README '1. 처음 설정'대로 데모 직원 계정(demo.staff@example.com)을 만든다
-- 실행하면
--   - 데모 직원 계정을 관리팀(FACILITY_REPAIR) 일반 staff '이서윤'으로 지정
--   - 가짜 민원인 8명, 같은 부서 동료 2명(seed.*@example.com, 로그인 불가)을 만든다
--   - 접수 경로별 민원 8건(채팅·챗봇 이관·접수서·꾸미기·재문의·처리 완료)을 넣는다
-- 다시 실행하면 seed.* 계정과 그 민원을 지우고 새로 만든다 (실제 사용자 데이터는 건드리지 않음)
-- =====================================================================

do $$
declare
  demo uuid;
  u uuid[];
  yuna uuid;
  junseo uuid;
  c uuid;
begin
  select id into demo from public.profiles where email = 'demo.staff@example.com';
  if demo is null then
    raise exception '데모 직원 계정(demo.staff@example.com)을 먼저 만들어 주세요';
  end if;
  update public.profiles set role = 'staff', department = 'FACILITY_REPAIR', display_name = '이서윤' where id = demo;

  -- 지난번 시드 지우기 (민원·채팅·이력은 cascade로 같이 지워진다)
  delete from auth.users where email like 'seed.%@example.com';
  insert into public.allowed_emails (email, note)
  select 'seed.' || x || '@example.com', '시연용 가짜 계정(로그인 불가)'
  from unnest(array['r1','r2','r3','r4','r5','r6','r7','r8','staff1','staff2']) x
  on conflict do nothing;

  -- 민원인 8명
  with ins as (
    insert into auth.users (id, email, raw_user_meta_data)
    select gen_random_uuid(), 'seed.r' || i || '@example.com', jsonb_build_object('full_name', n)
    from unnest(array['박지호','김도현','정하린','한서준','오세린','윤재민','서민우','강민재']) with ordinality t(n, i)
    returning id, email
  )
  select array_agg(id order by email) into u from ins;
  update public.profiles p set user_type = 'undergrad', college_code = v.college, major = v.major
  from (values
    (1, 'software', '컴퓨터공학부'), (2, 'engineering', '기계공학과'), (3, 'art_design', '시각디자인학과'),
    (4, 'international', '국제학과'), (5, 'physical_education', '스포츠지도학과'), (6, 'physical_education', '골프산업학과'),
    (7, 'life_science', '식품생명공학과'), (8, 'engineering', '건축공학과')
  ) v(i, college, major)
  where p.id = u[v.i];

  -- 같은 부서 동료 2명
  insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'seed.staff1@example.com', '{"full_name":"최유나"}') returning id into yuna;
  insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'seed.staff2@example.com', '{"full_name":"박준서"}') returning id into junseo;
  update public.profiles set role = 'staff', department = 'FACILITY_REPAIR', user_type = 'staff' where id in (yuna, junseo);

  -- 1. 접수서, 배정 대기
  insert into public.complaints (requester_id, content, building_id, channel, department, ai_confidence, ai_summary, created_at)
  values (u[1], '광장 분수대 옆 가로등 두 개가 어젯밤부터 꺼져 있어서 밤에 많이 어두워요.', 'plaza', 'form',
          'FACILITY_REPAIR', 0.88, '사색의 광장 분수대 주변 가로등 2개 소등. 야간 보행 안전 관련으로 빠른 점검 필요.',
          now() - interval '3 hours');

  -- 2. 챗봇 대화 후 접수, 이서윤 처리 중 (채팅 중)
  insert into public.complaints (requester_id, content, building_id, channel, chatbot_log, department, ai_confidence, ai_summary,
                                 status, assignee_id, assigned_at, read_at, created_at)
  values (u[2], '도서관 정문에서 나와 오른쪽 두 번째 벤치가 부서져 있어요. 앉으면 위험해 보입니다.', 'central_library', 'chat',
          '[{"who":"bot","text":"안녕하세요. 어떤 점이 불편하신가요?"},
            {"who":"user","text":"도서관 정문에서 나와 오른쪽 두 번째 벤치가 부서져 있어요."},
            {"who":"bot","text":"확인했습니다. 시설 관련 민원으로 접수할게요."}]',
          'FACILITY_REPAIR', 0.92, '중앙도서관 정문 오른쪽 두 번째 벤치 파손. 이용자 안전 위험 있음. 현장 확인 후 보수 또는 사용 제한 필요.',
          'in_progress', demo, now() - interval '2 hours', now() - interval '2 hours', now() - interval '3 days 1 hour')
  returning id into c;
  insert into public.messages (complaint_id, sender_id, body, created_at) values
    (c, demo, '안녕하세요. 도서관 정문 기준 어느 쪽 벤치인지 알려주시겠어요?', now() - interval '100 minutes'),
    (c, u[2], '정문에서 나와 오른쪽 두 번째 벤치예요.', now() - interval '90 minutes'),
    (c, demo, '확인했습니다. 오늘 현장 확인 후 사용 제한 표시를 하겠습니다.', now() - interval '80 minutes');

  -- 3. 꾸미기, 배정 대기 (전후 이미지는 민원인 화면에서 올린 파일이 photo_paths에 들어간다)
  insert into public.complaints (requester_id, content, building_id, channel, department, ai_confidence, ai_summary, created_at)
  values (u[3], '연못 주변에 앉아서 쉴 곳이 없어서 꾸미기로 벤치와 화단을 만들어 봤어요.', 'pond', 'decorate',
          'FACILITY_REPAIR', 0.9, '연못 주변 벤치·화단 설치 요청. 민원인이 꾸미기로 만든 개선안 이미지 첨부.',
          now() - interval '2 days 4 hours');

  -- 4. 챗봇 이관, 미분류 대기열
  insert into public.complaints (requester_id, content, channel, chatbot_log, department, ai_confidence, ai_summary, created_at)
  values (u[4], '성적장학금 받으려면 직전 학기 몇 학점 이상 들어야 하는지 궁금해요.', 'chatbot_handoff',
          '[{"who":"bot","text":"안녕하세요. 어떤 점이 궁금하신가요?"},
            {"who":"user","text":"성적장학금 받으려면 직전 학기 몇 학점 이상 들어야 하나요?"},
            {"who":"bot","text":"정확한 기준을 찾지 못했어요. 담당자에게 연결해 드릴게요."}]',
          'UNASSIGNED', 0.41, '성적장학금 최소 이수 학점 기준 문의. 챗봇이 답과 담당 부서를 찾지 못해 이관됨. 장학 담당 소관으로 보임.',
          now() - interval '5 days');

  -- 5. 접수서, 동료 최유나 처리 중 (지연)
  insert into public.complaints (requester_id, content, building_id, channel, department, ai_confidence, ai_summary,
                                 status, assignee_id, assigned_at, read_at, created_at)
  values (u[5], '비가 오고 나면 트랙 바깥쪽 3레인 근처에 물이 이틀 넘게 고여 있어요.', 'sports_complex', 'form',
          'FACILITY_REPAIR', 0.84, '종합운동장 트랙 바깥쪽 배수 불량. 우천 후 물 고임 지속.',
          'in_progress', yuna, now() - interval '1 hour', now() - interval '1 hour', now() - interval '4 days');

  -- 6. 접수서, 처리 완료 후 재문의 → 이서윤 처리 중
  insert into public.complaints (requester_id, content, building_id, channel, department, ai_confidence, ai_summary,
                                 status, assignee_id, assigned_at, read_at, reopened_at, created_at)
  values (u[6], '2층 화장실 핸드드라이어가 작동하지 않아요.', 'physical_education', 'form',
          'FACILITY_REPAIR', 0.95, '체육대학관 2층 화장실 핸드드라이어 고장. 전원 조치 후 해결 완료했으나 민원인이 재문의함.',
          'in_progress', demo, now() - interval '30 minutes', now() - interval '7 days', now() - interval '30 minutes', now() - interval '8 days')
  returning id into c;
  insert into public.messages (complaint_id, sender_id, body, kind, created_at) values
    (c, demo, '2층 화장실 핸드드라이어 전원을 점검해 다시 작동하도록 조치했습니다.', 'letter', now() - interval '2 days'),
    (c, u[6], '켜지긴 하는데 바람이 너무 약해서 손이 안 말라요. 교체가 필요해 보여요.', 'chat', now() - interval '30 minutes');

  -- 7·8. 오늘 처리 완료 (이서윤 1건, 박준서 1건)
  insert into public.complaints (requester_id, content, building_id, channel, department, ai_confidence, ai_summary,
                                 status, assignee_id, assigned_at, read_at, resolved_at, created_at)
  values
    (u[7], '학생회관 2층에서 3층 올라가는 계단 조명이 계속 깜빡여요.', 'student_center', 'form',
     'FACILITY_REPAIR', 0.93, '학생회관 2~3층 계단 조명 깜빡임.',
     'resolved', demo, now() - interval '1 day', now() - interval '1 day', now() - interval '1 hour', now() - interval '14 days'),
    (u[8], '비 오는 날 공학관 2층 복도 천장에서 물이 떨어집니다.', 'engineering', 'form',
     'FACILITY_REPAIR', 0.91, '공학관 2층 복도 천장 누수. 우천 시 발생.',
     'resolved', junseo, now() - interval '1 day', now() - interval '1 day', now() - interval '2 hours', now() - interval '2 days');
  insert into public.messages (complaint_id, sender_id, body, kind, created_at)
  select id, assignee_id, '조명 안정기를 교체했습니다. 같은 문제가 다시 생기면 재문의해 주세요.', 'letter', resolved_at
  from public.complaints where requester_id = u[7];
end $$;
