// =====================================================================
// 민원인 화면이 서버와 주고받는 함수 모음
// 화면 코드는 이 파일의 함수만 부른다. 서버 사용법은 supabase/README.md
//
// 아직 가짜인 것
//   - generateImage: 꾸미기 이미지 생성 (승원 담당). 지금은 샘플 그림을 돌려준다
//   - askComplaintAI: complaint-chat 함수가 배포되지 않았으면 안내 문구로 대신한다
// =====================================================================
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Status = 'received' | 'in_progress' | 'resolved'
export type Channel = 'chat' | 'chatbot_handoff' | 'form' | 'decorate'

export type Complaint = {
  id: string
  no: string
  content: string
  status: Status
  channel: Channel
  building_id: string | null
  photo_paths: string[]
  read_at: string | null
  resolved_at: string | null
  reopened_at: string | null
  created_at: string
  building: { name: string } | null
  dept: { name: string } | null
}

export type Message = { id: string; sender_id: string; body: string; kind: 'chat' | 'letter'; created_at: string }
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const BUCKET = 'complaint-files'
const COMPLAINT_FIELDS =
  'id, no, content, status, channel, building_id, photo_paths, read_at, resolved_at, reopened_at, created_at, building:buildings(name), dept:departments(name)'

// ---------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthChange(cb: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

// 학교 구글 계정. redirectPath: 로그인 뒤 돌아올 경로(민원인 '/', 직원 '/admin')
export async function signInWithGoogle(redirectPath: string) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${redirectPath}`, queryParams: { hd: 'khu.ac.kr' } },
  })
  if (error) throw error
}

// 심사·시연용 데모 계정(이메일·비밀번호)
export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 맞지 않아요' : error.message)
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getMyRole(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single()
  return data?.role ?? null
}

// ---------------------------------------------------------------------
// 첨부 파일
// ---------------------------------------------------------------------
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
}

// 경로는 반드시 "{내 user id}/..." (서버 규칙)
async function uploadImage(userId: string, file: Blob) {
  const ext = MIME_EXT[file.type]
  if (!ext) throw new Error('사진은 jpg·png·webp·heic만 올릴 수 있어요')
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw new Error(/size|large/i.test(error.message) ? '사진은 한 장에 10MB까지 올릴 수 있어요' : error.message)
  return path
}

// 비공개 버킷이라 볼 때마다 임시 주소(1시간)를 받는다
export async function signedUrls(paths: string[]) {
  if (paths.length === 0) return []
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60)
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u)
}

// ---------------------------------------------------------------------
// 민원 접수·수정
// ---------------------------------------------------------------------
type NewComplaint = {
  content: string
  buildingId: string | null
  photos: Blob[]
  channel: Channel
  chatbotLog?: { who: 'bot' | 'user'; text: string }[]
}

// 파일 업로드 → 민원 저장 → 분류 요청. 분류가 실패해도 접수는 된다
export async function submitComplaint(userId: string, c: NewComplaint) {
  const photo_paths = await Promise.all(c.photos.map((p) => uploadImage(userId, p)))
  const { data, error } = await supabase
    .from('complaints')
    .insert({
      content: c.content,
      building_id: c.buildingId,
      photo_paths,
      doc_paths: [],
      channel: c.channel,
      chatbot_log: c.chatbotLog ?? [],
    })
    .select('id, no')
    .single()
  if (error) throw error
  classify(data.id)
  return data as { id: string; no: string }
}

// 담당자가 받기 전에만 고칠 수 있다(서버가 막음). 고치면 다시 분류
export async function updateComplaint(id: string, content: string) {
  const { error } = await supabase.from('complaints').update({ content }).eq('id', id)
  if (error) throw error
  classify(id)
}

function classify(id: string) {
  supabase.functions.invoke('classify-complaint', { body: { complaint_id: id } }).catch(() => {})
}

// 처리 완료 후 7일 안에만. 같은 담당자에게 다시 간다
export async function reopenComplaint(id: string, body: string) {
  const { error } = await supabase.rpc('reopen_complaint', { complaint_id: id, body })
  if (error) throw error
}

// ---------------------------------------------------------------------
// 나의 활동
// ---------------------------------------------------------------------
export async function loadMyComplaints(userId: string): Promise<Complaint[]> {
  const { data, error } = await supabase
    .from('complaints')
    .select(COMPLAINT_FIELDS)
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Complaint[]
}

export async function loadMessages(complaintId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, body, kind, created_at')
    .eq('complaint_id', complaintId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as Message[]
}

export async function sendMessage(complaintId: string, body: string) {
  const { error } = await supabase.from('messages').insert({ complaint_id: complaintId, body })
  if (error) throw error
}

// 내 민원의 상태 변경(처리 완료 등)을 실시간으로 받는다
export function subscribeMyComplaints(userId: string, cb: (c: { id: string; status: Status }) => void) {
  const ch = supabase
    .channel(`my-complaints-${userId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints', filter: `requester_id=eq.${userId}` },
      ({ new: c }) => cb(c as { id: string; status: Status }))
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}

// 열려 있는 민원의 새 채팅을 실시간으로 받는다
export function subscribeMessages(complaintId: string, cb: (m: Message) => void) {
  const ch = supabase
    .channel(`chat-${complaintId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `complaint_id=eq.${complaintId}` },
      ({ new: m }) => cb(m as Message))
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}

// ---------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------
// 민원 접수 챗봇 "쿠밍이" (supabase/functions/complaint-chat)
// draft가 오면 "이 내용으로 접수하기"를 보여 준다
export async function askComplaintAI(messages: ChatTurn[]): Promise<{ reply: string; draft: string | null }> {
  const { data, error } = await supabase.functions.invoke('complaint-chat', { body: { messages } })
  if (!error && data && typeof data.reply === 'string') return { reply: data.reply, draft: data.draft ?? null }
  // 함수가 아직 배포되지 않았거나 실패하면, 사용자가 한 말을 그대로 접수할 수 있게 한다
  const said = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  return { reply: '지금은 AI 답변을 만들 수 없어요. 말씀하신 내용을 그대로 접수할 수 있어요.', draft: said || null }
}

// TODO(승원): 꾸미기 이미지 생성. 진짜 AI로 바꾸면 이 함수 안쪽만 바꾸면 된다
export async function generateImage(_prompt: string, _place: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 2000))
  return new URL('../../assets/deco_after.png', import.meta.url).href
}

// 꾸미기 "의견 전달하기": 꾸미기도 민원이다(channel 'decorate', 전후 이미지는 photo_paths)
export async function sendDecoration(
  userId: string,
  d: { content: string; buildingId: string | null; beforeUrl: string; afterUrl: string },
) {
  const [before, after] = await Promise.all([d.beforeUrl, d.afterUrl].map((u) => fetch(u).then((r) => r.blob())))
  return submitComplaint(userId, { content: d.content, buildingId: d.buildingId, photos: [before, after], channel: 'decorate' })
}
