# 경희대 키우기 서버 (Supabase) — 프론트 연동 가이드

민원인 화면·직원 화면을 만드는 사람이 이 문서만 보고 서버를 쓸 수 있도록 정리했다.
"이럴 땐 이 코드"를 복사해서 쓰면 된다. 권한은 서버가 막으니 화면에서 따로 숨기기만 하면 된다.

## 폴더 구성

| 경로 | 하는 일 |
|---|---|
| `migrations/20261009000100_reference_tables.sql` | 단과대·부서·건물·가입 예외 이메일 테이블 |
| `migrations/20261009000200_profiles.sql` | 사용자 프로필, @khu.ac.kr 가입 제한, 프로필 자동 생성 |
| `migrations/20261009000300_complaints.sql` | 민원 테이블, 권한(RLS), 수정 규칙, 읽음 표시·재배정 함수 |
| `migrations/20261009000400_messages_and_notes.sql` | 민원별 채팅, 직원 내부 메모 |
| `migrations/20261009000500_storage.sql` | 첨부 파일 버킷 `complaint-files` |
| `migrations/20261009000600_seed_reference_data.sql` | 단과대 17개, 부서 24개, 건물 33곳 기본 데이터 |
| `migrations/20261010000100_assignment_queue.sql` | 담당자 배정 대기열, 받기·해제·넘기기·처리 완료·재문의 함수, 이력, 자동 되돌리기 |
| `seed_demo.sql` | 시연용 민원 8건 (마이그레이션 아님, SQL Editor에서 직접 실행) |
| `functions/classify-complaint/index.ts` | 분류 Edge Function (DB 읽기·저장) |
| `functions/classify-complaint/classify.ts` | **분류 로직 — 분류 담당이 채울 파일**. 지금은 항상 `UNASSIGNED` |
| `tests/rls-check.mjs` | 권한 규칙 자동 점검 (`cd supabase/tests && npm install && npm test`) |

---

## 1. 처음 설정 (서버 담당, 한 번만)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy classify-complaint
```

대시보드에서 할 일:
1. **Authentication > Providers > Google** 켜고 Google Cloud OAuth 클라이언트 ID/Secret 입력
2. **Authentication > URL Configuration** 에 배포 주소와 `http://localhost:5173` 추가
3. **Authentication > Providers > Email** 은 켜 두고 "Confirm email"도 켜 둔다 (데모 계정용)
4. 데모 계정 만들기 (SQL Editor):
   ```sql
   insert into allowed_emails (email, note) values
     ('demo.student@example.com', '심사용 민원인'),
     ('demo.staff@example.com', '심사용 직원(관리팀 staff)');
   ```
   그다음 **Authentication > Users > Add user** 로 두 이메일을 비밀번호와 함께 만든다(Auto Confirm 체크).
   비밀번호는 저장소·제출 서류에 쓰지 말고 팀 내부로만 공유한다.

### 역할 지정 (관리자, SQL Editor)

```sql
-- 일반 부서 직원
update profiles set role = 'staff', department = 'FACILITY_REPAIR' where email = 'someone@khu.ac.kr';
-- 단과대 행정실 직원: 담당 단과대도 같이 (없으면 오류)
update profiles set role = 'staff', department = 'COLLEGE_OFFICE', staff_college_code = 'software' where email = '...';
-- 운영 계정 (역할 지정·데이터 정정용, 민원 업무 권한 없음)
update profiles set role = 'admin' where email = '...';
```

### 시연 데이터
데모 직원 계정을 만든 뒤 `seed_demo.sql` 내용을 SQL Editor에 붙여 실행한다. 데모 직원을 관리팀 staff '이서윤'으로 지정하고 민원 8건을 넣는다.
자동 되돌리기 때문에 영업일 2일이 지나면 배정이 풀리니 **시연 직전에 한 번 더 실행**한다.

---

## 2. 클라이언트 만들기

```js
// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
```
`.env`는 `.env.example`을 복사해서 만든다. **`.env`는 커밋하지 않는다.**

---

## 3. 값 대응표

| 칸 | DB 값 → 화면 표시 |
|---|---|
| `complaints.status` | `received` → 배정 대기 · `in_progress` → 처리 중 · `resolved` → 처리 완료. 민원인 화면은 `department`가 비었으면 '접수 완료'로 보여 준다 |
| `profiles.role` | `user` 일반 · `staff` 부서 직원 · `admin` 운영 계정(민원 업무 권한 없음) |
| `profiles.user_type` | `undergrad` 학부생 · `grad` 대학원생 · `staff` 교직원 · `null` 가입 정보 입력 전 |
| `complaints.department` | `departments.code`. `null` = 분류 전/실패, `UNASSIGNED` = 미분류 대기열(직원이 받아서 넘김) |
| `complaints.channel` | `chat` 챗봇 대화 후 접수 · `chatbot_handoff` 챗봇 이관 · `form` 접수서 · `decorate` 꾸미기 |

부서 이름·단과대 이름·건물 이름은 하드코딩하지 말고 테이블에서 읽는다.

```js
const { data: departments } = await supabase.from('departments').select('code, name')
const { data: colleges } = await supabase.from('colleges').select('code, name, kind')
const { data: buildings } = await supabase.from('buildings').select('id, name, map_no, x, y').order('map_no')
```

---

## 4. 로그인 · 가입 정보

### Google 로그인
```js
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: window.location.origin, queryParams: { hd: 'khu.ac.kr' } },
})
```
`hd`는 구글 화면에서 경희 계정만 보여 주는 용도이고, 실제 차단은 서버가 한다.
다른 도메인으로 가입하면 `error_description`에 "Database error saving new user"가 붙어 돌아온다 → "경희대 계정으로 로그인해 주세요" 안내.

### 데모 계정 로그인 (심사·시연용)
```js
await supabase.auth.signInWithPassword({ email, password })
```

### 내 프로필 → 화면 분기
```js
const { data: { user } } = await supabase.auth.getUser()
const { data: me } = await supabase.from('profiles').select('*').eq('id', user.id).single()

if (!me.user_type) { /* 가입 정보 입력 화면 */ }
const isStaff = me.role === 'staff' // [민원인/직원] 토글을 보여줄지
```

### 가입 정보 입력 (본인이 바꿀 수 있는 칸은 이 4개뿐)
```js
await supabase.from('profiles')
  .update({ user_type: 'undergrad', college_code: 'software', major: '인공지능학과', display_name: '홍길동' })
  .eq('id', user.id)
```
`role`, `department`, `staff_college_code`를 보내면 권한 오류가 난다(관리자만).

---

## 5. 민원 접수 (민원인 화면)

순서: **파일 업로드 → 민원 저장 → 분류 함수 호출**

```js
// 1) 파일 업로드: 경로는 반드시 "{내 user id}/..."
async function upload(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('complaint-files')
    .upload(path, file, { contentType: MIME[ext] ?? file.type })
  if (error) throw error
  return path
}
// hwp는 브라우저가 형식을 비워 보내는 경우가 많아 직접 지정한다
const MIME = { hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

const photo_paths = await Promise.all(photos.map(upload)) // 최대 3장
const doc_paths = await Promise.all(docs.map(upload))     // 최대 2개

// 2) 민원 저장 (requester_id, status는 서버가 채운다)
const { data: complaint, error } = await supabase.from('complaints')
  .insert({ content, building_id: selectedBuildingId ?? null, photo_paths, doc_paths })
  .select().single()

// 3) 분류 요청: 실패해도 민원은 접수된 상태이므로 사용자에게는 "접수 완료"를 보여준다
supabase.functions.invoke('classify-complaint', { body: { complaint_id: complaint.id } })
```

| 제한 | 값 | 넘으면 |
|---|---|---|
| 본문 | 1~500 byte (한글 약 166자) | insert 오류. `new TextEncoder().encode(text).length`로 미리 검사 |
| 사진 | jpg·png·webp·heic, 최대 3장 | insert 오류 |
| 문서 | pdf·hwp·hwpx·docx, 최대 2개 | insert 오류 |
| 파일 크기 | 하나당 10MB | upload 오류 |
| 동영상 | 받지 않음 | upload 오류 |

### 직원이 민원을 낼 때
같은 민원인 화면을 쓴다. `isStaff`일 때만 "부서 직접 선택" 칸을 보여주고, 고르면 `department`를 같이 넣는다.
**부서를 직접 골랐으면 분류 함수를 부르지 않는다.** (일반 사용자가 `department`를 보내면 서버가 지운다.)
```js
await supabase.from('complaints').insert({ content, department: 'IT', photo_paths: [], doc_paths: [] })
```

### 접수 경로
`channel`을 같이 넣는다(`chat`·`chatbot_handoff`·`form`·`decorate`, 기본 `form`). 챗봇을 거쳤으면 대화도 넣는다.
```js
await supabase.from('complaints').insert({ content, channel: 'chat', chatbot_log: [{ who: 'bot', text: '...' }, { who: 'user', text: '...' }] })
```
접수 시각·상태·담당자는 서버가 정한다(보내도 무시).

---

## 6. 나의 활동 (민원인 화면)

```js
const { data } = await supabase.from('complaints')
  .select('*, building:buildings(name), dept:departments(name)')
  .eq('requester_id', user.id)
  .order('created_at', { ascending: false })
```
탭 나누기: `status`가 `received` / `in_progress` / `resolved`.

### 첨부 사진 보여주기 (비공개 버킷이라 임시 주소 필요)
```js
const { data } = await supabase.storage.from('complaint-files').createSignedUrls(complaint.photo_paths, 60 * 60)
// data[i].signedUrl 을 <img src>로
```

### 해결 완료 알림 (실시간)
```js
supabase.channel('my-complaints')
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'complaints', filter: `requester_id=eq.${user.id}` },
      ({ new: c }) => { if (c.status === 'resolved') showToast('민원이 해결됐어요!') })
  .subscribe()
```

---

## 7. 민원 수정 (민원인)

**담당자가 받기 전(`read_at`이 `null`)에만** 본문·건물·첨부를 고칠 수 있다.

```js
if (complaint.read_at) {
  // 담당자가 이미 받음 → 채팅 화면으로 보내기: "담당자가 확인했어요. 채팅으로 요청해 주세요"
} else {
  const { error } = await supabase.from('complaints')
    .update({ content: newContent, photo_paths, doc_paths }).eq('id', complaint.id)
  if (error) { /* 그 사이 담당자가 열어 봤을 수 있음 → 채팅으로 안내 */ }
  else supabase.functions.invoke('classify-complaint', { body: { complaint_id: complaint.id } }) // 다시 분류
}
```
삭제는 없다. 뺀 첨부 파일은 `supabase.storage.from('complaint-files').remove([path])`로 지운다.

---

## 8. 채팅 (민원인 ↔ 담당자)

```js
// 불러오기
const { data: msgs } = await supabase.from('messages')
  .select('*').eq('complaint_id', id).order('created_at')
// 말풍선 구분: m.sender_id === complaint.requester_id ? '민원인' : '담당자'

// 보내기
await supabase.from('messages').insert({ complaint_id: id, body: text })

// 실시간 받기
supabase.channel(`chat-${id}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `complaint_id=eq.${id}` },
      ({ new: m }) => append(m))
  .subscribe()
```
민원인과 지금 담당자만 읽고 쓸 수 있다. 처리 완료된 민원에는 보낼 수 없다(재문의 사용). 수정·삭제는 없다.
`kind`가 `letter`면 담당자의 공식 답변서다('나의 활동'에 공식 답변으로 표시).

### 재문의 (처리 완료 후 7일 안)
```js
const { error } = await supabase.rpc('reopen_complaint', { complaint_id: id, body: '아직 바람이 약해요' })
// 7일이 지났으면 error.message에 '새 민원으로 접수해 주세요' → 새 민원 접수로 안내
```
같은 민원 번호로 같은 담당자에게 다시 가고, 상태는 처리 중이 된다.

---

## 9. 직원 화면 (/admin)

규칙은 `docs/decisions.md`의 '민원 배정과 상태'. 직원은 목록에서 민원을 고르지 않고 **다음 민원 받기**로 1건씩 받는다.
민원 내용은 **민원인과 담당자만** 본다. 상태는 아래 함수가 자동으로 바꾸고, 앱에서 `update`로 바꾸면 권한 오류가 난다.

### 내 민원 (내가 맡은 것)
```js
const { data } = await supabase.from('complaints')
  .select('*, building:buildings(name), requester:profiles!complaints_requester_id_fkey(display_name, email, user_type, college_code, major)')
  .eq('assignee_id', user.id)
  .order('created_at')
```
- 지연(3일 이상): 화면에서 계산. `status !== 'resolved' && Date.now() - created_at >= 3일`
- 재문의 표시: `reopened_at`이 있으면

### 다음 민원 받기
```js
const { data: q } = await supabase.rpc('queue_status')          // [{ mine, unassigned, oldest }]
const { data: id } = await supabase.rpc('claim_next_complaint') // 받은 민원 id, 대기 0건이면 null
if (id) navigate(`/admin/complaints/${id}`)
```
내 부서 대기 → 없으면 미분류 대기 순서로, 처음 접수 시각이 가장 오래된 것을 준다. 여러 명이 동시에 눌러도 같은 민원을 두 번 주지 않는다.
미분류에서 받은 민원은 내 부서 민원이 된다(맞지 않으면 넘기기).

### 부서 현황 (읽기 전용)
```js
const { data } = await supabase.rpc('department_board')
// [{ id, no, created_at, summary, assignee_id, assignee_name, status, resolved_at, reopened_at }]
```
배정 전 민원은 `summary`가 `null` → '배정 전 (내용 비공개)'. 남의 민원 상세는 열 수 없다.

### 처리 화면
```js
await supabase.rpc('release_complaint', { complaint_id: id })    // 담당 해제 → 대기열로
await supabase.rpc('reassign_complaint', {                        // 다른 부서로 넘기기 → 그 부서 대기열로
  complaint_id: id, new_department: 'SCHOLARSHIP', reason: 'academic_scholarship', note: null })
  // 행정실이면 new_target_college: 'software' 도 (비우면 민원인 소속)
await supabase.rpc('resolve_complaint', { complaint_id: id })                 // 대화 종료 후 처리 완료
await supabase.rpc('resolve_complaint', { complaint_id: id, letter: text })   // 답변서 보내고 처리 완료
```

| 넘기는 이유 `reason` | 화면 문구 |
|---|---|
| `not_our_work` | 우리 부서 업무가 아님 |
| `other_dept_facility` | 다른 부서가 관리하는 시설 |
| `academic_scholarship` | 학사·장학 관련 문의 |
| `other` | 기타 (`note` 필수) |

이유는 민원인에게 안 보이고, 받는 담당자만 `complaint_events`에서 본다.
```js
const { data: events } = await supabase.from('complaint_events').select('*').eq('complaint_id', id).order('created_at')
```

### 채팅 · 챗봇 기록 · 꾸미기 이미지
- 채팅은 '8. 채팅'과 같다. `kind === 'letter'`인 메시지는 답변서
- 채팅 구획을 펼칠지: `channel`이 `chat`·`chatbot_handoff`이거나 `kind === 'chat'` 메시지가 있으면
- 접수 전 챗봇 대화: `complaint.chatbot_log` (`[{ who: 'bot' | 'user', text }]`)
- 꾸미기(`channel === 'decorate'`)의 전후 이미지는 `photo_paths`

### 자동 되돌리기 알림
받은 뒤 영업일 2일 동안 담당자 채팅·처리가 없으면 서버(pg_cron, 30분마다)가 대기열로 돌린다. 원래 담당자에게 알리려면:
```js
const { data } = await supabase.from('complaint_events').select('*, complaint:complaints(no)')
  .eq('kind', 'auto_released').eq('assignee_id', user.id).order('created_at', { ascending: false })
```

### 내부 메모 (민원인에게 안 보임, 담당자만)
```js
await supabase.from('complaint_notes').insert({ complaint_id: id, body: '업체 수리 요청함' })
```

---

## 10. 권한 요약 (서버가 강제)

| | 민원인 | 담당자 | 같은 부서 직원 | admin(운영) |
|---|---|---|---|---|
| 민원 내용 조회 | 자기 것 | 내가 맡은 것 | ✕ (`department_board` 요약만, 배정 전은 요약도 ✕) | ✕ |
| 본문·첨부 수정 | 담당자가 받기 전만 | ✕ | ✕ | ✕ |
| 받기·해제·넘기기·처리 완료 | ✕ | ○ (함수로만) | 받기만 | ✕ |
| 재문의 | 처리 완료 7일 안 | ✕ | ✕ | ✕ |
| 분류 결과 칸(ai_*) | ✕ | ✕ | ✕ | ✕ (Edge Function만) |
| 민원 삭제 | ✕ | ✕ | ✕ | ✕ |
| 채팅 | 자기 민원, 처리 완료 전 | 맡은 민원 | ✕ | ✕ |
| 넘기는 이유·이력 | ✕ | 맡은 민원 | ✕ | ✕ |
| 내부 메모 | ✕ | 맡은 민원 | ✕ | ✕ |
| 다른 사람 프로필 | ✕ | 맡은 민원의 민원인 | ✕ | 전체 |

admin은 역할 지정·데이터 정정용 운영 계정이고, 실제 정정은 대시보드 SQL로 한다.
이 규칙을 바꾸면 `tests/rls-check.mjs`를 같이 고치고 다시 돌린다.

---

## 11. 분류 함수 (분류 담당용)

- 고칠 파일은 `functions/classify-complaint/classify.ts` 하나다. 입출력 타입은 그 파일 맨 위에 있다.
- `target_college`는 **colleges 테이블의 code**(예: `software`)로 돌려준다. 한글 이름을 돌려주면 저장에 실패한다.
- API 키는 `npx supabase secrets set CHATKHU_API_KEY=...`로 넣고 `Deno.env.get('CHATKHU_API_KEY')`로 읽는다. 코드에 쓰지 않는다.
- 배포: `npx supabase functions deploy classify-complaint`
