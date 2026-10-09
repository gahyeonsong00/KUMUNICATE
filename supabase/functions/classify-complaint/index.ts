// =====================================================================
// Edge Function: classify-complaint
//
// 앱이 민원을 저장한 직후(또는 민원인이 본문을 고친 직후) 부른다.
//   await supabase.functions.invoke('classify-complaint', { body: { complaint_id } })
//
// 하는 일
//   1. 부른 사람이 그 민원을 볼 수 있는지 확인 (본인 로그인 토큰으로 조회 → RLS 적용)
//   2. DB에서 docs/decisions.md 형식의 입력 JSON을 만든다
//   3. classify.ts의 classify()를 부른다  ← 분류 로직은 여기에만 있다
//   4. 결과를 complaints의 department, target_college, ai_confidence, ai_summary에 저장
//   5. 분류 결과(출력 JSON)를 그대로 돌려준다
//
// 분류가 실패해도 민원은 이미 저장돼 있다(부서 칸만 비어 있음 → admin이 배정).
// 직원이 부서를 직접 고른 민원(department 있음 + ai_confidence 없음)과
// 담당자가 이미 확인한 민원(read_at 있음)은 다시 분류하지 않는다.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { classify } from "./classify.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const { complaint_id } = await req.json().catch(() => ({}));
  if (typeof complaint_id !== "string") return json({ error: "complaint_id가 필요해요" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  // 부른 사람 권한으로 조회: 볼 수 없는 민원이면 결과가 비어 있다
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  // 저장은 서버 권한으로 (분류 결과 칸은 앱에서 못 바꾸게 막혀 있다)
  const asServer = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: c } = await asUser
    .from("complaints")
    .select("id, content, building_id, requester_id, department, ai_confidence, read_at")
    .eq("id", complaint_id)
    .maybeSingle();
  if (!c) return json({ error: "민원을 찾을 수 없어요" }, 404);
  if (c.department && c.ai_confidence === null) return json({ skipped: "직원이 부서를 직접 고른 민원" });
  if (c.read_at) return json({ skipped: "담당자가 이미 확인한 민원(재배정 결과를 덮어쓰지 않음)" });

  const { data: p } = await asServer
    .from("profiles")
    .select("user_type, college_code, major")
    .eq("id", c.requester_id)
    .single();

  try {
    const out = await classify({
      complaint_id: c.id,
      content: c.content,
      building_id: c.building_id,
      requester: { type: p?.user_type ?? null, college: p?.college_code ?? null, department: p?.major ?? null },
    });
    const { error } = await asServer
      .from("complaints")
      .update({
        department: out.department,
        target_college: out.target_college,
        ai_confidence: out.confidence,
        ai_summary: out.summary || null,
      })
      .eq("id", c.id);
    if (error) throw error;
    return json(out);
  } catch (e) {
    console.error("classify-complaint 실패", complaint_id, e);
    return json({ error: "분류에 실패했어요. 민원은 접수됐고 담당자가 직접 배정합니다." }, 500);
  }
});
