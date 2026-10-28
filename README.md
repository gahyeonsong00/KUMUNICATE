# 경희대 키우기

> 지도에서 위치를 찍어 민원을 내고, 바라는 캠퍼스의 모습을 AI로 그려 건의하는 경희대 국제캠퍼스 민원·제안 웹앱

**2026 KHU AI Challenge · AI 문제해결 솔루션 부문 · 팀 KHUminicate**

- 시연 영상: https://youtu.be/dxv8yzxhY9I
- 심사·시연용 계정: 제출 서류(프로젝트 소개서)에 따로 적었습니다. 비밀번호는 저장소에 올리지 않습니다.

![경희대 키우기](assets/map_final.png)

---

## 왜 만들었나

캠퍼스에서 고장 난 시설을 발견해도 학생은 먼저 어느 부서 소관인지 알아내고 전화번호를 찾아야 합니다. 전화가 연결되어도 장소와 상황을 말로 설명해야 하고, 담당자는 그 설명만으로 현장을 짐작해야 합니다. 접수한 뒤에는 처리 상황을 확인할 방법도 없습니다.

경희대 키우기는 이 과정을 세 가지로 바꿉니다.

1. **위치로 말하는 민원**: 국제캠퍼스를 본뜬 픽셀 지도에서 자리를 찍고 사진을 붙여 접수합니다.
2. **부서를 몰라도 되는 접수**: AI가 민원을 읽고 교내 24개 부서 중 담당 부서를 골라 전달합니다.
3. **그림으로 하는 건의**: 꾸미기 모드에서 고른 자리를 AI가 바뀐 모습으로 그려 지도 위에 겹쳐 보여 줍니다.

## 주요 기능

### 민원인 화면 (모바일)

| 기능 | 설명 |
|---|---|
| 로그인 | 학교 구글 계정(@khu.ac.kr)만 가입 가능. 서버에서 도메인을 막습니다 |
| 지도 민원 접수 | 지도 어디든 누르면 + 핀이 생기고 가장 가까운 장소가 자동 입력됩니다. 사진(최대 3장)과 내용을 적어 접수 |
| 챗봇 접수 | 챗봇 '쿠밍이'와 대화하면 민원 글을 정리해 줍니다. 장학 규정 등 일부 질문은 바로 답하고, 개별 확인이 필요하면 민원 접수로 연결 |
| 나의 활동 | 접수 완료 → 해결 중 → 해결 완료 상태와 담당 부서 확인. 담당자가 확인하기 전까지는 내용 수정 가능 |
| 성장 게이지 | 해결 완료 민원 1건마다 한 칸, 10칸이 차면 레벨 업 |
| 꾸미기 | 지도에서 고른 자리를 원하는 모습으로 AI가 다시 그림. 꾸미기 전·후 비교, 저장, 히스토리, '의견 전달하기'로 학교에 건의. 1인 하루 5회 |

### 직원 화면 (데스크톱, `/admin`)

| 기능 | 설명 |
|---|---|
| 내 민원 | 담당 중·처리 완료 민원, 대기·지연·당일 완료 현황 |
| 다음 민원 받기 | 부서로 들어온 민원을 오래된 순서로 한 건씩 배정 |
| 민원 처리 | 원문, 위치, 사진, 챗봇 대화 기록, AI 요약·분류 결과 확인. 민원인과 채팅하거나 답변서를 보내고 처리 완료 |
| 다른 부서로 넘기기 | 잘못 분류된 민원을 이유와 함께 다른 부서로 이관 |
| 부서 현황 | 직원별 처리 실적과 민원별 담당자·경과 시간 |

## AI 활용

모든 AI 호출은 **ChatKHU API Gateway**를 거칩니다. API 키는 Supabase 서버 비밀값에만 두고 코드와 화면에는 넣지 않습니다.

| 기능 | 모델 | 코드 |
|---|---|---|
| 민원 부서 분류 | Claude Haiku 5.5 | `supabase/functions/classify-complaint/` |
| 민원 접수 챗봇 '쿠밍이' | Claude Haiku 5.5 | `supabase/functions/complaint-chat/` |
| 꾸미기 요청 판단·프롬프트 작성 | Claude Haiku 5.5 | `supabase/functions/decorate/` |
| 꾸미기 이미지 편집 | Nano Banana 2 | `supabase/functions/decorate/` |

### 민원 분류

- 국제캠퍼스 전화번호부의 부서 166개를 학생 민원이 실제로 가는 기준으로 **24개 라벨**로 묶었습니다 (`data/labels/dept_mapping.csv` → `departments.csv`).
- 헷갈리는 민원은 **우선순위 규칙**(인권·건강 → 위험 여부 → 공간의 운영 주체 → 수업·학사 구분)으로 판단하고, 판단이 어려우면 억지로 고르지 않고 `UNASSIGNED`로 남겨 직원이 직접 배정합니다.
- AI가 없는 부서·단과대 코드를 내면 서버에서 버리고 미분류로 돌립니다.
- 평가 샘플 46건(`data/labels/eval_samples.csv`)으로 측정했습니다.

| 버전 | 바뀐 점 | 정확도 |
|---|---|---|
| v0 | 부서 설명만 제공 | 44/46 |
| v1 | 우선순위 규칙 추가 | 46/46 |

v1 규칙은 같은 샘플을 보고 만들었기 때문에, 처음 보는 민원으로 다시 재야 실제 성능을 알 수 있습니다.

### 꾸미기

선택한 지점 주변만 잘라 이미지를 편집하고 원래 자리에 겹쳐 보여 줍니다. 원본 지도는 바뀌지 않습니다. Claude가 요청을 먼저 판단해(`edit` / `question` / `not_visual` / `reject`) 부적절하거나 그림으로 표현할 수 없는 요청은 그리지 않습니다. 설계와 프롬프트 버전 기록은 `docs/decorate-mode-ai.md`, `docs/decorate-prompt-test-log.md`에 있습니다.

## 기술 스택

- **프론트엔드**: React 19, TypeScript, Vite, React Router, Carbon(직원 화면)
- **백엔드**: Supabase (Auth, Postgres + RLS, Storage, Edge Functions)
- **AI**: ChatKHU API Gateway (Claude Haiku 5.5, Nano Banana 2)

## 폴더 구성

```
src/
  citizen/      민원인 화면 (지도, 접수, 챗봇, 나의 활동, 꾸미기)
  admin/        직원 화면 (내 민원, 민원 처리, 부서 현황)
  lib/          Supabase 클라이언트
supabase/
  migrations/   테이블, 권한(RLS), 배정 대기열, 꾸미기 저장
  functions/    분류 · 챗봇 · 꾸미기 Edge Function
  tests/        권한 규칙 자동 점검
  decorate-map/ 꾸미기용 고화질 지도 조각
data/labels/    부서 라벨표, 전화번호부 대응표, 평가 샘플
design/         화면 설계 파일
docs/           개요, 결정 기록, 꾸미기 설계, 프롬프트 기록
assets/         지도, 마스코트, 글꼴
```

## 직접 실행하기

```bash
npm install
cp .env.example .env   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력
npm run dev            # http://localhost:5173
```

서버 설정(마이그레이션, Edge Function 배포, 서버 비밀값 등록, 데모 계정 만들기)은 [`supabase/README.md`](supabase/README.md)에 정리했습니다.

권한 규칙 점검:

```bash
cd supabase/tests && npm install && npm test
```

## 문서

- [`docs/overview.md`](docs/overview.md): 기능, 우선순위, 시연 시나리오
- [`docs/decisions.md`](docs/decisions.md): 로그인, 권한, 분류, 배정 규칙에 대한 결정 기록
- [`docs/decorate-mode-ai.md`](docs/decorate-mode-ai.md): 꾸미기 AI 설계
- [`docs/prompts/`](docs/prompts/): 개발에 쓴 주요 프롬프트

## 팀 KHUminicate

| 이름 | 역할 |
|---|---|
| 김보민 (팀장) | 민원인 앱 개발, 민원 분류 AI, 민원 접수 챗봇 |
| 송가현 | Supabase 서버, 직원 화면, 사진 저장, 디자인 |
| 차승원 | 픽셀 캠퍼스 지도, 꾸미기 생성형 AI |

## 출처와 라이선스

| 자료 | 출처 | 이용 조건 |
|---|---|---|
| 부서·학과 정보 | 경희대학교 홈페이지, 국제캠퍼스 전화번호부 | 공개 정보를 팀이 정리 |
| 마스코트 쿠옹이·쿠밍이, 학교 로고 | 경희대학교 | 대회 출품 목적으로만 사용 |
| Galmuri11 글꼴 | quiple(이민서) | SIL Open Font License 1.1 (`assets/fonts/OFL-Galmuri.md`) |
| 캠퍼스 지도 이미지 | 팀 제작 (ChatKHU Nano Banana Pro로 생성) | 학교 건물 사진을 위치·외관 참고용으로만 사용 |
| React, Vite, Supabase JS 등 | 각 오픈소스 프로젝트 | 각 라이선스 (MIT, Apache 2.0 등) |

이 저장소는 2026 KHU AI Challenge 출품용으로 공개합니다.
