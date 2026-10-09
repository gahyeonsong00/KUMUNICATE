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
     ('demo.staff@example.com', '심사용 직원(admin)');
   ```
   그다음 **Authentication > Users > Add user** 로 두 이메일을 비밀번호와 함께 만든다(Auto Confirm 체크).
   비밀번호는 저장소·제출 서류에 쓰지 말고 팀 내부로만 공유한다.

### 역할 지정 (관리자, SQL Editor)

```sql
-- 일반 부서 직원
update profiles set role = 'staff', department = 'FACILITY_REPAIR' where email = 'someone@khu.ac.kr';
-- 단과대 행정실 직원: 담당 단과대도 같이 (없으면 오류)
update profiles set role = 'staff', department = 'COLLEGE_OFFICE', staff_college_code = 'software' where email = '...';
-- 관리자 (전체 민원 + 미분류 민원 배정)
update profiles set role = 'admin' where email = 'demo.staff@example.com';
```

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
| `complaints.status` | `received` → 접수 완료 · `in_progress` → 해결 중 · `resolved` → 해결 완료 |
| `profiles.role` | `user` 일반 · `staff` 부서 직원 · `admin` 관리자 |
| `profiles.user_type` | `undergrad` 학부생 · `grad` 대학원생 · `staff` 교직원 · `null` 가입 정보 입력 전 |
| `complaints.department` | `departments.code`. `null` = 분류 전/실패, `UNASSIGNED` = 미분류(admin이 배정) |

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
const isStaff = me.role === 'staff' || me.role === 'admin' // [민원인/직원] 토글을 보여줄지
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

**담당자가 열어 보기 전(`read_at`이 `null`)에만** 본문·건물·첨부를 고칠 수 있다.

```js
if (complaint.read_at) {
  // 담당자가 이미 확인함 → 채팅 화면으로 보내기: "담당자가 확인했어요. 채팅으로 요청해 주세요"
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
그 민원을 볼 수 있는 사람(민원인, 담당 부서 staff, admin)만 읽고 쓸 수 있다. 수정·삭제는 없다.

---

## 9. 직원 화면 (/admin)

### 민원함
조건 없이 조회하면 **서버가 알아서 내 담당 민원만** 돌려준다(admin은 전체).
```js
const { data } = await supabase.from('complaints')
  .select('*, building:buildings(name), requester:profiles(display_name, user_type, college_code, major)')
  .order('created_at', { ascending: false })
```
- 미분류함(admin): `.or('department.is.null,department.eq.UNASSIGNED')`
- 신뢰도 낮음: `.lt('ai_confidence', 0.8)`
- 지연(3일 이상): `.neq('status', 'resolved').lt('created_at', new Date(Date.now() - 3 * 864e5).toISOString())`

### 상세 열 때 읽음 표시 (이 순간부터 민원인은 본문 수정 불가)
```js
await supabase.rpc('mark_complaint_read', { complaint_id: id })
```

### 상태 변경
```js
await supabase.from('complaints').update({ status: 'in_progress' }).eq('id', id)
await supabase.from('complaints').update({ status: 'resolved' }).eq('id', id) // resolved_at 자동 기록 + 민원인에게 실시간 알림
```

### 다른 부서로 재배정 (update로 직접 바꾸면 막힌다)
```js
await supabase.rpc('reassign_complaint', { complaint_id: id, new_department: 'IT' })
// 행정실로 보낼 땐 단과대도: { complaint_id: id, new_department: 'COLLEGE_OFFICE', new_target_college: 'software' }
```
넘기고 나면 원래 담당자 목록에서는 사라진다(정상).

### 내부 메모 (민원인에게 안 보임)
```js
await supabase.from('complaint_notes').insert({ complaint_id: id, body: '업체 수리 요청함' })
const { data: notes } = await supabase.from('complaint_notes').select('*').eq('complaint_id', id).order('created_at')
```

---

## 10. 권한 요약 (서버가 강제)

| | 민원인 | 담당 staff | admin |
|---|---|---|---|
| 민원 조회 | 자기 것 | 자기 부서(행정실은 담당 단과대) + 자기 것 | 전체 |
| 본문·첨부 수정 | 담당자가 읽기 전만 | ✕ | ✕ |
| 상태 변경·재배정 | ✕ | ○ | ○ |
| 분류 결과 칸(ai_*) | ✕ | ✕ | ✕ (Edge Function만) |
| 민원 삭제 | ✕ | ✕ | ✕ |
| 채팅 | 자기 민원 | 담당 민원 | 전체 |
| 내부 메모 | ✕ | 담당 민원 | 전체 |
| 다른 사람 프로필 | ✕ | 담당 민원의 민원인만 | 전체 |

이 규칙을 바꾸면 `tests/rls-check.mjs`를 같이 고치고 다시 돌린다.

---

## 11. 분류 함수 (분류 담당용)

- 고칠 파일은 `functions/classify-complaint/classify.ts` 하나다. 입출력 타입은 그 파일 맨 위에 있다.
- `target_college`는 **colleges 테이블의 code**(예: `software`)로 돌려준다. 한글 이름을 돌려주면 저장에 실패한다.
- API 키는 `npx supabase secrets set CHATKHU_API_KEY=...`로 넣고 `Deno.env.get('CHATKHU_API_KEY')`로 읽는다. 코드에 쓰지 않는다.
- 배포: `npx supabase functions deploy classify-complaint`
