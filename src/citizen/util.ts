// 민원 본문 제한(byte). 서버 complaints.content와 같은 UTF-8 기준이라 한글은 3byte(약 166자)
export const MAX_BYTE = 500
const encoder = new TextEncoder()
export const countBytes = (s: string) => encoder.encode(s).length

const pad2 = (n: number) => String(n).padStart(2, '0')

// "2026.10.06 23:06"
export function formatDateTime(v: string | Date) {
  const d = new Date(v)
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// "오후 11:06"
export function formatTime(v: string | Date = new Date()) {
  const d = new Date(v)
  const h = d.getHours()
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad2(d.getMinutes())}`
}

// "2026년 10월 6일"
export function todayKorean() {
  const d = new Date()
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

// 앞 40자 + …
export function preview(text: string, n = 40) {
  const chars = Array.from(text)
  return chars.length > n ? chars.slice(0, n).join('') + '…' : text
}

// 서버 오류 메시지를 사용자에게 보여 줄 문장으로
export function errorText(e: unknown, fallback: string) {
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : ''
  // 서버 함수·트리거가 한국어로 던진 메시지는 그대로 보여 준다
  return /[가-힣]/.test(msg) ? msg : fallback
}
