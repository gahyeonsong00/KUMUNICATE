-- =====================================================================
-- 사용자 프로필(profiles)과 가입 규칙
--
-- 1. 가입할 때 이메일이 @khu.ac.kr(또는 allowed_emails에 등록된 주소)이 아니면 거부한다.
-- 2. 가입하면 profiles 행이 자동으로 생기고 role='user'로 시작한다.
--    앱은 user_type이 비어 있으면 "가입 정보 입력" 화면을 띄운다.
-- 3. 사용자는 자기 user_type, college_code, major, display_name만 고칠 수 있다.
--    role, department(담당 부서), staff_college_code는 관리자가 대시보드 SQL로 지정한다.
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('user', 'staff', 'admin')),
  user_type text check (user_type in ('undergrad', 'grad', 'staff')),
  college_code text references public.colleges (code),
  major text,
  department text references public.departments (code),
  staff_college_code text references public.colleges (code),
  created_at timestamptz not null default now(),
  -- staff는 담당 부서가 꼭 있어야 하고, 행정실 staff는 담당 단과대도 있어야 한다
  constraint staff_needs_department check (role <> 'staff' or department is not null),
  constraint office_staff_needs_college check (
    department is null
    or department not in ('COLLEGE_OFFICE', 'GRAD_OFFICE')
    or staff_college_code is not null
  )
);
comment on table public.profiles is '사용자 프로필. 가입 시 자동 생성(role=user). 역할·담당 부서는 관리자가 지정';
comment on column public.profiles.role is 'user = 일반, staff = 부서 직원, admin = 전체 관리(미분류 민원 배정 포함)';
comment on column public.profiles.user_type is 'undergrad = 학부생, grad = 대학원생, staff = 교직원. 비어 있으면 가입 정보 입력 전';
comment on column public.profiles.college_code is '본인 소속 단과대·대학원 (colleges.code). 교직원은 비워도 됨';
comment on column public.profiles.major is '학과·전공(자유 입력). 교직원은 소속 부서명';
comment on column public.profiles.department is 'staff의 담당 부서(departments.code). 관리자만 지정';
comment on column public.profiles.staff_college_code is '행정실(COLLEGE_OFFICE·GRAD_OFFICE) staff의 담당 단과대. 관리자만 지정';

alter table public.profiles enable row level security;

-- 사용자가 직접 바꿀 수 있는 칸만 열어 둔다 (role 등은 앱에서 못 바꿈)
revoke update on public.profiles from anon, authenticated;
grant update (display_name, user_type, college_code, major) on public.profiles to authenticated;

create policy "본인 프로필 수정" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- 조회 정책은 complaints 테이블이 생긴 뒤 20261009000300_complaints.sql에서 만든다

-- ---------------------------------------------------------------------
-- 가입 규칙: 이메일 도메인 검사 + 프로필 자동 생성
-- ---------------------------------------------------------------------
create function public.check_signup_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or lower(new.email) not like '%@khu.ac.kr'
     and not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception '경희대학교(@khu.ac.kr) 계정으로만 가입할 수 있어요';
  end if;
  return new;
end $$;

-- 가입할 때와 이메일을 바꿀 때 모두 검사 (가입 후 gmail로 바꾸는 우회 방지)
create trigger check_signup_email
  before insert or update of email on auth.users
  for each row execute function public.check_signup_email();

create function public.create_profile_for_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));
  return new;
end $$;

create trigger create_profile_for_new_user
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();
