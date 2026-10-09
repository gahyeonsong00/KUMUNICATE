import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Tag,
  TextArea,
  TextInput,
} from '@carbon/react'
import { ArrowLeft } from '@carbon/icons-react'
import decoBefore from '../../assets/deco_before.png'
import decoAfter from '../../assets/deco_after.png'
import AdminShell from './AdminShell'
import SplitPane from './SplitPane'
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TAG, fmtFull } from './common'
import { supabase } from '../lib/supabase'
import type { ComplaintRow } from './types'
import { useAdminStore } from './store'

const OTHER_REASON = 'other'
const TRANSFER_REASONS = [
  { code: 'not_our_work', label: '우리 부서 업무가 아님' },
  { code: 'other_dept_facility', label: '다른 부서가 관리하는 시설' },
  { code: 'academic_scholarship', label: '학사·장학 관련 문의' },
  { code: OTHER_REASON, label: '기타' },
]

export default function ComplaintDetail() {
  const { no } = useParams()
  const { rows } = useAdminStore()
  const found = rows.find((r) => r.no === no)
  return (
    <AdminShell>
      <RouterLink to="/admin" className="back-link">
        <ArrowLeft size={16} /> 내 민원
      </RouterLink>
      {!found ? (
        // 서버는 내가 맡은 민원만 돌려준다. 남의 민원·배정 전 민원은 여기로 온다
        <InlineNotification
          kind="info"
          title="내가 맡은 민원이 아닙니다"
          subtitle={`접수번호 ${no}. 담당자만 내용을 볼 수 있습니다. 배정 전 민원은 내 민원 화면의 다음 민원 받기로 받으세요.`}
          hideCloseButton
          lowContrast
        />
      ) : (
        <Detail key={found.no} c={found} />
      )}
    </AdminShell>
  )
}

// 첨부 사진: 비공개 버킷이라 1시간짜리 임시 주소로 보여 준다
function Photos({ paths, captions }: { paths: string[]; captions?: string[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    supabase.storage
      .from('complaint-files')
      .createSignedUrls(paths, 3600)
      .then(({ data }) => setUrls((data ?? []).map((d) => d.signedUrl ?? '')))
  }, [paths])
  return (
    <div className="deco-pair">
      {urls.map((u, i) => (
        <figure key={paths[i]}>
          <img src={u} alt={captions?.[i] ?? `첨부 사진 ${i + 1}`} />
          {captions?.[i] && <figcaption>{captions[i]}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function Detail({ c }: { c: ComplaintRow }) {
  const navigate = useNavigate()
  const { me, departments, release, transfer, resolve, sendChat } = useAdminStore()
  const hasBot = c.bot.length > 0
  const status = c.status
  const [moving, setMoving] = useState(false)
  const [dept, setDept] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [chatOpened, setChatOpened] = useState(false)
  const chatOn = c.chatOn || chatOpened
  const talk = c.talk
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  // 접수 경로에 따라 처음 펼칠 구획이 정해진다: 채팅 민원은 채팅, 접수서·꾸미기는 답변서
  const [showBody, setShowBody] = useState(true)
  const [showBot, setShowBot] = useState(hasBot)
  const [showChat, setShowChat] = useState(c.chatOn)
  const [showAns, setShowAns] = useState(!c.chatOn || c.channel === 'form' || c.channel === 'decorate')

  // 상태는 행동에 따라 자동으로 바뀐다: 답변서 전송·채팅 종료 → 처리 완료
  const run = async (f: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try {
      await f()
      if (ok) setNotice({ kind: 'success', text: ok })
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const done = (text: string, letter?: string) => run(() => resolve(c.id, letter), text)
  const lastLetter = c.letters.at(-1)

  const body = (
    <div className="panel">
      <h3>접수 내용</h3>
      <dl className="facts">
        <dt>접수일시</dt>
        <dd className="num">{fmtFull(c.createdAt)}</dd>
        <dt>위치</dt>
        <dd>{c.where}</dd>
        <dt>접수 경로</dt>
        <dd>{CHANNEL_LABEL[c.channel]}</dd>
        <dt>민원인</dt>
        <dd>
          {c.requester.name} / {c.requester.email}
          <br />
          <span className="muted">{c.requester.affiliation}</span>
        </dd>
        <dt>원문</dt>
        <dd>{c.body}</dd>
      </dl>
      {c.prev && (
        <div className="prev-box">
          <strong>이전 처리 이력</strong>
          <p className="num">{fmtFull(c.prev.resolvedAt)} 답변서로 처리 완료</p>
          <p className="muted">보낸 답변: {c.prev.answer}</p>
          <p className="muted">
            처리 완료 후 7일 안에 민원인이 재문의해 같은 민원이 다시 열렸습니다 (<span className="num">{fmtFull(c.prev.reopenedAt)}</span>).
          </p>
        </div>
      )}
      {c.channel === 'decorate' && c.photoPaths.length > 0 && (
        <Photos paths={c.photoPaths} captions={['현재 모습', '민원인이 꾸미기로 만든 개선안 (AI 생성)']} />
      )}
      {/* shortcut: 시드 민원에는 실제 꾸미기 파일이 없어 시연용 예시 이미지를 보여 준다. 민원인 화면이 업로드하면 위 분기만 쓰인다 */}
      {c.channel === 'decorate' && c.photoPaths.length === 0 && (
        <div className="deco-pair">
          <figure>
            <img src={decoBefore} alt="꾸미기 전 현재 모습" />
            <figcaption>현재 모습</figcaption>
          </figure>
          <figure>
            <img src={decoAfter} alt="민원인이 꾸미기로 만든 개선안: 벤치와 화단 추가" />
            <figcaption>민원인이 꾸미기로 만든 개선안 (시연용 예시)</figcaption>
          </figure>
        </div>
      )}
      {c.channel !== 'decorate' && c.photoPaths.length > 0 && <Photos paths={c.photoPaths} />}
    </div>
  )

  const bot = hasBot ? (
    <div className="panel">
      <h3>챗봇 접수 기록</h3>
      <ul className="bot-log">
        {c.bot.map((b, i) => (
          <li key={i}>
            <strong>{b.who}</strong> {b.text}
          </li>
        ))}
      </ul>
    </div>
  ) : null

  const chat = (
    <div className="panel">
      <h3>채팅</h3>
      {!chatOn ? (
        <div className="chat-off">
          <p>이 민원은 채팅 없이 접수됐습니다. 추가 확인이 필요하면 채팅을 열어 민원인과 대화할 수 있습니다.</p>
          <Button
            size="sm"
            kind="secondary"
            onClick={() => setChatOpened(true)}
          >
            채팅 시작
          </Button>
        </div>
      ) : (
        <>
          <ul className="chat-log" aria-live="polite">
            {talk.length === 0 && <li className="muted">아직 주고받은 메시지가 없습니다.</li>}
            {talk.map((m, i) => (
              <li key={i} className={m.mine ? 'mine' : ''}>
                <span className="who">{m.who}</span>
                <span className="bubble">{m.text}</span>
              </li>
            ))}
          </ul>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault()
              const t = draft.trim()
              if (!t) return
              run(async () => {
                await sendChat(c.id, t)
                setDraft('')
              })
            }}
          >
            <TextInput
              id="chat-draft"
              labelText="채팅 메시지"
              hideLabel
              placeholder="민원인에게 보낼 메시지"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={status === 'resolved'}
            />
            <Button type="submit" size="md" disabled={status === 'resolved' || busy}>
              전송
            </Button>
          </form>
          <Button
            size="sm"
            kind="tertiary"
            disabled={status === 'resolved' || busy}
            onClick={() => done('채팅을 마치고 처리 완료했습니다. 민원인에게 알림이 전송됩니다.')}
          >
            대화 종료 후 처리 완료
          </Button>
        </>
      )}
    </div>
  )

  const letter = (
    <div className="panel">
      <h3>답변서</h3>
      {status === 'resolved' && lastLetter ? (
        <div className="prev-box">
          <strong>보낸 답변</strong>
          <p className="num muted">{fmtFull(lastLetter.at)}</p>
          <p>{lastLetter.body}</p>
        </div>
      ) : (
      <>
      <TextArea
        id="answer"
        labelText="공식 답변"
        helperText="보낸 답변은 민원인의 '나의 활동'에 공식 답변으로 표시됩니다."
        placeholder="처리 결과와 답변을 작성하세요."
        rows={6}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={status === 'resolved'}
      />
      <Button
        size="md"
        disabled={status === 'resolved' || busy}
        onClick={() =>
          answer.trim()
            ? done('공식 답변을 보내고 처리 완료했습니다.', answer.trim())
            : setNotice({ kind: 'error', text: '답변 내용을 먼저 작성해 주세요.' })
        }
      >
        답변 보내고 처리 완료
      </Button>
      </>
      )}
    </div>
  )

  return (
    <>
      <div className="detail-head">
        <h1>{c.summary}</h1>
        <span className="num muted">{c.no}</span>
        <Tag type={STATUS_TAG[status]} size="md">
          {STATUS_LABEL[status]}
        </Tag>
        <Tag type="outline" size="md">
          {CHANNEL_LABEL[c.channel]}
        </Tag>
        {c.reopened && (
          <Tag type="purple" size="md">
            재문의
          </Tag>
        )}
        <div className="owner-line">
          <span>
            담당 <strong>{me.name}</strong>
          </span>
          {status !== 'resolved' && (
            <Button
              size="sm"
              kind="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await release(c.id)
                  navigate('/admin', { state: { notice: `${c.summary} 민원의 담당을 해제했습니다. 원래 접수 순서대로 대기열에 돌아갑니다.` } })
                })
              }
            >
              담당 해제
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <InlineNotification
          kind={notice.kind}
          title={notice.text}
          lowContrast
          onClose={() => setNotice(null)}
          className="detail-notice"
        />
      )}

      <div className="detail-grid">
        <section className="detail-card" aria-labelledby="content-h">
          <div className="card-head">
            <h2 id="content-h">민원 내용</h2>
            {hasBot && (
              <div className="toggles">
                <Button size="sm" kind="ghost" aria-expanded={showBody} onClick={() => setShowBody((v) => !v)}>
                  접수 내용 {showBody ? '접기' : '펼치기'}
                </Button>
                <Button size="sm" kind="ghost" aria-expanded={showBot} onClick={() => setShowBot((v) => !v)}>
                  챗봇 기록 {showBot ? '접기' : '펼치기'}
                </Button>
              </div>
            )}
          </div>
          {!showBody && !showBot ? (
            <p className="empty-note">두 구획이 모두 접혀 있습니다. 위 버튼으로 펼치세요.</p>
          ) : (
            <SplitPane label="접수 내용과 챗봇 기록 너비 조절" initial={60} min={30} left={showBody ? body : null} right={showBot ? bot : null} />
          )}
        </section>

        <aside className="detail-side">
          <section className="detail-card" aria-labelledby="ai-h">
            <h2 id="ai-h">AI 요약</h2>
            <p className="ai-summary">{c.aiSummary}</p>
          </section>
          <section className="detail-card" aria-labelledby="act-h">
            <h2 id="act-h">다른 부서로 넘기기</h2>
            <div className="act-body">
              {!moving ? (
                <>
                  <p className="muted small">
                    {c.confidence === null
                      ? `담당 부서: ${c.department}.`
                      : `AI 분류: ${c.department} (신뢰도 ${Math.round(c.confidence * 100)}%).`}{' '}
                    우리 부서 일이 아니면 맞는 부서로 넘기세요.
                  </p>
                  <Button size="md" kind="tertiary" disabled={status === 'resolved'} onClick={() => setMoving(true)}>
                    다른 부서로 넘기기
                  </Button>
                </>
              ) : (
                <>
                  <Select id="dept" labelText="받을 부서" value={dept} onChange={(e) => setDept(e.target.value)}>
                    <SelectItem value="" text="부서 선택" />
                    {departments
                      .filter((d) => d.code !== c.departmentCode && d.code !== 'UNASSIGNED')
                      .map((d) => (
                        <SelectItem key={d.code} value={d.code} text={d.name} />
                      ))}
                  </Select>
                  <RadioButtonGroup
                    legendText="넘기는 이유"
                    name="reason"
                    orientation="vertical"
                    valueSelected={reason}
                    onChange={(v) => setReason(String(v))}
                  >
                    {TRANSFER_REASONS.map((r) => (
                      <RadioButton key={r.code} id={`reason-${r.code}`} labelText={r.label} value={r.code} />
                    ))}
                  </RadioButtonGroup>
                  <TextArea
                    id="reason-note"
                    labelText={reason === OTHER_REASON ? '덧붙일 말 (필수)' : '덧붙일 말 (선택)'}
                    helperText="받는 부서 담당자만 봅니다. 민원인에게는 보이지 않습니다."
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="act-buttons">
                    <Button
                      size="md"
                      disabled={!dept || !reason || (reason === OTHER_REASON && !note.trim()) || busy}
                      onClick={() =>
                        run(async () => {
                          await transfer(c.id, dept, reason, note.trim())
                          const name = departments.find((d) => d.code === dept)?.name ?? dept
                          navigate('/admin', { state: { notice: `${c.summary} 민원을 ${name}(으)로 넘겼습니다.` } })
                        })
                      }
                    >
                      넘기기
                    </Button>
                    <Button size="md" kind="ghost" onClick={() => setMoving(false)}>
                      취소
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="detail-card reply" aria-labelledby="reply-h">
        <div className="card-head">
          <h2 id="reply-h">민원인에게 답하기</h2>
          <div className="toggles">
            <Button size="sm" kind="ghost" aria-expanded={showChat} onClick={() => setShowChat((v) => !v)}>
              채팅 {showChat ? '접기' : '펼치기'}
            </Button>
            <Button size="sm" kind="ghost" aria-expanded={showAns} onClick={() => setShowAns((v) => !v)}>
              답변서 {showAns ? '접기' : '펼치기'}
            </Button>
          </div>
        </div>
        {!showChat && !showAns ? (
          <p className="empty-note">두 구획이 모두 접혀 있습니다. 위 버튼으로 펼치세요.</p>
        ) : (
          <SplitPane label="채팅과 답변서 너비 조절" left={showChat ? chat : null} right={showAns ? letter : null} />
        )}
      </section>
    </>
  )
}
