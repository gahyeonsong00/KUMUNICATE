import { useMemo, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Button,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tabs,
  Tag,
} from '@carbon/react'
import { ArrowRight } from '@carbon/icons-react'
import AdminShell from './AdminShell'
import { STATUS_LABEL, STATUS_TAG, elapsed, fmt, isLate, isToday } from './common'
import type { BoardRow, ComplaintRow } from './types'
import { useAdminStore } from './store'

type Card = 'working' | 'late' | 'doneToday'
type Timed = Pick<ComplaintRow, 'status' | 'createdAt' | 'resolvedAt'>
const CARD_MATCH: Record<Card, (r: Timed, now: number) => boolean> = {
  working: (r) => r.status !== 'resolved',
  late: (r, now) => isLate(r, now),
  doneToday: (r) => r.status === 'resolved' && !!r.resolvedAt && isToday(r.resolvedAt),
}
const CARD_LABEL: Record<Card, string> = { working: '처리 중', late: '지연', doneToday: '처리 완료' }
const CARD_SUB: Record<Card, string> = {
  working: '처리 완료 전인 내 민원',
  late: '접수 후 3일 넘게 미해결',
  doneToday: '오늘 처리 완료한 민원',
}

const byWork = (a: Timed, b: Timed) =>
  Number(a.status === 'resolved') - Number(b.status === 'resolved') || a.createdAt.getTime() - b.createdAt.getTime()

export default function AdminDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'dept' ? 1 : 0
  const { me, rows, board, queue, claimNext } = useAdminStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [q, setQ] = useState('')
  const notice = (location.state as { notice?: string } | null)?.notice
  const now = Date.now()

  const mine = rows
  const shown = useMemo(() => {
    const term = q.trim()
    return mine
      .filter((r) => (!card || CARD_MATCH[card](r, now)) && (!term || (r.summary + r.where).includes(term)))
      .sort(byWork)
  }, [mine, card, q, now])

  const waitingTotal = queue.mine + queue.unassigned

  // 서버가 한 건씩 배정한다. 그 사이 다른 직원이 먼저 받아 대기가 0이 됐으면 알려 준다
  const takeNext = async () => {
    setBusy(true)
    setErr(null)
    try {
      const no = await claimNext()
      if (no) navigate(`/admin/complaints/${no}`)
      else setErr('방금 다른 직원이 남은 민원을 받아 대기 중인 민원이 없습니다.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const today = new Date()
  const days = ['일', '월', '화', '수', '목', '금', '토']

  return (
    <AdminShell>
      <div className="admin-page-head">
        <div>
          <h1>{me.department} 민원</h1>
          <p>
            {today.getFullYear()}.{String(today.getMonth() + 1).padStart(2, '0')}.{String(today.getDate()).padStart(2, '0')} (
            {days[today.getDay()]}) 기준
          </p>
        </div>
      </div>

      {notice && (
        <InlineNotification
          kind="success"
          title={notice}
          lowContrast
          className="detail-notice"
          onClose={() => navigate('.', { replace: true, state: null })}
        />
      )}
      {err && <InlineNotification kind="error" title={err} lowContrast className="detail-notice" onClose={() => setErr(null)} />}

      <Tabs selectedIndex={tab} onChange={({ selectedIndex }) => setParams(selectedIndex === 1 ? { tab: 'dept' } : {})}>
        <TabList aria-label="보기 선택" className="admin-tabs">
          <Tab>내 민원</Tab>
          <Tab>부서 현황</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className="admin-tabpanel">
            <div className="kpi-row">
              <div className="queue-ticket" aria-labelledby="queue-h">
                <div className="queue-count">
                  <span id="queue-h" className="kpi-label">
                    대기 중
                  </span>
                  <span className="queue-value num">{waitingTotal}</span>
                  <span className="kpi-sub">
                    {me.department} {queue.mine}건 · 미분류 {queue.unassigned}건
                  </span>
                </div>
                <div className="queue-action">
                  <Button size="lg" renderIcon={ArrowRight} disabled={waitingTotal === 0 || busy} onClick={takeNext}>
                    {busy ? '받는 중' : '다음 민원 받기'}
                  </Button>
                  <span className="kpi-sub">
                    {queue.oldest ? `가장 오래 기다린 민원 ${elapsed(queue.oldest, now)}째` : '기다리는 민원이 없습니다'}
                  </span>
                </div>
              </div>
              {(Object.keys(CARD_LABEL) as Card[]).map((k) => {
                const n = mine.filter((r) => CARD_MATCH[k](r, now)).length
                return (
                  <button
                    key={k}
                    type="button"
                    className={`kpi${k === 'late' && n > 0 ? ' is-alert' : ''}`}
                    aria-pressed={card === k}
                    onClick={() => setCard((c) => (c === k ? null : k))}
                  >
                    <span className="kpi-label">{CARD_LABEL[k]}</span>
                    <span className="kpi-value num">{n}</span>
                    <span className="kpi-sub">{CARD_SUB[k]}</span>
                  </button>
                )
              })}
            </div>

            <TableContainer
              title={card ? `내 민원: ${CARD_LABEL[card]}` : '내 민원'}
              description={card ? '위 카드를 다시 누르면 전체 내 민원으로 돌아갑니다.' : '오래 기다린 민원부터 보여줍니다. 행을 누르면 처리 화면으로 이동합니다.'}
            >
              <TableToolbar aria-label="내 민원 도구">
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    labelText="내 민원 검색"
                    placeholder="내용 또는 위치로 검색"
                    value={q}
                    onChange={(e) => setQ(typeof e === 'string' ? e : (e.target as HTMLInputElement).value)}
                  />
                </TableToolbarContent>
              </TableToolbar>
              {shown.length > 0 ? (
                <Table size="md" aria-label="내 민원 목록">
                  <TableHead>
                    <TableRow>
                      <TableHeader>접수번호</TableHeader>
                      <TableHeader>접수일시</TableHeader>
                      <TableHeader>위치</TableHeader>
                      <TableHeader>민원 요약 (AI)</TableHeader>
                      <TableHeader>상태</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.no} className="clickable-row" onClick={() => navigate(`/admin/complaints/${r.no}`)}>
                        <TableCell className="num">
                          <RouterLink to={`/admin/complaints/${r.no}`} onClick={(e) => e.stopPropagation()}>
                            {r.no}
                          </RouterLink>
                        </TableCell>
                        <TableCell className="num">{fmt(r.createdAt)}</TableCell>
                        <TableCell>
                          {r.where}
                          {r.channel === 'decorate' && ' (꾸미기)'}
                          {r.channel === 'chatbot_handoff' && ' (챗봇 이관)'}
                        </TableCell>
                        <TableCell className="wrap">
                          <span className="row-title">
                            {r.summary}
                            {isLate(r, now) && (
                              <Tag type="red" size="sm">
                                지연
                              </Tag>
                            )}
                            {r.reopened && (
                              <Tag type="purple" size="sm">
                                재문의
                              </Tag>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Tag type={STATUS_TAG[r.status]} size="sm">
                            {STATUS_LABEL[r.status]}
                          </Tag>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="empty-state">
                  {mine.length === 0 ? (
                    <>
                      <p className="empty-title">맡은 민원이 없습니다</p>
                      <p>위의 다음 민원 받기를 누르면 가장 오래 기다린 민원이 배정됩니다.</p>
                    </>
                  ) : (
                    <>
                      <p className="empty-title">조건에 맞는 민원이 없습니다</p>
                      <p>검색어를 지우거나 선택한 카드를 다시 눌러 전체 내 민원을 보세요.</p>
                    </>
                  )}
                </div>
              )}
            </TableContainer>
          </TabPanel>

          <TabPanel className="admin-tabpanel">
            <DeptBoard board={board} me={me.name} now={now} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </AdminShell>
  )
}

// 부서 현황: 읽기 전용. 배정 전 민원은 내용을 감춘다 (남이 처리할 민원을 미리 읽지 않도록)
function DeptBoard({ board, me, now }: { board: BoardRow[]; me: string; now: number }) {
  const dept = [...board].sort(byWork)
  const people = [...new Set(dept.map((r) => r.owner).filter((o): o is string => !!o))].sort((a, b) =>
    a === me ? -1 : b === me ? 1 : a.localeCompare(b, 'ko'),
  )
  const stat = (name: string, f: (r: BoardRow) => boolean) => dept.filter((r) => r.owner === name && f(r)).length

  return (
    <div className="dept-board">
      <TableContainer title="직원별 처리 현황" description="지금 맡고 있는 민원과 오늘 해결한 민원 수입니다.">
        <Table size="md" aria-label="직원별 처리 현황">
          <TableHead>
            <TableRow>
              <TableHeader>직원</TableHeader>
              <TableHeader className="cell-num">처리 중</TableHeader>
              <TableHeader className="cell-num">지연</TableHeader>
              <TableHeader className="cell-num">오늘 완료</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p}>
                <TableCell>
                  {p}
                  {p === me && <span className="muted"> (나)</span>}
                </TableCell>
                <TableCell className="num cell-num">{stat(p, (r) => CARD_MATCH.working(r, now))}</TableCell>
                <TableCell className="num cell-num">{stat(p, (r) => isLate(r, now))}</TableCell>
                <TableCell className="num cell-num">{stat(p, (r) => CARD_MATCH.doneToday(r, now))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TableContainer title="부서 민원" description="읽기 전용입니다. 배정 전 민원은 받은 사람만 내용을 볼 수 있습니다.">
        <Table size="md" aria-label="부서 민원">
          <TableHead>
            <TableRow>
              <TableHeader>접수번호</TableHeader>
              <TableHeader>접수일시</TableHeader>
              <TableHeader>민원 요약 (AI)</TableHeader>
              <TableHeader>담당자</TableHeader>
              <TableHeader>상태</TableHeader>
              <TableHeader>경과</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {dept.map((r) => (
              <TableRow key={r.no}>
                <TableCell className="num">{r.no}</TableCell>
                <TableCell className="num">{fmt(r.createdAt)}</TableCell>
                <TableCell className="wrap">
                  {r.owner ? (
                    <span className="row-title">
                      {r.summary}
                      {isLate(r, now) && (
                        <Tag type="red" size="sm">
                          지연
                        </Tag>
                      )}
                    </span>
                  ) : (
                    <span className="muted">배정 전 (내용 비공개)</span>
                  )}
                </TableCell>
                <TableCell>{r.owner ?? <span className="muted">대기</span>}</TableCell>
                <TableCell>
                  <Tag type={STATUS_TAG[r.status]} size="sm">
                    {STATUS_LABEL[r.status]}
                  </Tag>
                </TableCell>
                <TableCell className="num">{r.status === 'resolved' ? '-' : elapsed(r.createdAt, now)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  )
}
