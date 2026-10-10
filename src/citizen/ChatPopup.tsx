import { useEffect, useRef, useState } from 'react'
import { askComplaintAI, submitComplaint } from './api'
import type { Toast } from './CitizenApp'
import { MAX_BYTE, countBytes, errorText, formatTime, todayKorean } from './util'
import kumingHead from '../../assets/kuming_head.png'

type Turn = { who: 'ai' | 'me'; text: string; time: string }
type Props = { userId: string; toast: Toast; onClose: () => void; onSubmitted: () => void }

const GREETING = '안녕하세요. 어떤 점이 불편하신가요?'

// 민원 접수 채팅: 쿠밍이와 대화 → 쿠밍이가 정리한 글(draft)을 "이 내용으로 접수하기"
export default function ChatPopup({ userId, toast, onClose, onSubmitted }: Props) {
  const [turns, setTurns] = useState<Turn[]>([{ who: 'ai', text: GREETING, time: formatTime() }])
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // 새 말풍선이 생기면 맨 아래로
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns, draft, waiting])

  const send = async () => {
    const text = input.trim()
    if (!text || waiting) return
    setInput('')
    const next: Turn[] = [...turns, { who: 'me', text, time: formatTime() }]
    setTurns(next)
    setWaiting(true)
    try {
      // 서버는 대화를 저장하지 않으므로 지금까지의 대화를 매번 보낸다
      const res = await askComplaintAI(next.map((t) => ({ role: t.who === 'ai' ? 'assistant' : 'user', content: t.text })))
      setTurns((ts) => [...ts, { who: 'ai', text: res.reply, time: formatTime() }])
      setDraft(res.draft)
    } catch {
      toast('답변을 받지 못했어요. 다시 시도해 주세요')
    } finally {
      setWaiting(false)
    }
  }

  const submitDraft = async () => {
    if (!draft || submitting) return
    if (countBytes(draft) > MAX_BYTE) { toast('내용이 너무 길어요. 조금 줄여서 다시 말씀해 주세요'); return }
    setSubmitting(true)
    try {
      await submitComplaint(userId, {
        content: draft,
        buildingId: null,
        photos: [],
        channel: 'chat',
        chatbotLog: turns.map((t) => ({ who: t.who === 'ai' ? 'bot' : 'user', text: t.text })),
      })
      onSubmitted()
    } catch (e) {
      toast(errorText(e, '접수에 실패했어요. 다시 시도해 주세요'))
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div id="chatBox" className="panel">
        <div id="chatHead" className="plate">
          <b>민원 접수 채팅</b>
          <button id="chatClose" className="btn3" type="button" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div id="chatList" ref={listRef}>
          <div id="chatDate">{todayKorean()}</div>
          {turns.map((t, i) =>
            t.who === 'ai' ? (
              <div key={i} className="rowAi">
                <div className="slot face"><img className="crisp" src={kumingHead} alt="" /></div>
                <div className="col">
                  <span className="nm">쿠밍이 (AI 챗봇)</span>
                  <div className="bubble ai">{t.text}</div>
                  <span className="time">{t.time}</span>
                </div>
              </div>
            ) : (
              <div key={i} className="rowMe">
                <div className="bubble me">{t.text}</div>
                <span className="time">{t.time}</span>
              </div>
            ),
          )}
          {waiting && <div className="sub">쿠밍이가 답을 쓰는 중…</div>}
          {draft && !waiting && (
            <div className="draftCard">
              <b>접수할 내용</b>
              <p>{draft}</p>
              <button className="btn" type="button" onClick={submitDraft} disabled={submitting}>
                {submitting ? '접수 중…' : '이 내용으로 접수하기'}
              </button>
            </div>
          )}
        </div>
        <div id="chatFoot">
          <input id="chatInput" className="slot" type="text" placeholder="채팅 입력하기" autoComplete="off" maxLength={1000}
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter는 무시
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
            }} />
          <button id="chatSend" className="btn" type="button" disabled={!input.trim() || waiting} onClick={send}>보내기</button>
        </div>
      </div>
    </div>
  )
}
