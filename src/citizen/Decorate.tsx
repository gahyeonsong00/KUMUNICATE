import { useEffect, useRef, useState } from 'react'
import {
  cropForPopup, deleteLatestDecoration, generateImage, newDecoSession, resetDecorations, saveDecoration, sendDecoration,
  type DecoRecord, type DecoResult,
} from './api'
import type { Toast } from './CitizenApp'
import type { Place } from './places'
import { MAX_BYTE, countBytes, errorText } from './util'
import kuming from '../../assets/kuming.png'
import kumingHead from '../../assets/kuming_head.png'

// 히스토리 한 줄 = 서버에 저장된 내 꾸미기 (api.ts loadDecorations)
export type DecoItem = DecoRecord

type Panel = 'none' | 'deco' | 'history' | 'reset'
type Props = {
  userId: string
  toast: Toast
  panel: Panel
  setPanel: (p: Panel) => void
  place: Place | null
  pin: { x: number; y: number } | null // 핀 자리 (지도 판 0~1 비율). 이 자리를 가운데로 잘라 꾸민다
  history: DecoItem[]
  reload: () => Promise<void> // 서버에서 히스토리(= 내 지도)를 다시 읽기
  onSaved: () => void
}

const PREFIX = '[꾸미기 제안] '

// 꾸미기 창(프롬프트 → 로딩 → 완료 → 수정), 히스토리, 초기화 확인
export default function Decorate(props: Props) {
  const { panel, setPanel, toast, reload } = props
  return (
    <>
      {panel === 'deco' && props.place && props.pin && <DecoWindow {...props} place={props.place} pin={props.pin} />}
      {panel === 'history' && <History {...props} />}
      {panel === 'reset' && (
        <div className="overlay center">
          <div id="resetBox" className="panel">
            <b>정말로 초기화하시겠습니까?</b>
            <p>지금까지 꾸민 내용이 모두 지워집니다. 학교에 전달한 의견은 지워지지 않아요.</p>
            <div className="twoBtns">
              <button className="btn3" type="button" onClick={() => setPanel('none')}>취소</button>
              <button className="btn" type="button" onClick={async () => {
                try {
                  await resetDecorations()
                  await reload()
                  setPanel('none')
                  toast('초기화했어요')
                } catch (e) {
                  toast(errorText(e, '초기화하지 못했어요. 다시 시도해 주세요'))
                }
              }}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DecoWindow({ toast, setPanel, place, pin, reload, onSaved }: Props & { place: Place; pin: { x: number; y: number } }) {
  const [stage, setStage] = useState<'prompt' | 'load' | 'done'>('prompt')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<DecoResult | null>(null)
  const [img, setImg] = useState('') // 꾸민 후 (사진 칸 비율로 자른 것)
  const [before, setBefore] = useState('') // 꾸미기 전
  const [tab, setTab] = useState<'before' | 'after'>('after')
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState('')
  const [saving, setSaving] = useState(false)
  // 창 하나 = 세션 하나. 수정하기는 같은 세션으로 보내서 서버가 앞선 요청과 합쳐 다시 그린다
  const session = useRef(newDecoSession())
  // 창을 닫으면 진행 중인 생성 결과는 버린다
  const token = useRef(0)
  useEffect(() => () => { token.current++ }, [])

  const run = async (message: string) => {
    const my = ++token.current
    setStage('load')
    try {
      const r = await generateImage(session.current, message, pin)
      const [a, b] = await Promise.all([cropForPopup(r.afterUrl), cropForPopup(r.beforeUrl)])
      if (my !== token.current) return
      setResult(r)
      setImg(a)
      setBefore(b)
      setTab('after')
      setEditing(false)
      setStage('done')
    } catch (e) {
      if (my !== token.current) return
      // 쿠밍이 답(그림으로 못 보여 주는 요청, 하루 한도 등)이나 실패 안내
      toast(errorText(e, '꾸미기에 실패했어요. 다시 시도해 주세요'))
      setStage(result ? 'done' : 'prompt') // 수정 중이었으면 이전 그림으로
    }
  }

  const close = () => setPanel('none')

  const save = async () => {
    if (!result || saving) return
    setSaving(true)
    try {
      await saveDecoration(result.requestId)
      await reload()
      close()
      onSaved()
      toast('꾸미기를 저장했어요')
    } catch (e) {
      toast(errorText(e, '저장하지 못했어요. 다시 시도해 주세요'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay center">
      <div id="decoBox" className={`panel${stage !== 'prompt' ? ' big' : ''}`}>
        <div id="decoHead" className="plate">
          <b>{place.name}</b>
          <button id="decoClose" className="btn3" type="button" aria-label="닫기" onClick={close}>✕</button>
        </div>

        {stage === 'prompt' && (
          <div className="dStage">
            <div id="promptLabel">이 자리를 어떻게 바꾸고 싶나요?</div>
            <textarea id="decoPrompt" className="slot" placeholder="예: 분수대 주변에 벤치 생성" maxLength={150}
              value={input} onChange={(e) => setInput(e.target.value)} />
            <button id="decoGo" className="btn" type="button" disabled={!input.trim()} onClick={() => run(input.trim())}>AI로 생성하기</button>
          </div>
        )}

        {stage === 'load' && (
          <div id="dLoad" className="dStage">
            <img className="crisp bob" src={kuming} alt="쿠밍이" />
            <div id="dLoadText">경희대를 꾸미는중...</div>
            <div id="progress"><i /></div>
          </div>
        )}

        {stage === 'done' && (
          <div className="dStage">
            <img id="decoImg" className="crisp" src={tab === 'after' ? img : before} alt="꾸미기 그림" />
            <div id="decoTabs">
              <button className={tab === 'before' ? 'btn2' : 'btn3'} type="button" onClick={() => setTab('before')}>꾸미기 전</button>
              <button className={tab === 'after' ? 'btn2' : 'btn3'} type="button" onClick={() => setTab('after')}>꾸민 후</button>
            </div>
            {editing ? (
              <div id="decoEdit">
                <input id="decoEditInput" className="slot" type="text" placeholder="수정할 내용을 적어주세요" autoComplete="off"
                  maxLength={100} autoFocus value={edit} onChange={(e) => setEdit(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendEdit() }} />
                <button id="decoEditSend" className="btn" type="button" onClick={sendEdit}>보내기</button>
              </div>
            ) : (
              <div id="decoBtns">
                <button className="btn2" type="button" disabled={saving} onClick={save}>저장</button>
                <button className="btn3" type="button" onClick={() => { setEdit(''); setEditing(true) }}>수정하기</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // 그림은 그대로 두고 수정 내용만 보낸다 (앞선 요청과 합치는 건 서버가 같은 세션으로)
  function sendEdit() {
    const t = edit.trim()
    if (!t) return
    run(t)
  }
}

function History({ userId, toast, setPanel, history, reload }: Props) {
  const [select, setSelect] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)

  const item = openId ? history.find((h) => h.id === openId) : undefined
  const close = () => setPanel('none')

  // 지울 때는 최신 것부터만 (새 꾸미기는 이전 꾸미기가 얹힌 지도에서 그리기 때문). 고른 것이 맨 앞부터 이어져야 함
  const remove = async (ids: string[]) => {
    const newest = history.slice(0, ids.length).map((x) => x.id)
    if (ids.some((id) => !newest.includes(id))) { toast('최근 꾸미기부터 지울 수 있어요'); return false }
    try {
      for (const id of newest) await deleteLatestDecoration(id)
      await reload()
      toast('삭제했어요')
      return true
    } catch (e) {
      toast(errorText(e, '삭제하지 못했어요. 다시 시도해 주세요'))
      return false
    }
  }

  // 의견 전달하기: 프롬프트·한 줄 의견·전후 이미지를 꾸미기 민원으로 접수한다
  const send = async (it: DecoItem) => {
    const c = comment.trim()
    const content = c ? `${PREFIX}${it.title}\n${c}` : `${PREFIX}${it.title}`
    if (countBytes(content) > MAX_BYTE) { toast('의견이 너무 길어요. 조금 줄여 주세요'); return }
    setSending(true)
    try {
      await sendDecoration(userId, {
        requestId: it.id, content, buildingId: it.buildingId, beforeUrl: it.beforeUrl, afterUrl: it.afterUrl,
      })
      await reload()
      setComment('')
      toast('학교에 의견을 전달했어요')
    } catch (e) {
      toast(errorText(e, '전달에 실패했어요. 다시 시도해 주세요'))
    } finally {
      setSending(false)
    }
  }

  const X = <button className="btn3 hb" type="button" aria-label="닫기" onClick={close}>✕</button>

  return (
    <div className="overlay">
      <div id="histBox" className="panel">
        {item ? (
          <>
            <div id="histHead" className="plate">
              <button className="btn3 hb" type="button" aria-label="목록으로" onClick={() => { setOpenId(null); setComment('') }}>‹</button>
              <b>{item.title}</b>
              {X}
            </div>
            <div id="histBody">
              <div className="hone">
                <img className="crisp" src={item.afterUrl} alt="" />
                <span className="sub">{item.placeName} · {item.date}</span>
                {item.sent ? (
                  <span className="sub">학교에 전달한 의견이에요. 처리 현황은 '나의 활동'에서 볼 수 있어요.</span>
                ) : (
                  <textarea className="slot" placeholder="학교에 하고 싶은 말 (선택)" maxLength={100}
                    value={comment} onChange={(e) => setComment(e.target.value)} />
                )}
                <div className="honeFoot">
                  <button className="btn3" type="button" onClick={async () => { if (await remove([item.id])) setOpenId(null) }}>삭제</button>
                  <button className="btn" type="button" disabled={item.sent || sending} onClick={() => send(item)}>
                    {item.sent ? '전달 완료' : sending ? '전달 중…' : '의견 전달하기'}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div id="histHead" className="plate">
              {select ? (
                <div className="grp">
                  <button className="btn3 hb" type="button" onClick={() => { setSelect(false); setChecked([]) }}>완료</button>
                  <button className="btn hb" type="button" onClick={async () => {
                    if (checked.length === 0) { toast('삭제할 항목을 선택하세요'); return }
                    if (await remove(checked)) setChecked([])
                  }}>삭제</button>
                </div>
              ) : (
                <button className="btn3 hb s" type="button" onClick={() => { setSelect(true); setChecked([]) }}>선택</button>
              )}
              <b>히스토리</b>
              {X}
            </div>
            <div id="histBody">
              {history.length === 0 ? (
                <div className="hempty"><img className="crisp" src={kumingHead} alt="" />아직 꾸민 기록이 없어요.</div>
              ) : history.map((it) => {
                const on = checked.includes(it.id)
                return (
                  <div key={it.id} className="hrow" onClick={() => {
                    if (select) setChecked((c) => (on ? c.filter((x) => x !== it.id) : [...c, it.id]))
                    else setOpenId(it.id)
                  }}>
                    <div className="slot hthumb"><img className="crisp" src={it.afterUrl} alt="" /></div>
                    <div className="hinfo">
                      <span>{it.title}</span>
                      <span className="sub">{it.placeName} · {it.date}{it.sent ? ' · 전달됨' : ''}</span>
                    </div>
                    {select && <div className={`hchk${on ? ' on' : ''}`}>{on ? '✓' : ''}</div>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
