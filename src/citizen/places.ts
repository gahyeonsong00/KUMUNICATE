// 지도 이름표 33곳 = buildings 테이블 (공식 국제캠퍼스맵 번호 순)
// x, y: 완성 지도(assets/map_final.png) 위 0~1 비율. buildings.x, y(지도 픽셀)를 6028×4176으로 나눈 값과 같다
// (승원 저장소 app/public/features/campus-data.js 에서 생성)
export type Place = { name: string; x: number; y: number; buildingId: string | null }

export const PLACES: Place[] = [
  { name: '정문(새천년기념탑/네오르네상스문)', x: 0.7595, y: 0.1353, buildingId: 'main_gate' },
  { name: '애지원', x: 0.9313, y: 0.2167, buildingId: 'aejiwon' },
  { name: '르네상스공원', x: 0.6938, y: 0.1398, buildingId: 'renaissance_park' },
  { name: '우정원', x: 0.6000, y: 0.0766, buildingId: 'woojungwon' },
  { name: '인조잔디구장 / 지하주차장', x: 0.7062, y: 0.2256, buildingId: 'turf_field' },
  { name: '공학관', x: 0.7437, y: 0.3024, buildingId: 'engineering' },
  { name: '원자로센터', x: 0.8187, y: 0.3204, buildingId: 'reactor_center' },
  { name: '공학실험동', x: 0.8562, y: 0.3501, buildingId: 'engineering_lab' },
  { name: '체육대학관', x: 0.5625, y: 0.3113, buildingId: 'physical_education' },
  { name: '외국어대학관', x: 0.5499, y: 0.1353, buildingId: 'foreign_languages' },
  { name: '경희공원', x: 0.5187, y: 0.0541, buildingId: 'kyunghee_park' },
  { name: '멀티미디어교육관 / 글로벌관', x: 0.4406, y: 0.0723, buildingId: 'multimedia' },
  { name: '제2기숙사', x: 0.2750, y: 0.1037, buildingId: 'dorm2' },
  { name: '대운동장', x: 0.4094, y: 0.1760, buildingId: 'main_stadium' },
  { name: '도예관', x: 0.6032, y: 0.4016, buildingId: 'ceramics' },
  { name: '원예생명공학 온실', x: 0.5531, y: 0.4198, buildingId: 'greenhouse' },
  { name: '선승관', x: 0.3907, y: 0.3204, buildingId: 'seonseung' },
  { name: '생명과학대학관', x: 0.4718, y: 0.4152, buildingId: 'life_science' },
  { name: '한방재료가공(경희보감)', x: 0.6626, y: 0.5505, buildingId: 'herbal_processing' },
  { name: '실험연구동', x: 0.4937, y: 0.8439, buildingId: 'research_lab' },
  { name: '예술·디자인대학관', x: 0.4937, y: 0.6046, buildingId: 'art_design' },
  { name: '국제·경영대학관', x: 0.3532, y: 0.4241, buildingId: 'international_business' },
  { name: '학생회관', x: 0.2906, y: 0.3113, buildingId: 'student_center' },
  { name: '중앙도서관(대학본부)', x: 0.1500, y: 0.3113, buildingId: 'central_library' },
  { name: '사색의 광장', x: 0.2500, y: 0.4693, buildingId: 'plaza' },
  { name: '주차장 / 노선버스종점', x: 0.3751, y: 0.7129, buildingId: 'bus_terminal' },
  { name: '종합운동장', x: 0.2750, y: 0.8664, buildingId: 'sports_complex' },
  { name: '야구경기장', x: 0.1500, y: 0.8934, buildingId: 'baseball_field' },
  { name: '평화노천극장', x: 0.0687, y: 0.7129, buildingId: 'peace_theater' },
  { name: '연못', x: 0.1468, y: 0.7174, buildingId: 'pond' },
  { name: '전자정보 / 응용과학대학관', x: 0.2407, y: 0.6588, buildingId: 'electronics' },
  { name: '국제학관', x: 0.1438, y: 0.4828, buildingId: 'international_studies' },
  { name: '천문대', x: 0.0469, y: 0.5551, buildingId: 'observatory' },
]

// 지도 판 처음 크기(px). 확대·축소하면 MainScreen이 이 크기에 배율을 곱해서 그린다
export const MAP_W = 1600
export const MAP_H = 1108

// 가장 가까운 이름표 (지도 판 픽셀 기준 거리)
export function nearestPlace(x: number, y: number): Place {
  let best = PLACES[0]
  let bestD = Infinity
  for (const p of PLACES) {
    const d = ((p.x - x) * MAP_W) ** 2 + ((p.y - y) * MAP_H) ** 2
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}
