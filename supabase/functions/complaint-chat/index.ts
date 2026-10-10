// =====================================================================
// Edge Function: complaint-chat
//
// 민원 접수 채팅에서 사용자가 말을 보낼 때마다 앱이 부른다.
// 대화를 서버에 저장하지 않으므로, 앱이 매번 지금까지의 대화 전체를 보낸다.
//   const { data } = await supabase.functions.invoke('complaint-chat', {
//     body: { messages: [{ role: 'assistant', content: '안녕하세요…' }, { role: 'user', content: '…' }] },
//   })
//   // data = { reply: "쿠밍이의 말", draft: "접수할 민원 본문" 또는 null }
//
// 하는 일
//   1. 로그인한 사용자인지 확인 (로그인하지 않으면 401)
//   2. 받은 대화의 형식과 크기를 검사
//   3. chat.ts의 chat()을 부른다  ← 챗봇 규칙은 여기에만 있다
//   4. { reply, draft }를 돌려준다
//
// draft가 오면 앱은 "이 내용으로 접수하기" 버튼을 보여 주고, 누르면 지도 접수와 똑같이
// complaints에 저장(building_id는 null)한 뒤 classify-complaint를 부른다.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { chat, cleanMessages } from "./chat.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 로그인한 사용자만 쓸 수 있다 (ChatKHU 크레딧을 아무나 쓰지 못하게)
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "로그인이 필요해요" }, 401);

  const body = await req.json().catch(() => ({}));
  const messages = cleanMessages(body?.messages);
  if (!messages) return json({ error: "messages 형식이 올바르지 않아요" }, 400);

  try {
    return json(await chat(messages));
  } catch (e) {
    console.error("complaint-chat 실패", user.id, e);
    return json({ error: "지금은 답변을 만들 수 없어요. 잠시 후 다시 시도해 주세요." }, 500);
  }
});
