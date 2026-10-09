// =====================================================================
// 민원 분류 로직 — 분류 담당 팀원이 이 파일만 채우면 된다.
//
// 입력·출력 형식은 docs/decisions.md "분류 함수 입출력"과 같다.
// DB 읽기/저장은 index.ts가 하므로 여기서는 ChatKHU 호출과 결과 만들기만 한다.
// API 키는 코드에 쓰지 말고 Deno.env.get("CHATKHU_API_KEY")로 읽는다
// (npx supabase secrets set CHATKHU_API_KEY=...).
//
// 지켜야 할 것
//   department     : departments 테이블 code 중 하나 (data/labels/departments.csv)
//   target_college : COLLEGE_OFFICE·GRAD_OFFICE일 때만 colleges 테이블 code (예: "software"),
//                    나머지는 null. 모르면 null → 서버가 민원인 소속으로 채운다
//   confidence     : 0~1
// =====================================================================

export type ClassifyInput = {
  complaint_id: string;
  content: string;
  building_id: string | null; // buildings.id (예: "engineering"), 채팅 접수면 null
  requester: {
    type: "undergrad" | "grad" | "staff" | null;
    college: string | null; // colleges.code
    department: string | null; // 학과·전공(자유 입력, profiles.major)
  };
};

export type ClassifyOutput = {
  department: string;
  target_college: string | null;
  confidence: number;
  summary: string;
};

// 가짜 버전: 항상 UNASSIGNED (admin이 직접 배정)
export async function classify(_input: ClassifyInput): Promise<ClassifyOutput> {
  return { department: "UNASSIGNED", target_college: null, confidence: 0, summary: "" };
}
