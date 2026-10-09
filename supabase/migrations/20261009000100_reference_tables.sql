-- =====================================================================
-- 기준 데이터 테이블: 단과대(colleges), 부서(departments), 건물(buildings),
-- 가입 예외 이메일(allowed_emails)
--
-- 앱은 이 테이블들을 "읽기만" 한다. 값은 seed 마이그레이션
-- (20261009000600_seed_reference_data.sql)과 대시보드 SQL로만 바꾼다.
-- =====================================================================

-- 단과대·대학원 목록. profiles 소속, 민원의 target_college, 건물 대응이 모두 이 code를 쓴다.
create table public.colleges (
  code text primary key,
  name text not null unique,
  kind text not null check (kind in ('college', 'grad'))
);
comment on table public.colleges is '국제캠퍼스 단과대·대학원 목록. code가 profiles.college_code, complaints.target_college, buildings.college_codes의 기준값';
comment on column public.colleges.kind is 'college = 학부 단과대, grad = 대학원';

-- 민원 담당 부서 = 분류 라벨. data/labels/departments.csv가 원본이다.
create table public.departments (
  code text primary key,
  name text not null,
  org text,
  phone text,
  email text,
  duties text
);
comment on table public.departments is '민원 담당 부서(분류 라벨 24개). 원본은 data/labels/departments.csv, code를 바꾸면 분류 담당에게 알릴 것';
comment on column public.departments.code is '분류 결과 department 값. 예: FACILITY_REPAIR, COLLEGE_OFFICE, UNASSIGNED';

-- 지도에 찍히는 건물. 공식 국제캠퍼스맵 기준.
create table public.buildings (
  id text primary key,
  name text not null,
  map_no int,
  college_codes text[] not null default '{}',
  x int,
  y int
);
comment on table public.buildings is '국제캠퍼스 건물(공식 캠퍼스맵 33곳). id는 영문 slug(예: engineering)';
comment on column public.buildings.map_no is '공식 캠퍼스맵 번호';
comment on column public.buildings.college_codes is '이 건물을 쓰는 단과대 code 목록(0개 이상). 분류 시 장소 단서용';
comment on column public.buildings.x is '지도 이미지(assets/campus_map.jpg) 기준 픽셀 x. 지도 담당이 채움';
comment on column public.buildings.y is '지도 이미지 기준 픽셀 y. 지도 담당이 채움';

-- @khu.ac.kr이 아니어도 가입을 허용할 이메일(심사·시연용 데모 계정).
create table public.allowed_emails (
  email text primary key,
  note text
);
comment on table public.allowed_emails is '@khu.ac.kr 외에 가입을 허용할 이메일(데모 계정용). 대시보드 SQL로만 관리';

-- 기준 데이터는 로그인한 사람 누구나 읽기 가능, 쓰기는 대시보드(관리자)만.
alter table public.colleges enable row level security;
alter table public.departments enable row level security;
alter table public.buildings enable row level security;
alter table public.allowed_emails enable row level security; -- 정책 없음 = 앱에서 접근 불가

create policy "누구나 읽기" on public.colleges for select to authenticated using (true);
create policy "누구나 읽기" on public.departments for select to authenticated using (true);
create policy "누구나 읽기" on public.buildings for select to authenticated using (true);
