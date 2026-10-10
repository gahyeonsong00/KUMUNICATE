import { useEffect, useRef, useState } from 'react'
import { generateImage, sendDecoration } from './api'
import type { Toast } from './CitizenApp'
import type { Place } from './places'
import { MAX_BYTE, countBytes, errorText, formatDateTime } from './util'
import decoBefore from '../../assets/deco_before.png'
import kuming from '../../assets/kuming.png'
import kumingHead from '../../assets/kuming_head.png'

export type DecoItem = {
  id: string
  title: string // 처음 프롬프트
  prompt: string // 수정 내용까지 덧붙은 프롬프트
  placeName: string
  buildingId: string | null
  date: string
  img: string
  sent: boolean // 의견 전달하기로 학교에 보냈는지
}

type Panel = 'none' | 'deco' | 'history' | 'reset'
type Props = {
  userId: string
  toast: Toast
  panel: Panel
  setPanel: (p: Panel) => void
  place: Place | null
  history: DecoItem[]
  setHistory: React.Dispatch<React.SetStateAction<DecoItem[]>>
  onSaved: () => void
}

const PREFIX = '[꾸미기 제안] '

// 꾸미기 창(프롬프트 → 로딩 → 완료 → 수정), 히스토리, 초기화 확인
export default function Decorate(props: Props) {
  const { panel, setPanel } = props
  return (
    <>
      {panel === 'deco' && props.place && <DecoWindow {...props} place={props.place} />}
      {panel === 'history' && <History {...props} />}
      {panel === 'reset' && (
        <div className="overlay center">
          <div id="resetBox" className="panel">
            <b>정말로 초기화하시겠습니까?</b>
            <p>지금까지 꾸민 내용이 모두 지워집니다. 학교에 전달한 의견은 지워지지 않아요.</p>
            <div className="twoBtns">
              <button className="btn3" type="button" onClick={() => setPanel('none')}>취소</button>
              <button className="btn" type="button" onClick={() => {
                props.setHistory([])
                setPanel('none')
                props.toast('초기화했어요')
              }}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DecoWindow({ toast, setPanel, place, setHistory, onSaved }: Props & { place: Place }) {
  const [stage, setStage] = useState<'prompt' | 'load' | 'done'>('prompt')
  const [input, setInput] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [img, setImg] = useState('')
  const [tab, setTab] = useState<'before' | 'after'>('after')
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState('')
  // 창을 닫으면 진행 중인 생성 결과는 버린다
  const token = useRef(0)
  useEffect(() => () => { token.current++ }, [])

  const run = async (p: string) => {
    const my = ++token.current
    setStage('load')
    try {
      const url = await generateImage(p, place.name)
      if (my !== token.current) return
      setImg(url)
      setTab('after')
      setEditing(false)
      setStage('done')
    } catch {
      if (my !== token.current) return
      toast('꾸미기에 실패했어요. 다시 시도해 주세요')
      setStage('prompt')
    }
  }

  const close = () => setPanel('none')

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
            <button id="decoGo" className="btn" type="button" disabled={!input.trim()} onClick={() => {
              const t = input.trim()
              setTitle(t)
              setPrompt(t)
              run(t)
            }}>AI로 생성하기</button>
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
            <img id="decoImg" className="crisp" src={tab === 'after' ? img : decoBefore} alt="꾸미기 그림" />
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
                <button className="btn2" type="button" onClick={() => {
                  setHistory((h) => [{
                    id: crypto.randomUUID(), title, prompt, placeName: place.name, buildingId: place.buildingId,
                    date: formatDateTime(new Date()).slice(0, 10), img, sent: false,
                  }, ...h])
                  close()
                  onSaved()
                  toast('꾸미기를 저장했어요')
                }}>저장</button>
                <button className="btn3" type="button" onClick={() => { setEdit(''); setEditing(true) }}>수정하기</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // 그림은 그대로 두고, 수정 내용을 프롬프트에 덧붙여서 다시 생성
  function sendEdit() {
    const t = edit.trim()
    if (!t) return
    const p = `${prompt} ${t}`
    setPrompt(p)
    run(p)
  }
}

function History({ userId, toast, setPanel, history, setHistory }: Props) {
  const [select, setSelect] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)

  const item = openId ? history.find((h) => h.id === openId) : undefined
  const close = () => setPanel('none')
  const remove = (ids: string[]) => setHistory((h) => h.filter((x) => !ids.includes(x.id)))

  // 의견 전달하기: 프롬프트·한 줄 의견·전후 이미지를 꾸미기 민원으로 접수한다
  const send = async (it: DecoItem) => {
    const c = comment.trim()
    const content = c ? `${PREFIX}${it.prompt}\n${c}` : `${PREFIX}${it.prompt}`
    if (countBytes(content) > MAX_BYTE) { toast('의견이 너무 길어요. 조금 줄여 주세요'); return }
    setSending(true)
    try {
      await sendDecoration(userId, {
        content, buildingId: it.buildingId,
        beforeUrl: new URL(decoBefore, window.location.href).href, afterUrl: it.img,
      })
      setHistory((h) => h.map((x) => (x.id === it.id ? { ...x, sent: true } : x)))
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
                <img className="crisp" src={item.img} alt="" />
                <span className="sub">{item.placeName} · {item.date}</span>
                {item.sent ? (
                  <span className="sub">학교에 전달한 의견이에요. 처리 현황은 '나의 활동'에서 볼 수 있어요.</span>
                ) : (
                  <textarea className="slot" placeholder="학교에 하고 싶은 말 (선택)" maxLength={100}
                    value={comment} onChange={(e) => setComment(e.target.value)} />
                )}
                <div className="honeFoot">
                  <button className="btn3" type="button" onClick={() => { remove([item.id]); setOpenId(null); toast('삭제했어요') }}>삭제</button>
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
                  <button className="btn hb" type="button" onClick={() => {
                    if (checked.length === 0) { toast('삭제할 항목을 선택하세요'); return }
                    remove(checked)
                    setChecked([])
                    toast('삭제했어요')
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
                    <div className="slot hthumb"><img className="crisp" src={it.img} alt="" /></div>
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
