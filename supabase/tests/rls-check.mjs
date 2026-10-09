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
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
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
await fails(one("insert into auth.users(email) values ('x@gmail.com')"), /khu\.ac\.kr/);
await fails(one("insert into auth.users(email) values (null)"), /khu\.ac\.kr/);
await one("insert into public.allowed_emails values ('demo@gmail.com','demo')");
const mk = async (email) => (await one("insert into auth.users(email, raw_user_meta_data) values ($1, '{\"full_name\":\"N\"}') returning id", [email]))[0].id;
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
const sees = async (u) => (await as(u, () => one("select id from complaints where id=$1", [cid.id]))).length;
assert.deepEqual([await sees(A), await sees(B), await sees(F), await sees(S), await sees(ADM)], [1, 0, 1, 0, 1]);

// user cannot change ai/status
await fails(as(A, () => one("update complaints set ai_summary='hack' where id=$1", [cid.id])), /바꿀 수 없는/);
await fails(as(A, () => one("update complaints set status='resolved' where id=$1", [cid.id])), /담당자만/);
await fails(as(A, () => one("update complaints set read_at=now() where id=$1", [cid.id])), /mark_complaint_read/);
// edit before read ok, after read blocked
await as(A, () => one("update complaints set content='변기 막힘 3층' where id=$1", [cid.id]));
await as(B, () => one("select mark_complaint_read($1)", [cid.id])); // no effect (cannot see)
assert.equal((await one("select read_at from complaints where id=$1", [cid.id]))[0].read_at, null);
await as(F, () => one("select mark_complaint_read($1)", [cid.id]));
assert.notEqual((await one("select read_at from complaints where id=$1", [cid.id]))[0].read_at, null);
await fails(as(A, () => one("update complaints set content='수정' where id=$1", [cid.id])), /채팅으로/);
// staff status + resolved_at
await as(F, () => one("update complaints set status='resolved' where id=$1", [cid.id]));
assert.notEqual((await one("select resolved_at from complaints where id=$1", [cid.id]))[0].resolved_at, null);
await as(F, () => one("update complaints set status='in_progress' where id=$1", [cid.id]));
assert.equal((await one("select resolved_at from complaints where id=$1", [cid.id]))[0].resolved_at, null);
// messages & notes before reassignment
await as(A, () => one("insert into messages(complaint_id, body) values ($1,'언제 고쳐주나요')", [cid.id]));
await fails(as(B, () => one("insert into messages(complaint_id, body) values ($1,'x')", [cid.id])), /row-level/);
await as(F, () => one("insert into complaint_notes(complaint_id, body) values ($1,'내부메모')", [cid.id]));
await fails(as(A, () => one("insert into complaint_notes(complaint_id, body) values ($1,'x')", [cid.id])), /row-level/);
assert.equal((await as(A, () => one("select * from complaint_notes"))).length, 0);
// staff sees requester profile, other student does not
assert.equal((await as(F, () => one("select id from profiles where id=$1", [A]))).length, 1);
assert.equal((await as(B, () => one("select id from profiles where id=$1", [A]))).length, 0);
assert.equal((await as(ADM, () => one("select id from profiles"))).length, 6);
// reassign to college office → target filled from requester college
await fails(as(B, () => one("select reassign_complaint($1,'IT')", [cid.id])), /담당자만/);
await as(F, () => one("select reassign_complaint($1,'COLLEGE_OFFICE')", [cid.id]));
assert.equal((await one("select target_college from complaints where id=$1", [cid.id]))[0].target_college, "software");
assert.deepEqual([await sees(F), await sees(S), await sees(E)], [0, 1, 0]);
assert.equal((await as(S, () => one("select * from messages"))).length, 1);
assert.equal((await as(E, () => one("select * from messages"))).length, 0);
// non-office dept clears target_college
await fails(as(S, () => one("update complaints set department='IT' where id=$1", [cid.id])), /row-level/);
await as(S, () => one("select reassign_complaint($1,'IT','software')", [cid.id]));
assert.equal((await one("select target_college from complaints where id=$1", [cid.id]))[0].target_college, null);
// delete impossible
await as(A, () => one("delete from complaints where id=$1", [cid.id]));
assert.equal((await one("select count(*)::int n from complaints"))[0].n, 1);
// staff inserting with chosen department keeps it
const sc = (await as(F, () => one("insert into complaints(content, department) values ('우리 부서 건','FACILITY_REPAIR') returning department")))[0];
assert.equal(sc.department, "FACILITY_REPAIR");

// storage
await fails(as(B, () => one("insert into storage.objects(bucket_id,name) values ('complaint-files',$1)", [A + "/z.jpg"])), /row-level/);
await as(A, () => one("insert into storage.objects(bucket_id,name) values ('complaint-files',$1)", [A + "/p1.jpg"]));
const canRead = async (u) => (await as(u, () => one("select name from storage.objects"))).length;
await as(ADM, () => one("update complaints set department='FACILITY_REPAIR' where id=$1", [cid.id]));
assert.deepEqual([await canRead(A), await canRead(B), await canRead(F), await canRead(S)], [1, 0, 1, 0]);

console.log("ALL CHECKS PASSED");
