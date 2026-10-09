# 클로드 코드 시작 프롬프트

세션을 나눠서 진행한다. 서버가 끝난 뒤 직원 화면을 시작한다.

## 세션 1: 서버 만들기

```
grill-me로 진행해줘. 경희대 키우기 웹앱의 Supabase 백엔드를 만들 거야.
먼저 CLAUDE.md, docs/overview.md, docs/decisions.md, data/labels/를 읽어줘.

요구사항:
- Google 로그인, @khu.ac.kr 계정만 허용
- profiles: 사용자 유형(학부생/대학원생/교직원), 소속. 교직원은 role=staff와 담당 부서가 있고, 역할은 관리자가 지정
- departments: data/labels/departments.csv를 seed로 넣기
- buildings: 지도 건물과 단과대 대응
- complaints: 내용, 사진(Storage), 건물, 상태(접수 완료→해결 중→해결 완료).
  분류 결과 칸(department, target_college, ai_confidence, ai_summary)은 비어 있어도 되게
- 권한(RLS): 민원인은 자기 민원만, staff는 자기 부서 민원과 자기 민원, admin은 전체
- Edge Function classify-complaint: docs/decisions.md의 입출력 형식을 지키고,
  지금은 항상 UNASSIGNED를 돌려주는 가짜 버전. 분류 로직은 다른 팀원이 나중에 채울 거야

구현 전에 결정 안 된 것부터 질문해줘. 목표는 10/15까지 완성이야.
```

## 세션 2: 직원 화면

```
design/ 폴더의 직원 화면(/admin, 데스크톱 1440px)을 구현하고 앞에서 만든 Supabase에 연결해줘.
CLAUDE.md와 docs/decisions.md를 먼저 읽어줘.

기능: 내 부서 민원 목록, 민원 상세(AI 요약, 사진, 위치), 상태 변경, 다른 부서로 재배정.
민원인 화면은 아직 만들지 말고, 우측 상단 민원인/직원 보기 토글 자리만 만들어줘.
```
