import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { InlineLoading, InlineNotification, Button } from '@carbon/react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import AdminShell from './AdminShell'
import type { BoardRow, Channel, ComplaintRow, Me, Status } from './types'

// 직원 화면 데이터: 로그인 확인 → 내 민원·부서 현황·대기 건수를 서버에서 읽고, 행동은 서버 함수로 한다
type Store = {
  me: Me
  rows: ComplaintRow[]
  board: BoardRow[]
  queue: { mine: number; unassigned: number; oldest: Date | null }
  departments: { code: string; name: string }[]
  claimNext: () => Promise<string | null>
  release: (id: string) => Promise<void>
  transfer: (id: string, department: string, reason: string, note: string) => Promise<void>
  resolve: (id: string, letter?: string) => Promise<void>
  sendChat: (id: string, text: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

const BOT_WHO: Record<string, string> = { bot: 'AI 챗봇', user: '민원인' }
// 목록 제목: AI 요약의 첫 문장, 없으면 원문
const titleOf = (summary: string | null, content: string) => (summary ?? content).split(/(?<=[.!?])\s/)[0].replace(/\.$/, '')

const COMPLAINT_FIELDS = `id, no, created_at, content, channel, chatbot_log, department, ai_confidence, ai_summary,
  status, reopened_at, resolved_at, photo_paths,
  building:buildings(name), dept:departments(name),
  requester:profiles!complaints_requester_id_fkey(display_name, email, major, college:colleges!profiles_college_code_fkey(name)),
  messages(sender_id, body, kind, created_at)`

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase 조인 결과를 화면 모양으로 펼치는 한 곳 */
function toRow(c: any, me: Me): ComplaintRow {
  const msgs = [...(c.messages ?? [])].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
  const chats = msgs.filter((m: any) => m.kind === 'chat')
  const letters = msgs.filter((m: any) => m.kind === 'letter').map((m: any) => ({ body: m.body, at: new Date(m.created_at) }))
  const reopenedAt = c.reopened_at ? new Date(c.reopened_at) : null
  const prevLetter = reopenedAt && letters.filter((l) => l.at < reopenedAt).at(-1)
  const r = c.requester ?? {}
  return {
    id: c.id,
    no: c.no,
    createdAt: new Date(c.created_at),
    where: c.building?.name ?? '위치 없음',
    channel: c.channel as Channel,
    summary: titleOf(c.ai_summary, c.content),
    departmentCode: c.department,
    department: c.dept?.name ?? '분류 전',
    confidence: c.ai_confidence,
    status: c.status as Status,
    reopened: !!reopenedAt,
    body: c.content,
    aiSummary: c.ai_summary ?? 'AI 요약이 아직 없습니다.',
    requester: {
      name: r.display_name ?? '이름 없음',
      email: r.email ?? '',
      affiliation: [r.college?.name, r.major].filter(Boolean).join(' '),
    },
    bot: (c.chatbot_log ?? []).map((b: any) => ({ who: BOT_WHO[b.who] ?? b.who, text: b.text })),
    chatOn: c.channel === 'chat' || c.channel === 'chatbot_handoff' || chats.length > 0,
    talk: chats.map((m: any) => ({
      who: m.sender_id === me.id ? `${me.name} (${me.department})` : '민원인',
      text: m.body,
      mine: m.sender_id === me.id,
    })),
    letters,
    photoPaths: c.photo_paths ?? [],
    prev: prevLetter && reopenedAt ? { resolvedAt: prevLetter.at, answer: prevLetter.body, reopenedAt } : undefined,
    resolvedAt: c.resolved_at ? new Date(c.resolved_at) : undefined,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const must = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message)
  return data
}

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<Me | null | 'not-staff'>(null)
  const [data, setData] = useState<Omit<Store, 'me' | 'claimNext' | 'release' | 'transfer' | 'resolve' | 'sendChat' | 'signOut'> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // 로그인한 사람이 부서 직원인지 확인
  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('id, display_name, role, department, dept:departments(name)')
      .eq('id', session.user.id)
      .single()
      .then(({ data: p, error }) => {
        if (error || !p) return setError(error?.message ?? '프로필을 찾을 수 없습니다')
        if (p.role !== 'staff' || !p.department) return setMe('not-staff')
        const dept = p.dept as unknown as { name: string } | null
        setMe({ id: p.id, name: p.display_name ?? session.user.email ?? '직원', departmentCode: p.department, department: dept?.name ?? p.department })
      })
  }, [session])

  const refresh = useCallback(async () => {
    if (!me || me === 'not-staff') return
    try {
      const [rows, board, queue, departments] = await Promise.all([
        supabase.from('complaints').select(COMPLAINT_FIELDS).eq('assignee_id', me.id).order('created_at').then(must),
        supabase.rpc('department_board').then(must),
        supabase.rpc('queue_status').then(must),
        supabase.from('departments').select('code, name').order('name').then(must),
      ])
      const q = (queue as { mine: number; unassigned: number; oldest: string | null }[])[0]
      setData({
        rows: (rows as unknown[]).map((c) => toRow(c, me)),
        board: (board as { no: string; created_at: string; summary: string | null; assignee_name: string | null; assignee_id: string | null; status: Status; resolved_at: string | null; reopened_at: string | null }[]).map((b) => ({
          no: b.no,
          createdAt: new Date(b.created_at),
          summary: b.summary,
          owner: b.assignee_id ? (b.assignee_name ?? '이름 없음') : null,
          status: b.status,
          resolvedAt: b.resolved_at ? new Date(b.resolved_at) : undefined,
          reopened: !!b.reopened_at,
        })),
        queue: { mine: q?.mine ?? 0, unassigned: q?.unassigned ?? 0, oldest: q?.oldest ? new Date(q.oldest) : null },
        departments: departments as { code: string; name: string }[],
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [me])

  // 내 민원·채팅은 실시간으로, 대기 건수·부서 현황은 30초마다 다시 읽는다
  // shortcut: 남의 민원 변경은 RLS 때문에 실시간으로 안 오므로 30초 폴링. 느리면 Realtime broadcast로 바꾼다
  useEffect(() => {
    if (!me || me === 'not-staff') return
    refresh()
    const ch = supabase
      .channel(`admin-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints', filter: `assignee_id=eq.${me.id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .subscribe()
    const t = setInterval(refresh, 30_000)
    return () => {
      clearInterval(t)
      supabase.removeChannel(ch)
    }
  }, [me, refresh])

  if (session === null) return <Navigate to="/admin/login" replace />
  if (me === 'not-staff')
    return (
      <AdminShell>
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="부서 직원 계정이 아닙니다"
          subtitle="직원 화면은 운영 계정이 부서 직원으로 지정한 계정만 쓸 수 있습니다. 민원을 내려면 민원인 화면을 이용하세요."
        />
        <Button kind="ghost" onClick={() => supabase.auth.signOut()}>
          다른 계정으로 로그인
        </Button>
      </AdminShell>
    )
  if (!me || !data)
    return (
      <AdminShell>
        {error ? (
          <InlineNotification kind="error" lowContrast hideCloseButton title="서버에서 민원을 불러오지 못했습니다" subtitle={error} />
        ) : (
          <InlineLoading description="민원을 불러오는 중" />
        )}
      </AdminShell>
    )

  const act = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) throw new Error(error.message)
    await refresh()
  }

  const store: Store = {
    me,
    ...data,
    claimNext: async () => {
      const { data: id, error } = await supabase.rpc('claim_next_complaint')
      if (error) throw new Error(error.message)
      if (!id) return null
      const { data: c } = await supabase.from('complaints').select('no').eq('id', id).single()
      await refresh()
      return c?.no ?? null
    },
    release: (id) => act(supabase.rpc('release_complaint', { complaint_id: id })),
    transfer: (id, department, reason, note) =>
      act(supabase.rpc('reassign_complaint', { complaint_id: id, new_department: department, reason, note: note || null })),
    resolve: (id, letter) => act(supabase.rpc('resolve_complaint', { complaint_id: id, letter: letter ?? null })),
    sendChat: (id, text) => act(supabase.from('messages').insert({ complaint_id: id, body: text })),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useAdminStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('AdminStoreProvider 밖에서 useAdminStore를 썼습니다')
  return s
}

// 로그인 화면처럼 저장소 밖에서도 쓰는 틀(AdminShell)용
export const useOptionalAdminStore = () => useContext(Ctx)
