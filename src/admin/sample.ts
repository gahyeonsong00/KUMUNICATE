// shortcut: 화면 시안 확인용 샘플. 서버 연결 단계에서 Supabase complaints·messages 조회로 바꾼다
import departmentsCsv from '../../data/labels/departments.csv?raw'

export type Status = 'received' | 'in_progress' | 'resolved'
export type Channel = 'chat' | 'chatbot_handoff' | 'form' | 'decorate'

export type ChatLine = { who: string; text: string; mine: boolean }

export type ComplaintRow = {
  no: string
  createdAt: Date
  where: string
  channel: Channel
  summary: string
  department: string
  confidence: number
  status: Status
  owner: string | null
  reopened: boolean
  body: string
  aiSummary: string
  requester: { name: string; email: string; affiliation: string }
  bot: { who: string; text: string }[]
  chatOn: boolean
  talk: ChatLine[]
  hasPhoto: boolean
  prev?: { resolvedAt: string; answer: string; reopenedAt: string }
  resolvedAt?: Date
}

// 시연용 로그인 직원
export const ME = { name: '이서윤', department: '관리팀' }
export const UNASSIGNED_DEPT = '미분류(담당자 배정)'

// 부서 이름은 라벨표(departments.csv)가 기준. 앞 두 칸(code,name)에는 쉼표가 없다
export const departments = departmentsCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [code, name] = line.split(',')
    return { code, name }
  })

const daysAgo = (d: number, h = 10, m = 0) => {
  const t = new Date()
  t.setDate(t.getDate() - d)
  t.setHours(h, m, 0, 0)
  return t
}

const base = { bot: [], chatOn: false, talk: [], hasPhoto: false, reopened: false, owner: null }

export const sampleRows: ComplaintRow[] = [
  {
    ...base,
    no: '2026-1009-004', createdAt: daysAgo(0, 9, 12), where: '사색의 광장', channel: 'form', summary: '가로등 2개가 꺼져 있음',
    department: '관리팀', confidence: 0.88, status: 'received', hasPhoto: true,
    body: '광장 분수대 옆 가로등 두 개가 어젯밤부터 꺼져 있어서 밤에 많이 어두워요.',
    aiSummary: '사색의 광장 분수대 주변 가로등 2개 소등. 야간 보행 안전 관련으로 빠른 점검 필요.',
    requester: { name: '박지호', email: 'jiho.park@khu.ac.kr', affiliation: '소프트웨어융합대학 컴퓨터공학부' },
  },
  {
    ...base,
    no: '2026-1006-023', createdAt: daysAgo(3, 23, 6), where: '중앙도서관(대학본부) 정문', channel: 'chat', summary: '정문 오른쪽 두 번째 벤치 파손',
    department: '관리팀', confidence: 0.92, status: 'in_progress', owner: '이서윤', hasPhoto: true, chatOn: true,
    body: '도서관 정문에서 나와 오른쪽 두 번째 벤치가 부서져 있어요. 앉으면 위험해 보입니다.',
    aiSummary: '중앙도서관 정문 오른쪽 두 번째 벤치 파손. 이용자 안전 위험 있음. 현장 확인 후 보수 또는 사용 제한 필요.',
    requester: { name: '김도현', email: 'dohyun.k@khu.ac.kr', affiliation: '공과대학 기계공학과' },
    bot: [
      { who: 'AI 챗봇', text: '안녕하세요. 어떤 점이 불편하신가요?' },
      { who: '민원인', text: '도서관 정문에서 나와 오른쪽 두 번째 벤치가 부서져 있어요.' },
      { who: 'AI 챗봇', text: '확인했습니다. 시설 관련 민원으로 접수할게요.' },
    ],
    talk: [
      { who: '이서윤 (관리팀)', text: '안녕하세요. 도서관 정문 기준 어느 쪽 벤치인지 알려주시겠어요?', mine: true },
      { who: '민원인', text: '정문에서 나와 오른쪽 두 번째 벤치예요.', mine: false },
      { who: '이서윤 (관리팀)', text: '확인했습니다. 오늘 현장 확인 후 사용 제한 표시를 하겠습니다.', mine: true },
    ],
  },
  {
    ...base,
    no: '2026-1007-011', createdAt: daysAgo(2, 15, 40), where: '연못 주변', channel: 'decorate', summary: '연못 주변 벤치 설치 요청',
    department: '관리팀', confidence: 0.9, status: 'received',
    body: '연못 주변에 앉아서 쉴 곳이 없어서 꾸미기로 벤치와 화단을 만들어 봤어요.',
    aiSummary: '연못 주변 벤치·화단 설치 요청. 민원인이 꾸미기로 만든 개선안 이미지 첨부.',
    requester: { name: '정하린', email: 'harin.j@khu.ac.kr', affiliation: '예술·디자인대학 시각디자인학과' },
  },
  {
    ...base,
    no: '2026-1004-008', createdAt: daysAgo(5, 10, 33), where: '위치 없음 (채팅 문의)', channel: 'chatbot_handoff', summary: '성적장학금 규정 문의',
    department: UNASSIGNED_DEPT, confidence: 0.41, status: 'received', chatOn: true,
    body: '성적장학금 받으려면 직전 학기 몇 학점 이상 들어야 하는지 궁금해요.',
    aiSummary: '성적장학금 최소 이수 학점 기준 문의. 챗봇이 답과 담당 부서를 찾지 못해 이관됨. 장학 담당 소관으로 보임.',
    requester: { name: '한서준', email: 'seojun.han@khu.ac.kr', affiliation: '국제대학 국제학과' },
    bot: [
      { who: 'AI 챗봇', text: '안녕하세요. 어떤 점이 궁금하신가요?' },
      { who: '민원인', text: '성적장학금 받으려면 직전 학기 몇 학점 이상 들어야 하나요?' },
      { who: 'AI 챗봇', text: '정확한 기준을 찾지 못했어요. 담당자에게 연결해 드릴게요.' },
    ],
  },
  {
    ...base,
    no: '2026-1005-012', createdAt: daysAgo(4, 16, 5), where: '종합운동장', channel: 'form', summary: '트랙 바깥쪽 배수 불량',
    department: '관리팀', confidence: 0.84, status: 'in_progress', owner: '최유나',
    body: '비가 오고 나면 트랙 바깥쪽 3레인 근처에 물이 이틀 넘게 고여 있어요.',
    aiSummary: '종합운동장 트랙 바깥쪽 배수 불량. 우천 후 물 고임 지속.',
    requester: { name: '오세린', email: 'serin.oh@khu.ac.kr', affiliation: '체육대학 스포츠지도학과' },
  },
  {
    ...base,
    no: '2026-1001-031', createdAt: daysAgo(8, 14, 12), where: '체육대학관 2층', channel: 'form', summary: '화장실 핸드드라이어 고장',
    department: '관리팀', confidence: 0.95, status: 'in_progress', owner: '이서윤', reopened: true, chatOn: true,
    body: '2층 화장실 핸드드라이어가 작동하지 않아요.',
    aiSummary: '체육대학관 2층 화장실 핸드드라이어 고장. 전원 조치 후 해결 완료했으나 민원인이 재문의함. 여전히 바람이 약하다는 내용.',
    requester: { name: '윤재민', email: 'jaemin.yoon@khu.ac.kr', affiliation: '체육대학 골프산업학과' },
    prev: { resolvedAt: '2일 전', answer: '2층 화장실 핸드드라이어 전원을 점검해 다시 작동하도록 조치했습니다.', reopenedAt: '오늘 10:05' },
    talk: [
      { who: '시스템', text: '민원인이 해결 완료 2일 뒤 재문의했습니다. 채팅이 자동으로 열렸습니다.', mine: true },
      { who: '민원인', text: '켜지긴 하는데 바람이 너무 약해서 손이 안 말라요. 교체가 필요해 보여요.', mine: false },
    ],
  },
  {
    ...base,
    no: '2026-0925-006', createdAt: daysAgo(14, 19, 40), where: '학생회관', channel: 'form', summary: '계단 조명 깜빡임',
    department: '관리팀', confidence: 0.93, status: 'resolved', owner: '이서윤', resolvedAt: daysAgo(0, 9, 40),
    body: '학생회관 2층에서 3층 올라가는 계단 조명이 계속 깜빡여요.',
    aiSummary: '학생회관 2~3층 계단 조명 깜빡임.',
    requester: { name: '서민우', email: 'minwoo.seo@khu.ac.kr', affiliation: '생명과학대학 식품생명공학과' },
  },
  {
    ...base,
    no: '2026-1008-019', createdAt: daysAgo(2, 11, 20), where: '공학관 2층 복도', channel: 'form', summary: '복도 천장 누수',
    department: '관리팀', confidence: 0.91, status: 'resolved', owner: '박준서', resolvedAt: daysAgo(0, 8, 55),
    body: '비 오는 날 공학관 2층 복도 천장에서 물이 떨어집니다.',
    aiSummary: '공학관 2층 복도 천장 누수. 우천 시 발생.',
    requester: { name: '강민재', email: 'minjae.kang@khu.ac.kr', affiliation: '공과대학 건축공학과' },
  },
]
