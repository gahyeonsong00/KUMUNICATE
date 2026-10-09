import { createContext, useContext, useState, type ReactNode } from 'react'
import { ME, UNASSIGNED_DEPT, sampleRows, type ComplaintRow } from './sample'

// shortcut: 화면 안에서만 바뀌는 샘플 저장소. 서버 연결 단계에서
// claim_next_complaint / release_complaint / reassign_complaint RPC와 Realtime 구독으로 바꾼다
type Store = {
  rows: ComplaintRow[]
  queue: { mine: ComplaintRow[]; unassigned: ComplaintRow[] }
  claimNext: () => ComplaintRow | null
  release: (no: string) => void
  transfer: (no: string, department: string) => void
  update: (no: string, patch: Partial<ComplaintRow>) => void
}

const Ctx = createContext<Store | null>(null)
const byArrival = (a: ComplaintRow, b: ComplaintRow) => a.createdAt.getTime() - b.createdAt.getTime()

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState(sampleRows)
  const waiting = (dept: string) => rows.filter((r) => r.owner === null && r.status !== 'resolved' && r.department === dept).sort(byArrival)
  const queue = { mine: waiting(ME.department), unassigned: waiting(UNASSIGNED_DEPT) }
  const update = (no: string, patch: Partial<ComplaintRow>) => setRows((rs) => rs.map((r) => (r.no === no ? { ...r, ...patch } : r)))

  const store: Store = {
    rows,
    queue,
    // 내 부서 대기 → 없으면 미분류 대기. 둘 다 도착 순서
    claimNext: () => {
      const next = queue.mine[0] ?? queue.unassigned[0] ?? null
      if (next) update(next.no, { owner: ME.name, status: 'in_progress' })
      return next
    },
    release: (no) => update(no, { owner: null, status: 'received' }),
    // 이관하면 담당자를 비우고 새 부서 대기열로. 대기 순서는 처음 접수 시각 기준이라 따로 할 일이 없다
    transfer: (no, department) => update(no, { department, owner: null, status: 'received' }),
    update,
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useAdminStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('AdminStoreProvider 밖에서 useAdminStore를 썼습니다')
  return s
}
