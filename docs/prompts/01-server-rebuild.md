# 서버 재현 프롬프트 (세션 1 결과물)

> 용도: 학교 제공 도구(Claude Code 등)에서 같은 서버를 다시 만들 때 그대로 붙여넣는다.
> 원본 세션: 2026-10-09, Claude Code(Opus 5.5)와 grill 방식 질의응답으로 설계 → 구현 → 검증.
> "같다"의 기준: 아래 [완료 조건]의 점검 스크립트가 `ALL CHECKS PASSED`를 출력하면 원본과 같은 동작.
>
> 준비: 새 폴더에 `CLAUDE.md`, `docs/`, `data/labels/`, `supabase/tests/`(점검 스크립트)만 두고 시작한다.
> `supabase/migrations/`, `supabase/functions/`, `supabase/README.md`는 지운 상태여야 재현이 된다.

---

## 붙여넣을 프롬프트

```
경희대 키우기 웹앱의 Supabase 백엔드를 만들어줘. 설계는 이미 끝났으니 질문하지 말고 아래 명세대로 구현해.
먼저 CLAUDE.md, docs/decisions.md, data/labels/departments.csv, data/labels/dept_mapping.csv를 읽어.

[구조]
- supabase/migrations/ 에 기능별 SQL 파일 6개:
  100_reference_tables, 200_profiles, 300_complaints, 400_messages_and_notes, 500_storage, 600_seed_reference_data
  (파일명 앞은 20261009000100 형식 타임스탬프)
- supabase/functions/classify-complaint/ 에 index.ts(DB 연결)와 classify.ts(분류 로직, 가짜 버전)
- supabase/README.md: 프론트 담당 초보자용 연동 가이드(한국어, 기능별 supabase-js 복붙 코드)
- 모든 파일 맨 위에 "이 파일이 하는 일" 한국어 주석, 모든 테이블·칸에 comment on

[테이블]
- colleges(code PK, name unique, kind 'college'|'grad'): dept_mapping.csv의 '소속 라우팅' 단과대·대학원 17개.
  code: engineering, electronics, software, applied_science, life_science, international, foreign_languages,
  art_design, physical_education, free_major, grad_general, grad_education, grad_international,
  grad_east_west, grad_sports, grad_techno, grad_art_fusion
- departments(code PK, name, org, phone, email, duties): departments.csv 24행 그대로
- buildings(id slug PK, name, map_no, college_codes text[] default '{}', x int, y int):
  경희대 공식 국제캠퍼스맵 33곳 전부. x,y는 null(지도 담당이 채움).
  전자정보/응용과학대학관은 {electronics,software,applied_science}처럼 여러 단과대 가능. 공학관 id는 engineering
- allowed_emails(email PK, note): @khu.ac.kr 외 가입 허용(데모 계정). 정책 없음(앱 접근 불가)
- 기준 테이블 3개는 authenticated 누구나 select
- profiles(id→auth.users, email, display_name, role 'user'|'staff'|'admin' default user,
  user_type 'undergrad'|'grad'|'staff' null 허용, college_code→colleges, major text,
  department→departments, staff_college_code→colleges, created_at)
  check: staff면 department 필수, department가 COLLEGE_OFFICE·GRAD_OFFICE면 staff_college_code 필수
  update 권한은 display_name,user_type,college_code,major 칸만 authenticated에 grant, 본인 행만
- complaints(id uuid, requester_id default auth.uid(), content 1~500 byte, building_id null 허용,
  photo_paths text[] ≤3, doc_paths text[] ≤2, status 'received'|'in_progress'|'resolved' default received,
  department, target_college, ai_confidence 0~1, ai_summary, read_at, resolved_at, created_at, updated_at)
- messages(id identity, complaint_id, sender_id default auth.uid(), body 1~1000자, created_at)
- complaint_notes(id identity, complaint_id, author_id default auth.uid(), body 1~2000자, created_at) — 직원 내부 메모
- complaints, messages는 supabase_realtime publication에 추가

[가입 규칙]
- auth.users before insert or update of email 트리거: email이 null이거나 @khu.ac.kr(대소문자 무시)이 아니고
  allowed_emails에도 없으면 '경희대학교(@khu.ac.kr) 계정으로만 가입할 수 있어요' 예외
- after insert 트리거: profiles 행 자동 생성(display_name은 raw_user_meta_data의 full_name 또는 name)

[권한]
- security definer 함수 can_handle_complaint(dept, target): admin이면 true,
  staff이고 department=dept이고 (dept가 행정실이 아니거나 staff_college_code=target)이면 true
- security definer 함수 is_admin() (profiles 정책 안에서 자기 참조 무한 반복 방지용)
- complaints select/update: requester_id=auth.uid() or can_handle_complaint(department, target_college)
  insert: requester_id=auth.uid(). delete 정책 없음(아무도 삭제 불가)
- profiles select: 본인, admin, 또는 내가 담당하는 민원의 민원인
- messages: 그 민원을 볼 수 있으면(complaints RLS에 기대는 exists) 읽기·쓰기, sender_id=auth.uid()
- complaint_notes: can_handle_complaint인 사람만 읽기·쓰기. 수정·삭제 없음

[guard_complaint 트리거 (before insert or update, security definer)]
- auth.uid()가 null이면 서버(Edge Function service_role)로 보고 칸 제한 없음
- insert: status=received, read_at·resolved_at·ai_confidence·ai_summary=null 강제.
  role이 user면 department·target_college도 null(일반 사용자는 부서 못 고름, staff/admin은 직접 지정 가능)
- update(사용자): requester_id, created_at, ai_confidence, ai_summary 변경 금지
  content·building_id·photo_paths·doc_paths는 민원인 본인이고 read_at이 null일 때만
  ('담당자가 이미 확인한 민원은 수정할 수 없어요. 채팅으로 요청해 주세요')
  status·department·target_college는 can_handle_complaint(old)일 때만 ('담당자만 상태와 부서를 바꿀 수 있어요')
  read_at은 null→값 변경을 담당자만 ('읽음 표시는 mark_complaint_read로만 바꿀 수 있어요')
- 첨부 경로는 모두 '{requester_id}/'로 시작해야 함 ('첨부 파일 경로는 "{본인 user id}/"로 시작해야 해요')
- department가 행정실이 아니면 target_college=null, 행정실인데 null이면 민원인 profiles.college_code로 채움
- status가 resolved로 바뀌면 resolved_at=now(), resolved가 아니면 null. updated_at=now()

[RPC]
- mark_complaint_read(complaint_id): security invoker, read_at이 null이고 담당자면 now()
- reassign_complaint(complaint_id, new_department, new_target_college default null): security definer,
  can_handle_complaint(현재값)가 아니면 '담당자만 재배정할 수 있어요'.
  (Postgres는 수정된 행도 select 정책을 다시 확인하므로 staff가 남의 부서로 넘기는 직접 update는 막힌다. 그래서 RPC)

[Storage]
- 비공개 버킷 complaint-files, 파일당 10MB, mime: jpeg/png/webp/heic/heif, pdf,
  x-hwp/haansofthwp/vnd.hancom.hwp/vnd.hancom.hwpx/hwp+zip, docx. 동영상 없음
- insert·delete: 첫 폴더가 auth.uid()인 경로만. select: 본인 폴더 또는 내가 볼 수 있는 민원의 photo_paths·doc_paths에 있는 파일

[Edge Function classify-complaint]
- 입력 {complaint_id}. 호출자 토큰(anon key + Authorization 헤더)으로 민원 조회 → 없으면 404
- department가 있고 ai_confidence가 null(직원이 직접 고름)이면 skip, read_at이 있으면 skip(재배정 덮어쓰기 방지)
- service role로 민원인 profiles 읽어 decisions.md 입력 JSON 생성
  (requester.type=user_type, college=college_code, department=major)
- classify.ts의 classify(input) 호출 → department, target_college, ai_confidence, ai_summary(빈 문자열은 null) 저장
- 실패하면 500 + '분류에 실패했어요. 민원은 접수됐고 담당자가 직접 배정합니다.' (민원은 이미 저장된 상태)
- classify.ts: ClassifyInput/ClassifyOutput 타입과 항상
  {department:'UNASSIGNED', target_college:null, confidence:0, summary:''}를 돌려주는 가짜 classify().
  분류 담당용 주석: target_college는 colleges code, API 키는 Deno.env.get('CHATKHU_API_KEY')

[완료 조건]
- cd supabase/tests && npm install && npm test 가 ALL CHECKS PASSED를 출력할 때까지 고친다.
  점검 스크립트는 고치지 않는다.
- API 키·비밀번호는 어떤 파일에도 쓰지 않는다. .gitignore에 .env, node_modules/, supabase/.temp/
```

---

## 원본과 비교하는 법 (설명서용 근거)

1. 학교 도구 결과물에서 `npm test` → `ALL CHECKS PASSED` 캡처
2. 원본 저장소(이 커밋)에서도 같은 명령 → 같은 결과 캡처
3. 두 결과를 나란히 첨부: "같은 명세·같은 테스트로 동작 동일성 확인"

## 이 프롬프트가 만들어진 과정 (AI 활용 과정 설명서용 요약)

- 외부 도구(Claude Code)를 쓴 이유: 서버 설계는 권한 규칙이 많아 질의응답과 자동 검증이 필요했음
- 진행: 요구사항 제시 → AI가 결정 안 된 것 19개를 3라운드로 질문 → 팀이 답변·수정 → 구현
  → 브라우저 없이 로컬 Postgres(PGlite)로 권한 시나리오 30여 개 자동 점검 → 실제 서버 배포 후 시연 흐름 7단계 재확인
- 검증으로 발견·수정한 문제: staff가 다른 부서로 재배정할 때 Postgres 권한 재확인 때문에 막힘 → 재배정 전용 함수로 해결
- 팀이 AI 제안을 바꾼 결정 예: 동영상 첨부 제외(비용), 담당자 확인 전까지만 민원 수정 허용(채팅 연계), 건물은 실제 캠퍼스맵 기준
