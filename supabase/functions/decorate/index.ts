// 꾸미기 모드 AI Edge Function (decorate-mode-ai.md 2절 흐름 1~7)
//
// 요청 (POST, 로그인한 사용자 JWT 필요):
//   { session_id: uuid, building_id?: string, place_id?: number, map_x?: number, map_y?: number,
//     message: string, previous_ids?: uuid[] }
//   위치는 building_id(친구 서버 buildings.id, 예: plaza) 또는 place_id(map_no)로 준다.
//   map_x, map_y(지도 픽셀 좌표 = v4 × 4)는 개발용 지도 화면에서만 쓰는 예비 입력.
// 응답:
//   { type: 'edit', reply, request_id, before_url, after_url, bounds: {x, y, size}, place_name }
//   { type: 'question' | 'not_visual' | 'reject', reply, request_id, place_name }
//   { type: 'limit' | 'unavailable' | 'not_ready' | 'error', reply, retry? }
//
// 저장·삭제·초기화는 이 함수가 아니라 DB 함수 decorate_save / decorate_delete_latest / decorate_reset.
//
// 비밀값은 Supabase 서버 환경변수로만: DECORATE_CHATKHU_API_KEY (필수, 민원 쪽 CHATKHU_API_KEY와 크레딧 분리)
// 설정(선택, 기본값 있음): CLAUDE_MODEL, IMAGE_MODEL, IMAGE_MODEL_PRO, IMAGE_USE_PRO,
//   DAILY_LIMIT, MIN_CREDITS, PLACE_RADIUS

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { IMAGE_PROMPT_TEMPLATE, PLACES, SYSTEM_PROMPT } from './generated.ts';

const env = (k: string, d: string) => Deno.env.get(k) ?? d;
const KEY = Deno.env.get('DECORATE_CHATKHU_API_KEY') ?? '';
const GATEWAY = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
const CLAUDE_MODEL = env('CLAUDE_MODEL', 'claude-haiku-5-5');
const IMAGE_MODEL = env('IMAGE_USE_PRO', 'false') === 'true'
  ? env('IMAGE_MODEL_PRO', 'gemini-3-pro-image-preview')
  : env('IMAGE_MODEL', 'gemini-3.1-flash-image-preview');
const DAILY_LIMIT = Number(env('DAILY_LIMIT', '5'));
const MIN_CREDITS = Number(env('MIN_CREDITS', '500')); // 키 계정 잔액이 이 아래면 시연 계정 외 생성 중단
const PLACE_RADIUS = Number(env('PLACE_RADIUS', '400')); // 지도 픽셀. 좌표로 받을 때 이보다 멀면 "캠퍼스 일반 구역"
const CROP = 1024;
const TIMEOUT_MS = 30_000;

// 서버에 저장된 원본 지도 (Storage decorate-maps). 완성 지도(art/map_final.png, 6028×4176 = v4 × 4)를
// 1024 조각(r{행}_c{열}.png)으로 잘라 둔 것. 한 장을 통째로 열면 무료 서버 CPU 제한(2초)에 걸려서, 핀 주변 조각만 연다.
// 지도를 바꾸면: 조각을 다시 올리고 id 를 바꾼다 (예전 id 로 만든 꾸미기는 내 지도에 겹치지 않음)
const MAP = { id: 'final', prefix: 'final/', w: 6028, h: 4176, chunk: 1024 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const claude = new Anthropic({ apiKey: null, authToken: KEY, baseURL: `${GATEWAY}/claude` });

const MSG = {
  limit: `오늘은 꾸미기를 ${DAILY_LIMIT}번 모두 사용했어요. 내일 다시 만들어 주세요.`,
  unavailable: '지금은 그림을 만들 수 있는 크레딧이 부족해서 꾸미기를 잠시 쉬고 있어요.',
  notReady: '이 자리는 지도 밖이라 꾸밀 수 없어요. 지도 안을 눌러 주세요.',
  error: '그림을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
};

// ---------- 장소, 자르기 ----------

type Place = { id: number | null; building_id: string | null; name: string; x: number; y: number };

function placeFromRequest(body: any): Place | null {
  const byId = typeof body.building_id === 'string'
    ? PLACES.find(p => p.building_id === body.building_id)
    : Number.isInteger(body.place_id) ? PLACES.find(p => p.id === body.place_id) : undefined;
  if (byId) return { ...byId };
  const x = Number(body.map_x), y = Number(body.map_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null as null | (typeof PLACES)[number];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  const near = best && bestD <= PLACE_RADIUS;
  return { id: near ? best!.id : null, building_id: near ? best!.building_id : null,
    name: near ? best!.name : '캠퍼스 일반 구역', x: Math.round(x), y: Math.round(y) };
}

const chunkCache = new Map<string, Image>(); // 같은 인스턴스가 다시 불리면 디코딩 생략

async function loadChunk(r: number, c: number) {
  const path = `${MAP.prefix}r${r}_c${c}.png`;
  const hit = chunkCache.get(path);
  if (hit) return hit;
  const { data, error } = await admin.storage.from('decorate-maps').download(path);
  if (error || !data) throw new Error(`원본 지도 조각 읽기 실패 ${path}: ${error?.message}`);
  const img = await Image.decode(new Uint8Array(await data.arrayBuffer()));
  chunkCache.set(path, img);
  return img;
}

// 원본 지도의 box 영역(지도 픽셀 좌표)을 조각들에서 이어 붙여 만든다 (최대 2×2 조각)
async function originalCrop(box: { x: number; y: number; size: number }) {
  const out = new Image(box.size, box.size);
  const C = MAP.chunk;
  for (let r = Math.floor(box.y / C); r <= Math.floor((box.y + box.size - 1) / C); r++) {
    for (let c = Math.floor(box.x / C); c <= Math.floor((box.x + box.size - 1) / C); c++) {
      out.composite(await loadChunk(r, c), c * C - box.x, r * C - box.y);
    }
  }
  return out;
}

// 누른 지점이 가운데, 지도 가장자리에서는 안쪽으로 밀어서 1024×1024
function cropBox(x: number, y: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return { x: clamp(Math.round(x - CROP / 2), 0, MAP.w - CROP), y: clamp(Math.round(y - CROP / 2), 0, MAP.h - CROP), size: CROP };
}

// 화면의 CSS mask 와 같은 모양: 가장자리 10%에서 0→1로 섞고, 가로·세로 값을 곱한다
const ramp = (t: number) => (t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1);

// "내 지도" 바탕 = 원본 조각 위에 저장한 꾸미기를 저장 순서대로 겹친 것 (같은 세션 것은 제외)
async function myMapCrop(box: { x: number; y: number; size: number }, userId: string, sessionId: string) {
  const base = await originalCrop(box);
  const { data: rows, error } = await admin.from('decorate_requests')
    .select('id, result_path, crop_x, crop_y, crop_size')
    .eq('user_id', userId).eq('map_id', MAP.id).not('saved_at', 'is', null).is('hidden_at', null)
    .neq('session_id', sessionId)
    .lt('crop_x', box.x + CROP).gt('crop_x', box.x - CROP)
    .lt('crop_y', box.y + CROP).gt('crop_y', box.y - CROP)
    .order('saved_at', { ascending: true });
  if (error) throw new Error(`내 지도 읽기 실패: ${error.message}`);
  const B = base.bitmap;
  for (const r of rows ?? []) {
    const { data } = await admin.storage.from('decorate-results').download(r.result_path);
    if (!data) continue;
    const ov = await Image.decode(new Uint8Array(await data.arrayBuffer()));
    const n = r.crop_size as number;
    if (ov.width !== n || ov.height !== n) ov.resize(n, n);
    const O = ov.bitmap;
    const dx = r.crop_x - box.x, dy = r.crop_y - box.y; // 조각의 왼쪽 위 (바탕 좌표)
    for (let y = Math.max(0, dy); y < Math.min(CROP, dy + n); y++) {
      const ay = ramp((y - dy + 0.5) / n);
      for (let x = Math.max(0, dx); x < Math.min(CROP, dx + n); x++) {
        const a = ay * ramp((x - dx + 0.5) / n);
        if (a <= 0) continue;
        const bi = (y * CROP + x) * 4, oi = ((y - dy) * n + (x - dx)) * 4;
        B[bi] += (O[oi] - B[bi]) * a;
        B[bi + 1] += (O[oi + 1] - B[bi + 1]) * a;
        B[bi + 2] += (O[oi + 2] - B[bi + 2]) * a;
      }
    }
  }
  return { image: base, layers: rows?.length ?? 0 };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// ---------- Claude ----------

type ClaudeResult = {
  type: 'edit' | 'question' | 'not_visual' | 'reject';
  reply: string; change: string; location: string; details: string[]; summary: string;
};

function parseClaude(text: string): ClaudeResult | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let o: any;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!['edit', 'question', 'not_visual', 'reject'].includes(o?.type)) return null;
  if (typeof o.reply !== 'string' || !o.reply.trim()) return null;
  if (o.type === 'edit') {
    if (typeof o.change !== 'string' || !o.change.trim()) return null;
    if (typeof o.location !== 'string' || !o.location.trim()) return null;
    if (!Array.isArray(o.details) || !o.details.length || o.details.some((d: unknown) => typeof d !== 'string')) return null;
  }
  return {
    type: o.type, reply: o.reply.trim(), change: o.change ?? '', location: o.location ?? '',
    details: o.details ?? [], summary: typeof o.summary === 'string' ? o.summary : '',
  };
}

async function askClaude(placeName: string, previous: string[], message: string, cropB64: string, signal: AbortSignal) {
  const system = SYSTEM_PROMPT
    .replace('{{place_name}}', placeName)
    .replace('{{previous_requests}}', previous.length ? previous.map(s => `"${s}"`).join(', ') : '없음')
    .replace('{{user_message}}', message);
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: cropB64 } },
      { type: 'text', text: message },
    ],
  }];
  // JSON 형식이 틀리면 1회 재시도, 그래도 틀리면 실패
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await claude.messages.create(
      { model: CLAUDE_MODEL, max_tokens: 2048, system, messages },
      { signal, maxRetries: 0 },
    );
    const text = res.content.find(b => b.type === 'text')?.text ?? '';
    const parsed = parseClaude(text);
    if (parsed) return { parsed, raw: text };
    messages.push({ role: 'assistant', content: text || '(빈 응답)' });
    messages.push({ role: 'user', content: '출력 형식이 틀렸어. 지시한 JSON 하나만 다시 출력해.' });
  }
  throw new Error('Claude 응답 JSON 형식 오류 (재시도 후에도)');
}

// ---------- 나노바나나 ----------

function buildImagePrompt(r: ClaudeResult) {
  return IMAGE_PROMPT_TEMPLATE
    .replace('{{change}}', r.change)
    .replace('{{location}}', r.location)
    .replace(/\{\{details[^}]*\}\}/, r.details.map(d => `- ${d}`).join('\n'));
}

async function remainingCredits(signal: AbortSignal) {
  const res = await fetch(`${GATEWAY}/credits/`, { headers: { Authorization: `Bearer ${KEY}` }, signal });
  if (!res.ok) throw new Error(`크레딧 확인 실패: HTTP ${res.status}`);
  return Number((await res.json())?.total?.remaining ?? 0);
}

async function generateImage(prompt: string, cropB64: string, signal: AbortSignal) {
  // ChatKHU 전용 이미지 엔드포인트 (decorate-mode-ai.md 6절)
  const res = await fetch(`${GATEWAY}/images/generate/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL, prompt, number_of_images: 1, image_size: '1K', aspect_ratio: '1:1',
      input_images: [`data:image/png;base64,${cropB64}`],
    }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`나노바나나 HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  const item = body?.data?.[0];
  const m = String(item?.url ?? '').match(/^data:image\/\w+;base64,(.+)$/);
  const b64 = m?.[1] ?? item?.b64_json;
  if (!b64) throw new Error('나노바나나 응답에 이미지가 없음');
  return { bytes: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), credits: Number(body.credits_charged ?? 0) };
}

// 결과를 1024×1024 JPEG로 맞춘다 (이미 맞으면 그대로)
async function normalizeResult(bytes: Uint8Array) {
  const img = await Image.decode(bytes);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (img.width === CROP && img.height === CROP && isJpeg) return bytes;
  if (img.width !== CROP || img.height !== CROP) img.resize(CROP, CROP);
  return await img.encodeJPEG(92);
}

// ---------- 요청 처리 ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kstMidnightIso() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000).toISOString();
}

async function isDemoUser(email: string | undefined) {
  if (!email) return false;
  const { data } = await admin.from('allowed_emails').select('email').ilike('email', email).maybeSingle();
  return !!data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 가능' }, 405);
  const t0 = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: '로그인이 필요해요' }, 401);

  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.session_id ?? '');
  const message = String(body.message ?? '').trim();
  const place = placeFromRequest(body);
  if (!UUID.test(sessionId) || !place || !message || message.length > 300) {
    return json({ error: '요청 형식이 잘못됐어요' }, 400);
  }
  if (place.x < 0 || place.y < 0 || place.x >= MAP.w || place.y >= MAP.h) return json({ type: 'not_ready', reply: MSG.notReady, place_name: place.name });

  const isDemo = await isDemoUser(user.email);

  // 1) 오늘 사용 횟수 (이미지 생성이 일어난 요청만)
  if (!isDemo) {
    const { count } = await admin.from('decorate_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).not('result_path', 'is', null).gte('created_at', kstMidnightIso());
    if ((count ?? 0) >= DAILY_LIMIT) return json({ type: 'limit', reply: MSG.limit });
  }

  const box = cropBox(place.x, place.y);

  // 이번 세션의 이전 요청 (오래된 순). 화면이 지금 반영 중인 요청 id만 보낸다.
  // 거절·민원은 최종 상태에 합치지 않는다
  const previousIds = (Array.isArray(body.previous_ids) ? body.previous_ids : [])
    .map(String).filter((id: string) => UUID.test(id)).slice(-10);
  const { data: prevRows } = previousIds.length
    ? await admin.from('decorate_requests').select('message')
      .in('id', previousIds).eq('session_id', sessionId).eq('user_id', user.id)
      .in('request_type', ['edit', 'question']).order('created_at', { ascending: true })
    : { data: [] };
  const previous = (prevRows ?? []).map(r => r.message as string);

  const { data: row, error: insErr } = await admin.from('decorate_requests').insert({
    user_id: user.id, session_id: sessionId, map_x: place.x, map_y: place.y,
    map_id: MAP.id, crop_x: box.x, crop_y: box.y, crop_size: box.size, place_id: place.id, building_id: place.building_id,
    place_name: place.name, message, claude_model: CLAUDE_MODEL,
  }).select('id').single();
  if (insErr || !row) return json({ type: 'error', reply: MSG.error, retry: true, detail: insErr?.message }, 500);
  const update = (fields: Record<string, unknown>) =>
    admin.from('decorate_requests').update({ ...fields, elapsed_ms: Date.now() - t0 }).eq('id', row.id);

  try {
    // 2) 내 지도(원본 + 저장한 꾸미기)에서 잘라내기
    const { image: crop } = await myMapCrop(box, user.id, sessionId);
    const cropPng = await crop.encode(1);
    const cropB64 = toBase64(cropPng);

    // 3) Claude 판단
    const { parsed } = await askClaude(place.name, previous, message, cropB64, signal);

    // 4) edit가 아니면 말풍선만 (횟수 안 셈)
    if (parsed.type !== 'edit') {
      await update({ claude_json: parsed, request_type: parsed.type });
      return json({ type: parsed.type, reply: parsed.reply, request_id: row.id, place_name: place.name });
    }

    // 크레딧 기준 (시연 계정은 통과)
    if (!isDemo && (await remainingCredits(signal)) < MIN_CREDITS) {
      await update({ claude_json: parsed, request_type: parsed.type, error: 'credits_below_minimum' });
      return json({ type: 'unavailable', reply: MSG.unavailable, request_id: row.id });
    }

    // 5) 고정 틀에 빈칸 채우기 → 6) 나노바나나
    const prompt = buildImagePrompt(parsed);
    const gen = await generateImage(prompt, cropB64, signal);

    // 7) 1024×1024로 맞추고 Storage에 꾸미기 전·후 저장, 기록
    const after = await normalizeResult(gen.bytes);
    const before = await crop.encodeJPEG(90);
    const afterPath = `${user.id}/${row.id}.jpg`;
    const beforePath = `${user.id}/${row.id}_before.jpg`;
    const store = admin.storage.from('decorate-results');
    for (const [path, bytes] of [[afterPath, after], [beforePath, before]] as const) {
      const { error } = await store.upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(`결과 저장 실패: ${error.message}`);
    }
    await update({
      claude_json: parsed, request_type: 'edit', final_prompt: prompt, result_path: afterPath, before_path: beforePath,
      image_model: IMAGE_MODEL, credits_charged: gen.credits,
    });
    return json({
      type: 'edit', reply: parsed.reply, request_id: row.id, place_name: place.name, bounds: box,
      before_url: store.getPublicUrl(beforePath).data.publicUrl,
      after_url: store.getPublicUrl(afterPath).data.publicUrl,
    });
  } catch (e) {
    const timedOut = signal.aborted;
    await update({ error: `${timedOut ? '[30초 초과] ' : ''}${e instanceof Error ? e.message : String(e)}`.slice(0, 1000) });
    return json({ type: 'error', reply: MSG.error, retry: true, request_id: row.id });
  }
});
