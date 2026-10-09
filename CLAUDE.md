# 경희대 키우기 (KHUminicate)

경희대 국제캠퍼스 민원·제안 웹앱. 2026 KHU AI Challenge 출품작. 팀 3인, 완성 목표 10/15.

## 먼저 읽을 것
- `docs/overview.md` — 기능, 우선순위, 디자인 방향, 시연 시나리오
- `docs/decisions.md` — 사용자·권한·분류 관련 결정사항과 분류 함수 입출력
- `data/labels/` — 민원 분류 라벨표와 평가 샘플
- `design/` — Claude Design에서 내보낸 화면 7개(`.dc.html`)와 디자인 토큰. 읽는 법은 `design/README.md`
- `assets/` — 지도, 마스코트, 픽셀 폰트(갈무리11). `design/` 파일이 `../assets/`로 참조한다

## 스택
- 프론트엔드: React 웹앱 하나. 로그인 역할에 따라 민원인 화면(모바일 390px)과 직원 화면(`/admin`, 데스크톱 1440px)을 나눈다
- 백엔드: Supabase (Auth, Postgres, Storage, Edge Functions)
- 분류 AI: ChatKHU (대회 필수). 분류 로직은 다른 팀원 담당

## 작업 범위 (이 저장소 담당자)
1. Supabase 서버: 테이블, RLS, Storage, `classify-complaint` Edge Function 틀
2. 직원 화면 구현과 서버 연결

## 규칙
- 분류 로직은 직접 만들지 않는다. `classify-complaint`는 입출력 형식만 지키는 가짜 버전(항상 `UNASSIGNED`)으로 두고, 분류 담당이 안쪽을 채운다
- 분류 결과 칸(`department`, `target_college`, `ai_confidence`, `ai_summary`)은 비어 있어도 민원 접수가 되게 한다
- 라벨 코드는 `data/labels/departments.csv`의 `code`가 기준이다. 코드를 바꾸면 분류 담당에게 알린다
- 디자인 파일의 부서명(시설팀, 장학 담당 등)과 지도 장소 이름은 샘플이다. 부서는 `departments` 테이블, 장소는 `buildings` 테이블 값을 쓴다
- 민원 상태는 DB에 3단계(`received`/`in_progress`/`resolved`). 화면 표시와 배정 규칙은 `docs/decisions.md`의 '민원 배정과 상태'
- API 키·비밀값은 커밋하지 않는다 (`.env` 사용, 제출 서류에도 API 키 노출 금지)
- 대회 제출용으로 주요 프롬프트와 결정 과정을 기록해 둔다 (AI 활용 과정 설명서)

## Agent skills

### Issue tracker

이슈는 GitHub Issues(`gahyeonsong00/KUMUNICATE`)에서 `gh` CLI로 관리한다. See `docs/agents/issue-tracker.md`.

### Triage labels

기본 라벨 5개(needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix)를 그대로 쓴다. See `docs/agents/triage-labels.md`.

### Domain docs

single-context: 루트 `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
