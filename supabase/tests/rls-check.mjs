// =====================================================================
// 권한(RLS)·트리거 자동 점검 — Supabase 없이 내 컴퓨터에서 실행
//   cd supabase/tests && npm install && npm test
// 메모리 안의 진짜 Postgres(PGlite)에 auth·storage를 흉내 낸 뒤 migrations/를 전부 적용하고,
// "민원인은 자기 것만", "확인 후 수정 불가", "재배정" 같은 규칙을 시나리오로 확인한다.
// 마이그레이션을 고치면 꼭 다시 돌릴 것. 마지막 줄에 ALL CHECKS PASSED가 나오면 통과.
// =====================================================================
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../migrations", import.meta.url));
const db = new PGlite();

// --- minimal Supabase stub ---
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true),'')::json->>'sub')::uuid $$;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$
  select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth, storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(`${dir}/${f}`, "utf8")); }
  catch (e) { console.error("MIGRATION FAIL", f, e.message); process.exit(1); }
  console.log("ok", f);
}

const one = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, fn) => {
  await db.exec("begin");
  try {
    if (uid === "service") await db.exec("set local role service_role");
    else { await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]); }
    const r = await fn(); await db.exec("commit"); return r;
  } catch (e) { await db.exec("rollback"); if (process.env.DBG) console.log("ERR in", fn.toString(), e.message); throw e; }
};
const fails = async (p, re) => { await assert.rejects(p, re); };

// signup
await fails(one("insert into auth.users(id, email) values (gen_random_uuid(), 'x@gmail.com')"), /khu\.ac\.kr/);
await fails(one("insert into auth.users(id, email) values (gen_random_uuid(), null)"), /khu\.ac\.kr/);
await one("insert into public.allowed_emails values ('demo@gmail.com','demo')");
const mk = async (email) => (await one("insert into auth.users(id, email, raw_user_meta_data) values (gen_random_uuid(), $1, '{\"full_name\":\"N\"}') returning id", [email]))[0].id;
const A = await mk("a@khu.ac.kr"), B = await mk("b@KHU.ac.kr"), F = await mk("f@khu.ac.kr"),
  S = await mk("s@khu.ac.kr"), E = await mk("e@khu.ac.kr"), ADM = await mk("demo@gmail.com");
await fails(one("update auth.users set email='a@gmail.com' where id=$1", [A]), /khu/);
assert.equal((await one("select count(*)::int n from profiles where role='user'"))[0].n, 6);

await one("update profiles set college_code='software', user_type='undergrad' where id=$1", [A]);
await one("update profiles set role='staff', department='FACILITY_REPAIR' where id=$1", [F]);
await fails(one("update profiles set role='staff', department='COLLEGE_OFFICE' where id=$1", [S]), /office_staff/);
await one("update profiles set role='staff', department='COLLEGE_OFFICE', staff_college_code='software' where id=$1", [S]);
await one("update profiles set role='staff', department='COLLEGE_OFFICE', staff_college_code='engineering' where id=$1", [E]);
await one("update profiles set role='admin' where id=$1", [ADM]);

// profile self-update limits
await as(A, () => one("update profiles set major='인공지능학과' where id=$1", [A]));
await fails(as(A, () => one("update profiles set role='admin' where id=$1", [A])), /permission denied/);

// insert: user cannot pick department; status forced
const cid = (await as(A, () => one(
  "insert into complaints(content, building_id, department, status, photo_paths) values ('변기 막힘','engineering','SAFETY','resolved', array[$1]) returning *",
  [A + "/p1.jpg"])))[0];
assert.equal(cid.department, null); assert.equal(cid.status, "received"); assert.equal(cid.requester_id, A);
await fails(as(A, () => one("insert into complaints(content, photo_paths) values ('x', array[$1])", [B + "/p.jpg"])), /본인 user id/);
await fails(as(A, () => one("insert into complaints(content, photo_paths) values ('x', array[$1||'/a',$1||'/b',$1||'/c',$1||'/d'])", [A])), /check/);
await fails(as(A, () => one("insert into complaints(content) values ($1)", ["가".repeat(167)])), /check/);
await fails(as(A, () => one("insert into complaints(content, requester_id) values ('x',$1)", [B])), /row-level security/);

// server classification
await as("service", () => one("update complaints set department='FACILITY_REPAIR', ai_confidence=0.9, ai_summary='s' where id=$1", [cid.id]));
assert.match(cid.no, /^\d{4}-\d{4}-\d{3}$/);
const sees = async (u, id = cid.id) => (await as(u, () => one("select id from complaints where id=$1", [id]))).length;
// 배정 전: 민원인만 본다. 같은 부서 직원·admin도 내용은 못 본다
assert.deepEqual([await sees(A), await sees(B), await sees(F), await sees(S), await sees(ADM)], [1, 0, 0, 0, 0]);
// 부서 현황: 배정 전이면 요약 비공개
const board = async (u) => as(u, () => one("select * from department_board()"));
assert.equal((await board(F)).length, 1); assert.equal((await board(F))[0].summary, null);
assert.equal((await board(S)).length, 0); assert.equal((await board(ADM)).length, 0);

// 직접 고치기는 막힘 (상태·부서·AI 칸·담당자는 함수로만)
await fails(as(A, () => one("update complaints set ai_summary='hack' where id=$1", [cid.id])), /permission denied/);
await fails(as(A, () => one("update complaints set status='resolved' where id=$1", [cid.id])), /permission denied/);
await fails(as(F, () => one("update complaints set assignee_id=$2 where id=$1", [cid.id, F])), /permission denied/);
// 받기 전에는 민원인이 수정 가능
await as(A, () => one("update complaints set content='변기 막힘 3층' where id=$1", [cid.id]));
// 일반 사용자·admin은 받을 수 없다
await fails(as(A, () => one("select claim_next_complaint()")), /부서 직원만/);
await fails(as(ADM, () => one("select claim_next_complaint()")), /부서 직원만/);
// 대기 건수
assert.deepEqual(await as(F, () => one("select mine, unassigned from queue_status()")), [{ mine: 1, unassigned: 0 }]);
assert.deepEqual(await as(A, () => one("select mine, unassigned from queue_status()")), [{ mine: 0, unassigned: 0 }]);

// 같은 부서 직원 F2 추가. 둘이 차례로 받으면 서로 다른 민원 (두 번째는 없음)
// shortcut: PGlite는 연결이 하나라 진짜 동시 클릭은 못 흉내 낸다. 동시성은 for update skip locked에 맡긴다
const F2 = await mk("f2@khu.ac.kr");
await one("update profiles set role='staff', department='FACILITY_REPAIR', display_name='F2' where id=$1", [F2]);
assert.equal((await as(F, () => one("select claim_next_complaint() id")))[0].id, cid.id);
assert.equal((await as(F2, () => one("select claim_next_complaint() id")))[0].id, null);
let row = (await one("select * from complaints where id=$1", [cid.id]))[0];
assert.equal(row.assignee_id, F); assert.equal(row.status, "in_progress"); assert.notEqual(row.read_at, null);
assert.deepEqual([await sees(F), await sees(F2)], [1, 0]);
assert.equal((await board(F2))[0].summary, "s"); // 배정 후엔 부서 동료도 요약은 본다
assert.equal((await board(F2))[0].assignee_name, "N");
// 받은 뒤 민원인 수정 불가
await fails(as(A, () => one("update complaints set content='수정' where id=$1", [cid.id])), /채팅으로/);
// 담당자 아닌 사람은 해제·넘기기·완료 불가
await fails(as(F2, () => one("select release_complaint($1)", [cid.id])), /내가 처리 중인/);
await fails(as(F2, () => one("select resolve_complaint($1)", [cid.id])), /내가 처리 중인/);
await fails(as(B, () => one("select reassign_complaint($1,'IT','not_our_work')", [cid.id])), /내가 처리 중인/);

// messages & notes
await as(A, () => one("insert into messages(complaint_id, body) values ($1,'언제 고쳐주나요')", [cid.id]));
await as(F, () => one("insert into messages(complaint_id, body) values ($1,'오늘 갑니다')", [cid.id]));
await fails(as(F2, () => one("insert into messages(complaint_id, body) values ($1,'x')", [cid.id])), /row-level/);
await fails(as(F, () => one("insert into messages(complaint_id, body, kind) values ($1,'x','letter')", [cid.id])), /row-level/);
await as(F, () => one("insert into complaint_notes(complaint_id, body) values ($1,'내부메모')", [cid.id]));
await fails(as(F2, () => one("insert into complaint_notes(complaint_id, body) values ($1,'x')", [cid.id])), /row-level/);
await fails(as(A, () => one("insert into complaint_notes(complaint_id, body) values ($1,'x')", [cid.id])), /row-level/);
assert.equal((await as(A, () => one("select * from complaint_notes"))).length, 0);
// 담당자는 민원인 프로필을 본다. 같은 부서 동료·다른 학생은 못 본다
assert.equal((await as(F, () => one("select id from profiles where id=$1", [A]))).length, 1);
assert.equal((await as(F2, () => one("select id from profiles where id=$1", [A]))).length, 0);
assert.equal((await as(B, () => one("select id from profiles where id=$1", [A]))).length, 0);
assert.equal((await as(ADM, () => one("select id from profiles"))).length, 7);

// 담당 해제 → 대기열로, F2가 받는다
await as(F, () => one("select release_complaint($1)", [cid.id]));
row = (await one("select * from complaints where id=$1", [cid.id]))[0];
assert.equal(row.assignee_id, null); assert.equal(row.status, "received");
assert.equal((await as(F2, () => one("select claim_next_complaint() id")))[0].id, cid.id);

// 넘기기: 이유 필수, 기타는 덧붙일 말 필수
await fails(as(F2, () => one("select reassign_complaint($1,'COLLEGE_OFFICE',null)", [cid.id])), /이유를 골라/);
await fails(as(F2, () => one("select reassign_complaint($1,'COLLEGE_OFFICE','other','  ')", [cid.id])), /덧붙일 말/);
await fails(as(F2, () => one("select reassign_complaint($1,'FACILITY_REPAIR','not_our_work')", [cid.id])), /다른 부서/);
await as(F2, () => one("select reassign_complaint($1,'COLLEGE_OFFICE','not_our_work')", [cid.id]));
row = (await one("select * from complaints where id=$1", [cid.id]))[0];
assert.equal(row.target_college, "software"); assert.equal(row.assignee_id, null); assert.equal(row.status, "received");
assert.deepEqual([await sees(F2), await sees(S), await sees(E)], [0, 0, 0]);
// 받는 부서(행정실 software) S가 받으면 채팅·넘기는 이유를 본다. 민원인은 이유를 못 본다
assert.equal((await as(E, () => one("select claim_next_complaint() id")))[0].id, null);
assert.equal((await as(S, () => one("select claim_next_complaint() id")))[0].id, cid.id);
assert.equal((await as(S, () => one("select * from messages"))).length, 2);
assert.equal((await as(E, () => one("select * from messages"))).length, 0);
const reasons = await as(S, () => one("select reason from complaint_events where kind='transferred'"));
assert.deepEqual(reasons, [{ reason: "not_our_work" }]);
assert.equal((await as(A, () => one("select * from complaint_events"))).length, 0);
await fails(as(S, () => one("update complaints set department='IT' where id=$1", [cid.id])), /permission denied/);
// 행정실에서 일반 부서로 넘기면 target_college가 비워진다
await as(S, () => one("select reassign_complaint($1,'IT','other','전산 문의로 보임','software')", [cid.id]));
assert.equal((await one("select target_college from complaints where id=$1", [cid.id]))[0].target_college, null);

// 미분류 대기열: F(관리팀) 부서 대기가 없으면 미분류를 받고, 내 부서 민원이 된다
const un = (await as(B, () => one("insert into complaints(content, channel) values ('어디에 물어봐요?','chatbot_handoff') returning id")))[0].id;
await as("service", () => one("update complaints set department='UNASSIGNED' where id=$1", [un]));
assert.deepEqual(await as(F, () => one("select mine, unassigned from queue_status()")), [{ mine: 0, unassigned: 1 }]);
assert.equal((await as(F, () => one("select claim_next_complaint() id")))[0].id, un);
assert.equal((await one("select department from complaints where id=$1", [un]))[0].department, "FACILITY_REPAIR");
// 처리 완료: 답변서는 letter로 남는다
await as(F, () => one("select resolve_complaint($1, $2)", [un, "학생지원센터로 문의해 주세요"]));
row = (await one("select * from complaints where id=$1", [un]))[0];
assert.equal(row.status, "resolved"); assert.notEqual(row.resolved_at, null);
assert.deepEqual(await as(B, () => one("select kind from messages where complaint_id=$1", [un])), [{ kind: "letter" }]);
await fails(as(B, () => one("insert into messages(complaint_id, body) values ($1,'x')", [un])), /row-level/);
// 재문의: 민원인만, 7일 안. 같은 담당자에게 처리 중으로
await fails(as(F, () => one("select reopen_complaint($1,'x')", [un])), /내 민원만/);
await as(B, () => one("select reopen_complaint($1,'아직 모르겠어요')", [un]));
row = (await one("select * from complaints where id=$1", [un]))[0];
assert.equal(row.status, "in_progress"); assert.equal(row.assignee_id, F); assert.notEqual(row.reopened_at, null);
assert.equal(row.resolved_at, null);
await as(F, () => one("select resolve_complaint($1)", [un]));
await one("update complaints set resolved_at = now() - interval '8 days' where id=$1", [un]);
await fails(as(B, () => one("select reopen_complaint($1,'x')", [un])), /7일/);

// 접수 시각·담당자는 앱이 정할 수 없다 (대기 순서 새치기 방지)
const cheat = (await as(B, () => one("insert into complaints(content, created_at) values ('x', '2020-01-01') returning id, created_at")))[0];
assert.ok(new Date(cheat.created_at).getFullYear() > 2020);

// 영업일 계산: 금 15시 +2 → 화 15시, 토 10시 +2 → 화 10시, 수 → 금
const bd = async (t) => (await one("select to_char(add_business_days($1::timestamptz, 2) at time zone 'Asia/Seoul', 'Dy HH24') d", [t]))[0].d;
assert.deepEqual([await bd("2026-10-09 15:00+09"), await bd("2026-10-10 10:00+09"), await bd("2026-10-07 09:00+09")], ["Tue 15", "Tue 10", "Fri 09"]);
// 자동 되돌리기: 받은 지 오래고 담당자 채팅이 없으면 대기열로, 이력은 원래 담당자가 본다
const st = (await as(A, () => one("insert into complaints(content) values ('오래된 민원') returning id")))[0].id;
await as("service", () => one("update complaints set department='FACILITY_REPAIR' where id=$1", [st]));
assert.equal((await as(F2, () => one("select claim_next_complaint() id")))[0].id, st);
assert.equal((await one("select auto_release_stale() n"))[0].n, 0);
await one("update complaints set assigned_at = now() - interval '5 days' where id=$1", [st]);
assert.equal((await one("select auto_release_stale() n"))[0].n, 1);
row = (await one("select * from complaints where id=$1", [st]))[0];
assert.equal(row.assignee_id, null); assert.equal(row.status, "received");
assert.equal((await as(F2, () => one("select kind from complaint_events where kind='auto_released'"))).length, 1);

// delete impossible
await as(A, () => one("delete from complaints where id=$1", [cid.id]));
assert.equal((await one("select count(*)::int n from complaints where id=$1", [cid.id]))[0].n, 1);
// staff가 부서를 직접 고르면 유지
const sc = (await as(F, () => one("insert into complaints(content, department) values ('우리 부서 건','FACILITY_REPAIR') returning department")))[0];
assert.equal(sc.department, "FACILITY_REPAIR");
// 자기 민원은 자기가 받지 않는다: F는 st, 그다음 미분류(cheat)를 받고 자기 민원 sc는 안 받는다
assert.equal((await as(F, () => one("select claim_next_complaint() id")))[0].id, st);
assert.equal((await as(F, () => one("select claim_next_complaint() id")))[0].id, cheat.id);
assert.equal((await as(F, () => one("select claim_next_complaint() id")))[0].id, null);

// storage: 민원인과 지금 담당자만 첨부를 읽는다
await fails(as(B, () => one("insert into storage.objects(bucket_id,name) values ('complaint-files',$1)", [A + "/z.jpg"])), /row-level/);
await as(A, () => one("insert into storage.objects(bucket_id,name) values ('complaint-files',$1)", [A + "/p1.jpg"]));
const canRead = async (u) => (await as(u, () => one("select name from storage.objects"))).length;
assert.deepEqual([await canRead(A), await canRead(B), await canRead(F), await canRead(S)], [1, 0, 0, 0]);
await one("update complaints set department='FACILITY_REPAIR' where id=$1", [cid.id]);
assert.equal((await as(F2, () => one("select claim_next_complaint() id")))[0].id, cid.id);
assert.deepEqual([await canRead(F), await canRead(F2)], [0, 1]);

// 시연 시드: 데모 직원이 있어야 실행되고, 두 번 돌려도 같은 결과
const seed = fs.readFileSync(fileURLToPath(new URL("../seed_demo.sql", import.meta.url)), "utf8");
await fails(db.exec(seed), /데모 직원 계정/);
await one("insert into allowed_emails values ('demo.staff@example.com','demo staff')");
const DEMO = await mk("demo.staff@example.com");
await db.exec(seed); await db.exec(seed);
assert.equal((await one("select count(*)::int n from profiles where email like 'seed.%'"))[0].n, 10);
assert.equal((await as(DEMO, () => one("select id from complaints"))).length, 3);
assert.equal((await as(DEMO, () => one("select id from messages"))).length, 6);
assert.equal((await as(DEMO, () => one("select unassigned from queue_status()")))[0].unassigned >= 1, true);
assert.deepEqual((await one("select channel, count(*)::int n from complaints c join profiles p on p.id=c.requester_id where p.email like 'seed.%' group by 1 order by 1")),
  [{ channel: "chat", n: 1 }, { channel: "chatbot_handoff", n: 1 }, { channel: "decorate", n: 1 }, { channel: "form", n: 5 }]);

console.log("ALL CHECKS PASSED");
