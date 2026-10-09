import type { Channel, Status } from './types'

export const STATUSES: Status[] = ['received', 'in_progress', 'resolved']
// DB에는 3단계만 저장. 직원 화면은 담당자 유무로 '배정 대기'를 구분해 보여준다
export const STATUS_LABEL: Record<Status, string> = {
  received: '배정 대기',
  in_progress: '처리 중',
  resolved: '처리 완료',
}
export const STATUS_TAG: Record<Status, 'cool-gray' | 'blue' | 'green'> = {
  received: 'cool-gray',
  in_progress: 'blue',
  resolved: 'green',
}
export const CHANNEL_LABEL: Record<Channel, string> = {
  chat: '챗봇 대화 후 접수',
  chatbot_handoff: '챗봇 이관',
  form: '접수서 직접 작성',
  decorate: '꾸미기',
}

const LATE_MS = 3 * 24 * 60 * 60 * 1000
export const isLate = (r: { status: Status; createdAt: Date }, now: number) => r.status !== 'resolved' && now - r.createdAt.getTime() >= LATE_MS

const p2 = (n: number) => String(n).padStart(2, '0')
export const fmt = (d: Date) => `${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
export const fmtFull = (d: Date) => `${d.getFullYear()}.${fmt(d)}`

export const isToday = (d: Date) => d.toDateString() === new Date().toDateString()

// 경과 시간: "2일 5시간", "3시간", "40분"
export const elapsed = (from: Date, now: number) => {
  const min = Math.max(0, Math.floor((now - from.getTime()) / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`
  if (h > 0) return `${h}시간`
  return `${min}분`
}
