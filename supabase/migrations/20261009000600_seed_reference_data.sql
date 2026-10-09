-- =====================================================================
-- 기준 데이터 넣기: 단과대·대학원, 부서(라벨 24개), 건물(공식 캠퍼스맵 33곳)
--
-- 원본
--   colleges    : data/labels/dept_mapping.csv의 '소속 라우팅' 행
--   departments : data/labels/departments.csv (CSV를 고치면 여기도 같이 고칠 것)
--   buildings   : 경희대 공식 국제캠퍼스맵 https://www.khu.ac.kr/kor/user/mapManager/view.do?menuNo=200357
--                 x, y(지도 좌표)는 비워 둠 → 지도 담당이 채운다
-- =====================================================================

insert into public.colleges (code, name, kind) values
  ('engineering',         '공과대학',             'college'),
  ('electronics',         '전자정보대학',         'college'),
  ('software',            '소프트웨어융합대학',   'college'),
  ('applied_science',     '응용과학대학',         'college'),
  ('life_science',        '생명과학대학',         'college'),
  ('international',       '국제대학',             'college'),
  ('foreign_languages',   '외국어대학',           'college'),
  ('art_design',          '예술·디자인대학',      'college'),
  ('physical_education',  '체육대학',             'college'),
  ('free_major',          '자유전공학부',         'college'),
  ('grad_general',        '일반대학원',           'grad'),
  ('grad_education',      '교육대학원',           'grad'),
  ('grad_international',  '국제대학원',           'grad'),
  ('grad_east_west',      '동서의학대학원',       'grad'),
  ('grad_sports',         '체육대학원',           'grad'),
  ('grad_techno',         '테크노경영대학원',     'grad'),
  ('grad_art_fusion',     '아트퓨전디자인대학원', 'grad');

insert into public.departments (code, name, org, phone, email, duties) values
  ('ACADEMIC', '학사지원팀', '교무처', '031-201-3038~41', 'khwa5032@khu.ac.kr', '수강신청·정정, 성적, 휴학·복학, 졸업요건·조기졸업, 전과·복수전공, 학점인정, 계절학기, 학사일정'),
  ('ACADEMIC_AFFAIRS', '교무팀', '교무처', '031-201-3031~7', 'khwa5031@khu.ac.kr', '교원 및 강의 운영, 강의평가, 교과과정 편성, 수업 운영 관련 건의(강의 질·휴강·보강)'),
  ('LIBERAL_ARTS', '후마니타스칼리지 행정실', '후마니타스칼리지', '031-201-3402~7', 'khwc5871@khu.ac.kr', '교양 과목(중핵·배분이수·기초교과 등) 개설 여부·분반·시간표, 교양 수업 관련 문의, 교양 이수 요건'),
  ('TEACHING_CERT', '교직팀', '교무처', '031-201-3047~9', 'teacher02@khu.ac.kr', '교직과정 이수, 교육실습, 교원자격증'),
  ('STUDENT_LIFE', '학생지원센터(학생)', '미래혁신원', '031-201-3051~4', 'khwa5041@khu.ac.kr', '학생자치·동아리 지원, 학생 행사, 학생복지, 학생생활 전반 건의'),
  ('SCHOLARSHIP', '학생지원센터(장학)', '미래혁신원', '031-201-3055~9', 'scholarship@khu.ac.kr', '교내·외 장학금 선발과 지급, 국가장학금, 학자금 대출'),
  ('CERTIFICATE', '바로처리실(제증명)', '학생지원센터', '031-201-3180~5', 'khwa9998@khu.ac.kr', '재학·졸업·성적증명서 등 각종 증명서 발급, 원스톱 민원 창구'),
  ('COUNSELING', '심리상담센터', '학생지원센터', '031-201-3070', 'counsel@khu.ac.kr', '학생 심리상담, 생활상담, 심리검사'),
  ('CAREER', '미래인재센터(취업·경력)', '미래혁신원', '031-201-3061~5', 'khwa5045@khu.ac.kr', '취업 지원, 진로·경력 개발 프로그램, 채용 정보'),
  ('DISABILITY', '장애학생지원센터', '학생지원센터', '031-201-3460~1', 'support@khu.ac.kr', '장애학생 학습·생활 지원, 편의시설·이동 지원'),
  ('GENDER_EQUALITY', '성평등상담실', null, '031-201-2352', 'shleter@khu.ac.kr', '성희롱·성폭력 등 인권침해 상담 및 신고 접수'),
  ('FACILITY_REPAIR', '관리팀', '총무관리처', '031-201-3120~9', 'khwa5062@khu.ac.kr', '건물 시설 고장·수리(건축, 목공, 설비, 전기, 통신), 냉난방, 누수, 조명, 폐기물, 방범'),
  ('SAFETY', '안전팀', '총무관리처', '031-201-3129', 'khwa0119@khu.ac.kr', '소방, 안전사고 예방, 위험 시설 신고'),
  ('FACILITY_RENTAL', '시설운영팀', '재정운영본부', '031-201-3141~3', 'makespace@khu.ac.kr', '강의실·행사장 등 교내 시설 대관'),
  ('GENERAL_AFFAIRS', '총무팀', '총무관리처', '031-201-3101~5', 'khwa5061@khu.ac.kr', '총무, 구매, 교내 교통·주차·통학버스 등 일반 행정'),
  ('IT', '정보처(IT 문의)', '정보처', '031-201-3171~2', 'itdesk@khu.ac.kr', '인포21·Klas 등 학내 시스템, 계정, 교내 와이파이, 전산 장애'),
  ('LIBRARY', '중앙도서관(국제)', '부속기관', '031-201-3210', 'library@khu.ac.kr', '도서 대출·반납, 열람실·좌석, 전자자료, 도서관 시설'),
  ('DORM', '생활관', '부속기관', '031-201-3640 (우정원) / 031-201-3638~9 (제2기숙사)', 'woojungwon@khu.ac.kr / dorm2@khu.ac.kr', '기숙사 입·퇴사, 생활관 시설, 생활 규정, 관비'),
  ('HEALTH', '건강센터', '부속기관', '031-201-3118~9', 'khwd8310@khu.ac.kr', '응급처치, 건강검진, 보건 상담'),
  ('INTERNATIONAL', '국제처(글로벌교육지원팀·국제교류팀)', '국제처', '031-201-3961~6', 'ciss_gc@khu.ac.kr', '외국인 유학생 지원, 교환학생·해외연수'),
  ('SPORTS_FACILITY', '체육시설운영단', null, '031-201-2790~3', 'sportsfacility@khu.ac.kr', '운동장·체육관·체육시설 운영과 이용'),
  ('COLLEGE_OFFICE', '단과대학·학과 행정실', '각 단과대학', '단과대별 상이 (예: 소프트웨어융합대학 031-201-3701~3)', '예: khwc5751@khu.ac.kr (소프트웨어융합대학)', '전공 과목 개설 여부·분반·시간표, 전공 수업 관련 문의, 학과 공지, 교수 연락, 학과 공간(과방 등), 단과대 소관 시설. 문의 대상 수업·학과를 맡은 단과대 행정실로 보냄(target_college). 알 수 없으면 민원인 소속 단과대'),
  ('GRAD_OFFICE', '대학원 행정실', '각 대학원', '대학원별 상이 (예: 일반대학원 031-201-3501~4)', '예: khwb6000@khu.ac.kr (일반대학원)', '대학원 학사(수강, 학위청구·논문심사, 연구등록), 대학원 과목 개설, 대학원생 행정. 문의 대상 대학원 행정실로 보냄(target_college). 알 수 없으면 민원인 소속 대학원'),
  ('UNASSIGNED', '미분류(담당자 배정)', null, null, null, '위 부서에 해당하지 않거나 판단이 어려운 민원. 직원이 수동으로 배정');

insert into public.buildings (id, name, map_no, college_codes) values
  ('main_gate',            '정문(새천년기념탑·네오르네상스문)', 1,  '{}'),
  ('aejiwon',              '애지원',                    2,  '{}'),
  ('renaissance_park',     '르네상스공원',              3,  '{}'),
  ('woojungwon',           '우정원',                    4,  '{}'),
  ('turf_field',           '인조잔디구장/지하주차장',   5,  '{}'),
  ('engineering',          '공학관',                    6,  '{engineering}'),
  ('reactor_center',       '원자로센터',                7,  '{engineering}'),
  ('engineering_lab',      '공학실험동',                8,  '{engineering}'),
  ('physical_education',   '체육대학관',                9,  '{physical_education}'),
  ('foreign_languages',    '외국어대학관',              10, '{foreign_languages}'),
  ('kyunghee_park',        '경희공원',                  11, '{}'),
  ('multimedia',           '멀티미디어교육관·글로벌관', 12, '{}'),
  ('dorm2',                '제2기숙사',                 13, '{}'),
  ('main_stadium',         '대운동장',                  14, '{}'),
  ('ceramics',             '도예관',                    15, '{art_design}'),
  ('greenhouse',           '원예생명공학 온실',         16, '{life_science}'),
  ('seonseung',            '선승관',                    17, '{}'),
  ('life_science',         '생명과학대학관',            18, '{life_science}'),
  ('herbal_processing',    '한방재료가공(경희보감)',    19, '{life_science}'),
  ('research_lab',         '실험연구동',                20, '{}'),
  ('art_design',           '예술·디자인대학관',         21, '{art_design}'),
  ('international_business','국제·경영대학관',         22, '{international}'),
  ('student_center',       '학생회관',                  23, '{}'),
  ('central_library',      '중앙도서관(대학본부)',      24, '{}'),
  ('plaza',                '사색의 광장',               25, '{}'),
  ('bus_terminal',         '주차장/노선버스종점',       26, '{}'),
  ('sports_complex',       '종합운동장',                27, '{}'),
  ('baseball_field',       '야구경기장',                28, '{}'),
  ('peace_theater',        '평화노천극장',              29, '{}'),
  ('pond',                 '연못',                      30, '{}'),
  ('electronics',          '전자정보/응용과학대학관',   31, '{electronics,software,applied_science}'),
  ('international_studies','국제학관',                  32, '{international,grad_international}'),
  ('observatory',          '천문대',                    33, '{applied_science}');
