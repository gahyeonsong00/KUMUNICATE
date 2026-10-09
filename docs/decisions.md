# 결정사항 (2026-10-09 기준)

## 사용자와 로그인
- Google 로그인, `@khu.ac.kr` 계정만 허용. 국제캠퍼스 학부생·대학원생·교직원 모두 사용 가능 (팀 최종 확인 필요)
- 가입 시 받는 정보: 사용자 유형(학부생/대학원생/교직원), 소속(단과대·학과 또는 대학원, 교직원은 부서)
- 가입하면 모두 일반 사용자. `staff` 역할과 담당 부서는 **관리자가 지정** (Google 로그인만으로 학생/교직원 구분 불가)

## 교직원의 두 역할
- 계정은 하나. staff는 '민원 내기'와 '부서 민원함'을 전환해서 쓴다
- 교직원은 민원을 낼 때 부서를 직접 고를 수 있다 (AI 분류 생략)
- 자기 부서로 가는 민원도 막지 않는다

## 권한 (RLS)
- 민원인: 자기 민원만
- staff: 자기 부서 민원 + 자기 민원. 잘못 분류된 민원은 다른 부서로 재배정 가능
- admin: 전체

## 민원 분류
- 라벨은 `data/labels/departments.csv`의 `code` (24개). 서버의 `departments` 테이블 seed로 사용
- `COLLEGE_OFFICE`, `GRAD_OFFICE`는 실제 행정실을 정하기 위해 `target_college`가 필요하다
  - 기준은 민원인 소속이 아니라 **문의 대상 수업·학과를 맡은 단과대**. 알 수 없으면 민원인 소속
- `UNASSIGNED`는 직원이 직접 배정
- **분류 규칙(프롬프트, 단서 우선순위, 애매한 경우 처리)은 분류 담당 팀원이 정한다.** 서버는 입력을 넘기고 결과를 저장만 한다
- 분류는 ChatKHU 사용 (대회 필수 조건)

## 분류 함수 입출력 (초안, 분류 담당과 합의 필요)

입력:
```json
{
  "complaint_id": "uuid",
  "content": "공학관 3층 화장실 변기가 막혔어요",
  "building_id": "engineering",
  "requester": { "type": "undergrad", "college": "software", "department": "인공지능학과" }
}
```

출력:
```json
{
  "department": "FACILITY_REPAIR",
  "target_college": null,
  "confidence": 0.92,
  "summary": "공학관 3층 화장실 변기 막힘"
}
```
`target_college`는 `COLLEGE_OFFICE`·`GRAD_OFFICE`일 때만 값이 있고 나머지는 null.

**(10/09 변경) 단과대는 이름이 아니라 `colleges` 테이블 code로 주고받는다.** 입력 `requester.college`와 출력 `target_college` 모두 해당.
한글 이름을 돌려주면 저장에 실패한다. 행정실인데 `target_college`를 모르면 null로 두면 서버가 민원인 소속으로 채운다.
입력 `building_id`는 `buildings.id`, 채팅 접수면 null. 분류 담당은 `supabase/functions/classify-complaint/classify.ts`만 채운다.

| code | 이름 | code | 이름 |
|---|---|---|---|
| `engineering` | 공과대학 | `grad_general` | 일반대학원 |
| `electronics` | 전자정보대학 | `grad_education` | 교육대학원 |
| `software` | 소프트웨어융합대학 | `grad_international` | 국제대학원 |
| `applied_science` | 응용과학대학 | `grad_east_west` | 동서의학대학원 |
| `life_science` | 생명과학대학 | `grad_sports` | 체육대학원 |
| `international` | 국제대학 | `grad_techno` | 테크노경영대학원 |
| `foreign_languages` | 외국어대학 | `grad_art_fusion` | 아트퓨전디자인대학원 |
| `art_design` | 예술·디자인대학 | | |
| `physical_education` | 체육대학 | | |
| `free_major` | 자유전공학부 | | |

## 서버 설계 결정 (2026-10-09, Claude Code와 grill 방식으로 질의응답하며 정함)
- 스키마는 `supabase/migrations/`에 기능별 SQL 파일로 둔다. 프론트 사용법은 `supabase/README.md`
- 가입 제한: Google `hd` 옵션 + DB 트리거로 @khu.ac.kr 강제. 심사위원용 데모 계정은 `allowed_emails` 예외 + 이메일/비밀번호
- 역할 지정은 관리자 화면 없이 대시보드 SQL로. 행정실 staff는 담당 단과대(`staff_college_code`)도 지정하고, 그 단과대 민원만 본다
- 행정실 배정은 단과대 단위까지만 (학과 사무실 단위 X)
- 직원도 민원은 민원인 화면에서 낸다. staff만 부서를 직접 고를 수 있고, 고르면 AI 분류를 건너뜀
- 건물: 공식 국제캠퍼스맵 33곳. 건물 하나에 단과대 여러 개 가능(`college_codes`). 지도 좌표는 지도 담당이 채움
- 첨부: 사진 최대 3장 + 문서(pdf·hwp·hwpx·docx) 최대 2개, 파일당 10MB. 동영상은 비용 때문에 제외. 본문 500byte
- 분류 호출: 앱이 저장 후 `classify-complaint`에 `complaint_id`만 넘김. 실패해도 민원은 접수됨
- 수정: 민원인은 담당자가 열어 보기 전(`read_at` 없음)만 수정 가능, 이후는 채팅으로 요청. 삭제 없음
- 미분류(`UNASSIGNED`·분류 실패)는 admin이 배정. 시연용 직원 계정은 admin
- 상태는 DB에 `received`/`in_progress`/`resolved` 영문 코드로 저장
- 직원 내부 메모는 민원인이 못 보게 별도 테이블(`complaint_notes`)로 분리
- 재배정은 `reassign_complaint` 함수로만 (Postgres는 바뀐 행도 조회 권한을 다시 확인하기 때문에 직접 update로 남의 부서에 넘기면 막힘. 점검 스크립트로 발견)
- 권한 규칙은 `supabase/tests/rls-check.mjs`로 자동 점검 (PGlite로 로컬에서 실제 Postgres 실행)

## 데이터 파일
- `data/labels/departments.csv` — 라벨표 (`verify=Y`는 담당 업무 추정, 전화 확인 필요)
- `data/labels/eval_samples.csv` — 평가 샘플 46건 (정답 라벨 포함)
- `data/labels/dept_mapping.csv` — 국제캠퍼스 166개 부서 → 라벨 대조표 (참고용)
