import { useCallback, useEffect, useState } from 'react'
import {
  loadMessages, loadMyComplaints, reopenComplaint, sendMessage, signedUrls, subscribeMessages, subscribeMyComplaints,
  updateComplaint, type Complaint, type Message, type Status,
} from './api'
import type { Toast } from './CitizenApp'
import { MAX_BYTE, countBytes, errorText, formatDateTime, formatTime, preview } from './util'
import mascotPair from '../../assets/mascot_pair.png'
import kumingHead from '../../assets/kuming_head.png'

// 탭 이름은 민원인 화면 표기. 바뀌는 때는 docs/decisions.md '민원 배정과 상태'
const TABS: { status: Status; label: string; empty: string }[] = [
  { status: 'received', label: '접수 완료', empty: '아직 접수한 민원이 없습니다.' },
  { status: 'in_progress', label: '해결 중', empty: '아직 해결 중인 민원이 없습니다.' },
  { status: 'resolved', label: '해결 완료', empty: '아직 해결 완료된 민원이 없습니다.' },
]
const REOPEN_DAYS = 7

// 빨간 점: 지금 상태를 펼쳐 봤는지. 상태가 바뀌면 다시 빨간 점이 된다 (이 브라우저에만 저장)
function useSeen(userId: string) {
  const key = `khu-grow:seen:${userId}`
  const [seen, setSeen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { return new Set() }
  })
  const markSeen = (c: Complaint) => {
    const k = `${c.id}:${c.status}`
    if (seen.has(k)) return
    const next = new Set(seen).add(k)
    setSeen(next)
    try { localStorage.setItem(key, JSON.stringify([...next])) } catch { /* 저장 못 해도 화면은 동작 */ }
  }
  return [(c: Complaint) => seen.has(`${c.id}:${c.status}`), markSeen] as const
}

type Props = { userId: string; toast: Toast; onBack: () => void }

export default function ActivityScreen({ userId, toast, onBack }: Props) {
  const [list, setList] = useState<Complaint[] | null>(null)
  const [tab, setTab] = useState<Status>('received')
  const [openId, setOpenId] = useState<string | null>(null)
  const [isSeen, markSeen] = useSeen(userId)

  const reload = useCallback(async () => {
    try {
      setList(await loadMyComplaints(userId))
    } catch {
      toast('민원 목록을 불러오지 못했어요')
      setList((l) => l ?? [])
    }
  }, [userId, toast])

  // 들어올 때마다 새로 받고, 보고 있는 동안 상태가 바뀌면 다시 받는다
  useEffect(() => {
    reload()
    return subscribeMyComplaints(userId, (c) => {
      if (c.status === 'resolved') toast('민원이 해결됐어요!')
      reload()
    })
  }, [userId, reload, toast])

  // 성장 카드: 해결 완료 개수로 레벨과 칸 계산
  const solved = list?.filter((c) => c.status === 'resolved').length ?? 0
  const lv = 1 + Math.floor(solved / 10)
  const cells = solved % 10
  const items = list?.filter((c) => c.status === tab) ?? []
  const current = TABS.find((t) => t.status === tab)!

  return (
    <div id="activityScreen" className="screen">
      <div id="actBar" className="panel">
        <button className="btn3" type="button" aria-label="지도로" onClick={onBack}>←</button>
        <b>나의 활동</b>
      </div>
      <div id="actBody">
        <div id="growCard" className="plate">
          <div id="growPic" className="slot"><img className="crisp bob" src={mascotPair} alt="쿠옹이와 쿠밍이" /></div>
          <div id="growInfo">
            <div id="growLine"><span id="growLv">캠퍼스 성장 Lv.{lv}</span><span id="growNum">{cells}/10</span></div>
            <div id="growBar">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < cells ? 'on' : undefined} />)}</div>
            <div id="growHint">민원이 해결될 때마다 캠퍼스가 한 칸씩 자라요</div>
          </div>
        </div>

        <div id="actTabs">
          {TABS.map((t) => (
            <button key={t.status} type="button" className={t.status === tab ? 'btn' : 'btn3'}
              onClick={() => { setTab(t.status); setOpenId(null) }}>{t.label}</button>
          ))}
        </div>

        {list === null ? (
          <div className="panel empty">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="panel empty"><img className="crisp" src={kumingHead} alt="" />{current.empty}</div>
        ) : items.map((c) => (
          <ComplaintCard key={c.id} c={c} userId={userId} toast={toast} open={openId === c.id} seen={isSeen(c)}
            onToggle={() => {
              if (openId === c.id) { setOpenId(null); return }
              markSeen(c)
              setOpenId(c.id)
            }}
            onChanged={reload} />
        ))}
      </div>
    </div>
  )
}

type CardProps = {
  c: Complaint; userId: string; toast: Toast; open: boolean; seen: boolean; onToggle: () => void; onChanged: () => void
}

function placeLabel(c: Complaint) {
  if (c.channel === 'decorate') return `꾸미기${c.building ? ` · ${c.building.name}` : ''}`
  if (c.building) return c.building.name
  return c.channel === 'form' ? '장소 없음' : '채팅 접수'
}

function ComplaintCard({ c, userId, toast, open, seen, onToggle, onChanged }: CardProps) {
  return (
    <div className="panel card">
      <div className="cHead" onClick={onToggle}>
        <div className="cTop">
          <span className={`dot${seen ? ' read' : ''}`} />
          <span className="sub">{placeLabel(c)}</span>
          {c.reopened_at && <span className="badge">재접수</span>}
        </div>
        <div className="cText">{open ? c.content : preview(c.content)}</div>
        <div className="cFoot sub"><span>접수일시: {formatDateTime(c.created_at)}</span><span>{open ? '△' : '▽'}</span></div>
      </div>
      {open && <Detail c={c} userId={userId} toast={toast} onChanged={onChanged} />}
    </div>
  )
}

function Detail({ c, userId, toast, onChanged }: { c: Complaint; userId: string; toast: Toast; onChanged: () => void }) {
  const [photos, setPhotos] = useState<string[]>([])
  const [msgs, setMsgs] = useState<Message[]>([])
  // 목록을 다시 받으면 배열이 새로 생기므로 내용으로 비교한다
  const photoKey = c.photo_paths.join('|')

  useEffect(() => {
    let alive = true
    signedUrls(photoKey ? photoKey.split('|') : []).then((u) => alive && setPhotos(u))
    return () => { alive = false }
  }, [photoKey])

  useEffect(() => {
    if (c.status === 'received') return
    let alive = true
    loadMessages(c.id).then((m) => alive && setMsgs(m)).catch(() => {})
    const off = subscribeMessages(c.id, (m) => setMsgs((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m])))
    return () => { alive = false; off() }
  }, [c.id, c.status])

  const chats = msgs.filter((m) => m.kind === 'chat')
  const letters = msgs.filter((m) => m.kind === 'letter')
  const dept = c.dept?.name ?? '담당자'

  return (
    <div className="detail">
      {photos.length > 0 && (
        <div className="photos">{photos.map((u) => <img key={u} className="crisp" src={u} alt="첨부 사진" />)}</div>
      )}

      {c.status === 'received' && (
        <>
          <div>담당 부서에 전달되었어요. 담당자가 맡으면 '해결 중'으로 옮겨져요.</div>
          {/* 담당자가 받기 전(read_at 없음)에만 고칠 수 있다 */}
          {!c.read_at && <EditForm c={c} toast={toast} onChanged={onChanged} />}
        </>
      )}

      {c.status !== 'received' && chats.length > 0 && (
        <>
          <div className="plate miniPlate">{dept} 담당자와의 채팅</div>
          <div className="dChat">
            {chats.map((m) => (m.sender_id === userId ? (
              <div key={m.id} className="dRowR"><span className="dName">나</span>
                <div className="bubble me">{m.body}</div><span className="time">{formatTime(m.created_at)}</span></div>
            ) : (
              <div key={m.id} className="dRowL"><span className="dName">{dept} 담당자</span>
                <div className="bubble ai">{m.body}</div><span className="time">{formatTime(m.created_at)}</span></div>
            )))}
          </div>
        </>
      )}

      {c.status === 'in_progress' && (
        <>
          {chats.length === 0 && <div>{dept} 담당자가 확인하고 있어요. 더 알릴 내용이 있으면 남겨 주세요.</div>}
          <ReplyForm placeholder="담당자에게 메시지 보내기" button="보내기" toast={toast}
            onSend={(t) => sendMessage(c.id, t)} />
        </>
      )}

      {c.status === 'resolved' && (
        <>
          {letters.map((m) => (
            <div key={m.id} className="letter"><b>공식 답변 · {formatDateTime(m.created_at)}</b>{m.body}</div>
          ))}
          <div className="solved"><b>+1</b>소중한 민원 수리되었습니다. 경희대를 키워주셔서 감사합니다!</div>
          <Reopen c={c} toast={toast} onChanged={onChanged} />
        </>
      )}
    </div>
  )
}

function EditForm({ c, toast, onChanged }: { c: Complaint; toast: Toast; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.content)
  const [saving, setSaving] = useState(false)
  const bytes = countBytes(text)

  if (!editing) return <button className="btn3 actBtn" type="button" onClick={() => setEditing(true)}>수정하기</button>

  const save = async () => {
    const t = text.trim()
    if (!t || bytes > MAX_BYTE) return
    setSaving(true)
    try {
      await updateComplaint(c.id, t)
      toast('수정했어요')
      setEditing(false)
      onChanged()
    } catch (e) {
      // 그 사이 담당자가 받았으면 서버가 막는다
      toast(errorText(e, '수정하지 못했어요. 다시 시도해 주세요'))
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="inlineForm">
      <textarea className="slot" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="byteFoot">
        <span className={`byteCount${bytes > MAX_BYTE ? ' over' : ''}`}>{bytes}/{MAX_BYTE}byte</span>
        <div className="inlineRow">
          <button className="btn3" type="button" onClick={() => { setText(c.content); setEditing(false) }}>취소</button>
          <button className="btn" type="button" disabled={saving || !text.trim() || bytes > MAX_BYTE} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  )
}

// 처리 완료 후 7일 안에만 재문의. 같은 민원을 다시 열고 같은 담당자에게 간다
function Reopen({ c, toast, onChanged }: { c: Complaint; toast: Toast; onChanged: () => void }) {
  const [opening, setOpening] = useState(false)
  const [now] = useState(() => Date.now())
  const left = c.resolved_at ? REOPEN_DAYS * 864e5 - (now - new Date(c.resolved_at).getTime()) : 0
  if (left <= 0) return <span className="sub">처리 완료 후 7일이 지나 재접수할 수 없어요. 새 민원으로 접수해 주세요.</span>
  if (!opening) return <button className="btn3 actBtn" type="button" onClick={() => setOpening(true)}>재접수</button>
  return (
    <ReplyForm placeholder="무엇이 아직 불편한가요?" button="재접수" toast={toast}
      onSend={async (t) => {
        await reopenComplaint(c.id, t)
        toast('재접수했어요. 같은 담당자에게 다시 전달돼요')
        onChanged()
      }} />
  )
}

function ReplyForm({ placeholder, button, toast, onSend }: {
  placeholder: string; button: string; toast: Toast; onSend: (text: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await onSend(t)
      setText('')
    } catch (e) {
      toast(errorText(e, '보내지 못했어요. 다시 시도해 주세요'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="inlineRow">
      <input className="slot" type="text" placeholder={placeholder} maxLength={1000} value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }} />
      <button className="btn" type="button" disabled={!text.trim() || busy} onClick={send}>{button}</button>
    </div>
  )
}
