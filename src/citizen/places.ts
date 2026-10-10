// 지도 이름표 (임시)
// 지금 지도 그림(campus_map.jpg)은 가상의 캠퍼스라 이름 15개를 그림을 보고 붙였다.
// 승원의 실제 지도가 오면 buildings 테이블의 x, y로 바꾸고 이 파일은 지운다.
// buildingId: 이름이 비슷한 buildings.id. 확실하지 않으면 null(장소 없이 접수)
export type Place = { name: string; x: number; y: number; buildingId: string | null }

export const PLACES: Place[] = [
  { name: '정문', x: 0.52, y: 0.08, buildingId: 'main_gate' },
  { name: '기숙사', x: 0.15, y: 0.1, buildingId: null },
  { name: '체육관', x: 0.42, y: 0.25, buildingId: null },
  { name: '테니스장', x: 0.33, y: 0.27, buildingId: null },
  { name: '운동장', x: 0.17, y: 0.29, buildingId: 'main_stadium' },
  { name: '원형 경기장', x: 0.39, y: 0.36, buildingId: null },
  { name: '연구동', x: 0.74, y: 0.33, buildingId: 'research_lab' },
  { name: '중앙도서관', x: 0.35, y: 0.48, buildingId: 'central_library' },
  { name: '광장', x: 0.61, y: 0.52, buildingId: 'plaza' },
  { name: '야외극장', x: 0.57, y: 0.65, buildingId: 'peace_theater' },
  { name: '연못', x: 0.45, y: 0.71, buildingId: 'pond' },
  { name: '천문대', x: 0.33, y: 0.77, buildingId: 'observatory' },
  { name: '야구장', x: 0.73, y: 0.71, buildingId: 'baseball_field' },
  { name: '축구장', x: 0.88, y: 0.77, buildingId: null },
  { name: '보조경기장', x: 0.88, y: 0.89, buildingId: null },
]

// 지도 판 크기(px)
export const MAP_W = 800
export const MAP_H = 1000

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
