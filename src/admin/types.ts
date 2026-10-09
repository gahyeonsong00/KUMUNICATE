export type Status = 'received' | 'in_progress' | 'resolved'
export type Channel = 'chat' | 'chatbot_handoff' | 'form' | 'decorate'

export type ChatLine = { who: string; text: string; mine: boolean }

// 내가 맡은 민원 1건 (서버 complaints + 민원인·채팅을 화면용으로 펼친 것)
export type ComplaintRow = {
  id: string
  no: string
  createdAt: Date
  where: string
  channel: Channel
  summary: string
  departmentCode: string | null
  department: string
  confidence: number | null
  status: Status
  reopened: boolean
  body: string
  aiSummary: string
  requester: { name: string; email: string; affiliation: string }
  bot: { who: string; text: string }[]
  chatOn: boolean
  talk: ChatLine[]
  letters: { body: string; at: Date }[]
  photoPaths: string[]
  prev?: { resolvedAt: Date; answer: string; reopenedAt: Date }
  resolvedAt?: Date
}

// 부서 현황 1줄 (department_board). 배정 전이면 summary·owner가 null
export type BoardRow = {
  no: string
  createdAt: Date
  summary: string | null
  owner: string | null
  status: Status
  resolvedAt?: Date
  reopened: boolean
}

export type Me = { id: string; name: string; departmentCode: string; department: string }
