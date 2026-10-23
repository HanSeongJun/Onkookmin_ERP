-- =============================================================================
-- 거래처관리 (partners) and 직원관리 (employees)
--
-- Runs after the four 상품관리 migrations (20261021022829 … 20261022014503).
-- It does not touch any 상품 table, view or function.
--
-- The owner's rules (decided 2026-10-22):
-- - 직원 (employees): the company's staff list (이름, 부서/직책, 휴대폰,
--   이메일, 메모, 사용 여부). Not linked to login accounts. Never deleted:
--   switched off with 사용 여부 (미사용).
-- - 거래처 (partners): one table for both kinds, picked by 구분
--   (partner_type): 매출처 (sales: we sell to them), 매입처 (purchase: we buy
--   from them) or 매출·매입 (both). Never deleted: 사용 / 미사용.
--   * 거래처코드 is typed by the user, same rules as 상품코드: 1–30 letters,
--     digits, ".", "_", "-"; unique ignoring upper/lower case.
--   * 대표연락처 and every other phone number is stored as digits only
--     (e.g. "0212345678"); the app shows it as 02-1234-5678.
--   * 사업자등록번호: 10 digits with a valid check digit (the official
--     formula). NOT unique: a company may have several 거래처 (the app only
--     warns when the number is used elsewhere).
--   * 거래조건: 결제일 (미지정 / 건별 즉시 / 매월 N일 (1–28) / 매월 말일),
--     외상(잔액) 한도 (무제한 / 한도 설정 + 금액 / 외상 불가), 계산서 발행
--     (건별 / 월합계 / 미발행), 전표 인쇄 (금액 인쇄 / 수량만 인쇄).
--   * 영업담당 / 배송담당: an employee from the 직원 list (optional). Only a
--     사용 employee can be newly chosen; a partner keeps an employee who was
--     switched off later.
--   * 거래처분류: ONE level, managed by the users (add, rename, reorder,
--     사용 / 사용 중지, delete only when no partner uses it). Optional per
--     partner: null = 미분류. Only a 사용 category can be newly chosen.
--   * 담당자정보: 0 or more contacts per partner, at most one 대표 담당자.
--   * 배송지: 0 or more delivery addresses per partner. When there is any,
--     exactly one is the 기본 배송지 (the list shows it).
-- - Saving a partner together with its contacts and addresses goes through
--   ONE database function (create_partner / update_partner), so a failed
--   save never leaves half of it behind.
-- - Every signed-in employee may read, add and change all rows (single
--   company). Visitors who are not signed in (anon) get nothing.
--
-- Messages a user may see are in Korean. Each one raised by our own
-- functions also carries a short English key in HINT (e.g.
-- 'partner_changed'); the app reads the key to show the message at the
-- right place. The keys are listed in PARTNER_DB_RULES in
-- src/lib/partners/constants.ts: change both places together.
--
-- What this file does, in this order (each step needs the ones before it):
--  1. Shared check functions (trimmed text, phone number, e-mail,
--     사업자등록번호) and a shared "who/when" trigger function.
--  2. Enums for 구분, 업종 and the 거래조건.
--  3. employees (직원).
--  4. partner_categories (거래처분류, one level).
--  5. partners (거래처).
--  6. partner_contacts (담당자) and partner_addresses (배송지).
--  7. Row Level Security, policies and privileges.
--  8. The list view partner_list_items.
--  9. The save functions create_partner / update_partner.
-- 10. The API (PostgREST) is told to reload.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Shared check functions and the "who/when" trigger function
--
-- The app checks the same rules first (src/lib/partners/phone.ts,
-- src/lib/partners/business-number.ts, the zod schemas), so users normally
-- see a friendly message before the database refuses anything. Change both
-- places together.
-- -----------------------------------------------------------------------------

-- Text that is stored trimmed: no spaces, tabs or line breaks at either end,
-- 1 to max_length characters. (Optional text is stored as null, never as
-- an empty string.) Line breaks inside the text are allowed.
create function public.is_trimmed_text(value text, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value !~ '^\s'
    and value !~ '\s$'
    and char_length(value) between 1 and max_length
$$;

comment on function public.is_trimmed_text(text, integer) is '앞뒤 공백 없이 1~max_length자인 글자인지 확인합니다 (선택 입력 칸은 비우면 null로 저장).';

-- A Korean phone number, digits only (no "-"):
--   02 (서울)                    9–10 digits   02-123-4567, 02-1234-5678
--   031–033, 041–044, 051–055,
--   061–064 (other areas)        10–11 digits  031-123-4567
--   010, 011, 016–019 (mobile)   10–11 digits  010-1234-5678
--   070 (internet phone)         11 digits     070-1234-5678
--   0502–0508 (안심번호 etc.)     11–12 digits  0505-123-4567
--   080 (toll-free)              10–11 digits  080-123-4567
--   15xx, 16xx, 18xx (대표번호)  8 digits      1588-1234
-- Same pattern as PHONE_PATTERN in src/lib/partners/phone.ts.
create function public.is_valid_phone(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value ~ '^(02[0-9]{7,8}|0(3[1-3]|4[1-4]|5[1-5]|6[1-4])[0-9]{7,8}|01[016789][0-9]{7,8}|070[0-9]{8}|050[2-8][0-9]{7,8}|080[0-9]{7,8}|1[568][0-9]{6})$'
$$;

comment on function public.is_valid_phone(text) is '한국 전화번호(숫자만, 하이픈 없이)인지 확인합니다: 02/지역번호, 휴대폰(010 등), 070, 050X, 080, 15XX·16XX·18XX 대표번호.';

-- An e-mail address: something@something.something without spaces, at most
-- 254 characters. (A simple check against typos, not a full RFC check.)
-- Same rule as EMAIL_PATTERN in src/lib/partners/constants.ts.
create function public.is_valid_email(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and char_length(value) <= 254
$$;

comment on function public.is_valid_email(text) is '이메일 주소 형식(아이디@도메인.주소, 공백 없음, 254자 이하)인지 확인합니다.';

-- 사업자등록번호 (also 고유번호): 10 digits whose last digit is the check
-- digit of the official formula:
--   sum = d1×1 + d2×3 + d3×7 + d4×1 + d5×3 + d6×7 + d7×1 + d8×3 + d9×5
--         + floor(d9 × 5 ÷ 10)
--   check digit = (10 − sum mod 10) mod 10, which must equal d10.
-- Same formula as isValidBusinessNumber in src/lib/partners/business-number.ts.
create function public.is_valid_business_number(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  weights constant integer[] := array[1, 3, 7, 1, 3, 7, 1, 3, 5];
  total integer := 0;
  digit_number integer;
begin
  if value is null or value !~ '^[0-9]{10}$' then
    return false;
  end if;

  for digit_number in 1..9 loop
    total := total + substr(value, digit_number, 1)::integer * weights[digit_number];
  end loop;
  -- Integer division: floor(d9 × 5 ÷ 10).
  total := total + (substr(value, 9, 1)::integer * 5) / 10;

  return (10 - total % 10) % 10 = substr(value, 10, 1)::integer;
end;
$$;

comment on function public.is_valid_business_number(text) is '사업자등록번호(숫자 10자리)의 검증번호(마지막 자리)가 국세청 계산식과 맞는지 확인합니다.';

-- The tables below use these functions in CHECK constraints, which run with
-- the privileges of the employee who saves. Only signed-in employees (and
-- the server's service role) may run them; not-signed-in visitors (anon)
-- and everyone else (public) may not. Revoke first: Supabase gives new
-- functions default privileges.
revoke all on function public.is_trimmed_text(text, integer) from public, anon, authenticated;
grant execute on function public.is_trimmed_text(text, integer) to authenticated, service_role;
revoke all on function public.is_valid_phone(text) from public, anon, authenticated;
grant execute on function public.is_valid_phone(text) to authenticated, service_role;
revoke all on function public.is_valid_email(text) from public, anon, authenticated;
grant execute on function public.is_valid_email(text) to authenticated, service_role;
revoke all on function public.is_valid_business_number(text) from public, anon, authenticated;
grant execute on function public.is_valid_business_number(text) to authenticated, service_role;

-- Fills in who/when automatically, so the app (or a user) cannot fake it
-- (same rules as set_product_audit_fields for products):
-- - on insert: created_at/updated_at = now, created_by and updated_by = the
--   signed-in employee;
-- - on update: updated_at = now, updated_by = the signed-in employee; id and
--   created_at/created_by keep their original values.
-- auth.uid() is null when SQL is run by an admin (seed, dashboard).
-- Used by employees and partners (tables with created_by/updated_by).
create function public.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

comment on function public.set_audit_fields() is '등록자·수정자·수정 일시를 자동으로 채웁니다 (직원, 거래처).';

-- -----------------------------------------------------------------------------
-- 2. Enums
-- The order of the values is the sort order of the list (a click on the
-- column title); the app shows the choices in its own order.
-- -----------------------------------------------------------------------------

create type public.partner_type as enum ('sales', 'purchase', 'both');
comment on type public.partner_type is '거래처 구분: sales=매출처(우리가 파는 곳), purchase=매입처(우리가 사 오는 곳), both=매출·매입(둘 다)';

create type public.partner_industry as enum (
  'korean', 'chinese', 'japanese', 'western', 'snack', 'cafe_bakery', 'pub',
  'catering', 'franchise', 'food_distribution', 'other'
);
comment on type public.partner_industry is '업종: korean=한식, chinese=중식, japanese=일식, western=양식, snack=분식, cafe_bakery=카페·베이커리, pub=주점, catering=단체급식, franchise=프랜차이즈, food_distribution=식자재 도소매, other=기타';

-- Sorted: 건별 즉시 → 매월 N일 (with payment_day) → 매월 말일 → 미지정.
create type public.payment_term as enum ('per_order', 'monthly_day', 'month_end', 'unspecified');
comment on type public.payment_term is '결제일: per_order=건별 즉시, monthly_day=매월 N일(payment_day), month_end=매월 말일, unspecified=미지정';

-- Sorted: 외상 불가 → 한도 금액 (with credit_limit) → 무제한.
create type public.credit_limit_type as enum ('none', 'limited', 'unlimited');
comment on type public.credit_limit_type is '외상(잔액) 한도: none=외상 불가, limited=한도 설정(credit_limit 원), unlimited=무제한';

create type public.invoice_type as enum ('per_order', 'monthly', 'none');
comment on type public.invoice_type is '계산서 발행: per_order=건별, monthly=월합계, none=미발행';

create type public.slip_print_type as enum ('with_amount', 'quantity_only');
comment on type public.slip_print_type is '전표 인쇄: with_amount=금액 인쇄, quantity_only=수량만 인쇄';

-- -----------------------------------------------------------------------------
-- 3. employees: 직원 명단
-- -----------------------------------------------------------------------------

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job_title text,
  mobile text,
  email text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  -- Limits: EMPLOYEE_LIMITS in src/lib/employees/schema.ts.
  constraint employees_name_check
    check (public.is_trimmed_text(name, 30)),
  constraint employees_job_title_check
    check (job_title is null or public.is_trimmed_text(job_title, 50)),
  constraint employees_mobile_check
    check (mobile is null or public.is_valid_phone(mobile)),
  constraint employees_email_check
    check (email is null or public.is_valid_email(email)),
  constraint employees_note_check
    check (note is null or public.is_trimmed_text(note, 1000))
);

create index employees_is_active_idx on public.employees (is_active);

comment on table public.employees is '직원 명단. 거래처의 영업담당·배송담당으로 고릅니다. 삭제하지 않고 사용 여부(is_active)로 관리합니다. 로그인 계정과는 연결되어 있지 않습니다.';
comment on column public.employees.id is '직원 고유 ID (자동 생성)';
comment on column public.employees.name is '이름 (1~30자, 같은 이름도 등록 가능)';
comment on column public.employees.job_title is '부서/직책 (예: 영업팀 차장)';
comment on column public.employees.mobile is '휴대폰 번호 (숫자만 저장, 화면에는 010-1234-5678 형식)';
comment on column public.employees.email is '이메일';
comment on column public.employees.note is '메모';
comment on column public.employees.is_active is '사용 여부 (false면 미사용: 영업담당·배송담당으로 새로 고를 수 없음)';
comment on column public.employees.created_at is '등록 일시';
comment on column public.employees.updated_at is '마지막 수정 일시';
comment on column public.employees.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.employees.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger employees_set_audit_fields
  before insert or update on public.employees
  for each row execute function public.set_audit_fields();

-- -----------------------------------------------------------------------------
-- 4. partner_categories: 거래처분류 (one level)
-- -----------------------------------------------------------------------------

create table public.partner_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Name: trimmed, 1–30 characters, Unicode NFC form (the app turns pasted,
  -- decomposed Hangul into NFC first), so names that look the same also
  -- count as the same for the unique rule below.
  constraint partner_categories_name_check
    check (public.is_trimmed_text(name, 30) and name is nfc normalized),
  -- No two 거래처분류 with the same name.
  constraint partner_categories_name_key unique (name)
);

comment on table public.partner_categories is '거래처분류 (1단계). 거래처마다 하나를 고르거나 비워 둡니다(미분류). 쓰는 거래처가 있으면 삭제할 수 없습니다.';
comment on column public.partner_categories.id is '분류 고유 ID (자동 생성)';
comment on column public.partner_categories.name is '분류 이름 (중복 불가, 1~30자)';
comment on column public.partner_categories.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.partner_categories.is_active is '사용 여부. 중지하면 거래처에 새로 고를 수 없습니다 (이미 넣은 거래처는 그대로)';
comment on column public.partner_categories.created_at is '등록 일시';
comment on column public.partner_categories.updated_at is '마지막 수정 일시';

-- updated_at = now on every change (shared function from the first migration).
create trigger partner_categories_set_updated_at
  before update on public.partner_categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. partners: 거래처
-- -----------------------------------------------------------------------------

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  partner_type public.partner_type not null,
  code text not null,
  name text not null,
  phone text,
  industry public.partner_industry,
  sales_rep_id uuid references public.employees (id) on delete restrict,
  delivery_rep_id uuid references public.employees (id) on delete restrict,
  category_id uuid references public.partner_categories (id) on delete restrict,
  -- 거래조건
  payment_term public.payment_term not null default 'unspecified',
  payment_day integer,
  credit_limit_type public.credit_limit_type not null default 'unlimited',
  credit_limit bigint,
  invoice_type public.invoice_type not null default 'monthly',
  slip_print public.slip_print_type not null default 'with_amount',
  -- 사업자정보
  business_number text,
  company_name text,
  representative text,
  business_category text,
  business_item text,
  postal_code text,
  address text,
  address_detail text,
  tax_email text,
  -- 특이사항
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  -- Limits: PARTNER_LIMITS in src/lib/partners/constants.ts.
  -- 거래처코드: 1–30 letters, digits, ".", "_" or "-" (no spaces).
  constraint partners_code_check
    check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  constraint partners_name_check
    check (public.is_trimmed_text(name, 100)),
  constraint partners_phone_check
    check (phone is null or public.is_valid_phone(phone)),
  -- 매월 N일: the day (1–28) is required; any other 결제일: no day.
  -- (No 29–31: 매월 말일 covers the end of every month.)
  -- "is not null" is written out: a comparison with an empty value is
  -- "unknown", and a CHECK lets "unknown" pass.
  constraint partners_payment_day_check
    check (
      (
        payment_term = 'monthly_day'
        and payment_day is not null
        and payment_day between 1 and 28
      )
      or (payment_term <> 'monthly_day' and payment_day is null)
    ),
  -- 한도 설정: the amount (whole won, 0 or more) is required; 무제한 and
  -- 외상 불가: no amount.
  constraint partners_credit_limit_check
    check (
      (
        credit_limit_type = 'limited'
        and credit_limit is not null
        and credit_limit >= 0
      )
      or (credit_limit_type <> 'limited' and credit_limit is null)
    ),
  constraint partners_business_number_check
    check (business_number is null or public.is_valid_business_number(business_number)),
  constraint partners_company_name_check
    check (company_name is null or public.is_trimmed_text(company_name, 100)),
  constraint partners_representative_check
    check (representative is null or public.is_trimmed_text(representative, 50)),
  constraint partners_business_category_check
    check (business_category is null or public.is_trimmed_text(business_category, 100)),
  constraint partners_business_item_check
    check (business_item is null or public.is_trimmed_text(business_item, 100)),
  -- 우편번호: the 5-digit 국가기초구역번호.
  constraint partners_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  constraint partners_address_check
    check (address is null or public.is_trimmed_text(address, 200)),
  constraint partners_address_detail_check
    check (address_detail is null or public.is_trimmed_text(address_detail, 200)),
  -- 우편번호 or 상세주소 only make sense with a 주소.
  constraint partners_address_parts_check
    check (address is not null or (postal_code is null and address_detail is null)),
  constraint partners_tax_email_check
    check (tax_email is null or public.is_valid_email(tax_email)),
  constraint partners_note_check
    check (note is null or public.is_trimmed_text(note, 2000))
);

-- 거래처코드 is unique ignoring case: "a001" and "A001" are the same code.
create unique index partners_code_lower_key on public.partners (lower(code));
-- 사업자등록번호 is NOT unique; this index finds the partners sharing one.
create index partners_business_number_idx on public.partners (business_number)
  where business_number is not null;
create index partners_category_id_idx on public.partners (category_id);
create index partners_sales_rep_id_idx on public.partners (sales_rep_id);
create index partners_delivery_rep_id_idx on public.partners (delivery_rep_id);
create index partners_is_active_idx on public.partners (is_active);

comment on table public.partners is '거래처 (매출처·매입처). 삭제하지 않고 사용 여부(is_active)로 관리합니다.';
comment on column public.partners.id is '거래처 고유 ID (자동 생성)';
comment on column public.partners.partner_type is '구분 (sales=매출처, purchase=매입처, both=매출·매입)';
comment on column public.partners.code is '거래처코드 (직접 입력, 영문·숫자·.-_ 1~30자, 대소문자 구분 없이 중복 불가)';
comment on column public.partners.name is '거래처명 (1~100자)';
comment on column public.partners.phone is '대표연락처 (숫자만 저장, 화면에는 02-123-4567 형식)';
comment on column public.partners.industry is '업종 (한식, 중식, … 비어 있으면 미지정)';
comment on column public.partners.sales_rep_id is '영업담당 직원 ID (employees)';
comment on column public.partners.delivery_rep_id is '배송담당 직원 ID (employees)';
comment on column public.partners.category_id is '거래처분류 ID. 비어 있으면 미분류';
comment on column public.partners.payment_term is '결제일 (건별 즉시 / 매월 N일 / 매월 말일 / 미지정)';
comment on column public.partners.payment_day is '매월 N일 결제의 N (1~28). 다른 결제일이면 비어 있음';
comment on column public.partners.credit_limit_type is '외상(잔액) 한도 종류 (무제한 / 한도 설정 / 외상 불가)';
comment on column public.partners.credit_limit is '외상(잔액) 한도 금액 (원, 0 이상). 한도 설정일 때만 있음';
comment on column public.partners.invoice_type is '계산서 발행 (건별 / 월합계 / 미발행)';
comment on column public.partners.slip_print is '전표 인쇄 (금액 인쇄 / 수량만 인쇄)';
comment on column public.partners.business_number is '사업자등록번호 (숫자 10자리, 검증번호 확인. 다른 거래처와 같아도 됨)';
comment on column public.partners.company_name is '상호(법인명)';
comment on column public.partners.representative is '대표자명';
comment on column public.partners.business_category is '업태 (사업자등록증의 업태)';
comment on column public.partners.business_item is '종목 (사업자등록증의 종목)';
comment on column public.partners.postal_code is '사업장 우편번호 (숫자 5자리)';
comment on column public.partners.address is '사업장 주소 (도로명 주소)';
comment on column public.partners.address_detail is '사업장 상세주소';
comment on column public.partners.tax_email is '세금계산서 받을 이메일';
comment on column public.partners.note is '특이사항 (2000자 이하)';
comment on column public.partners.is_active is '사용 여부 (false면 미사용 거래처)';
comment on column public.partners.created_at is '등록 일시';
comment on column public.partners.updated_at is '마지막 수정 일시';
comment on column public.partners.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.partners.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger partners_set_audit_fields
  before insert or update on public.partners
  for each row execute function public.set_audit_fields();

-- Runs when a partner is added, and when its 거래처분류, 영업담당 or
-- 배송담당 changes: a newly chosen one must exist and be 사용. A partner
-- keeps one that was switched off later (only a change is checked).
-- The chosen row is read with a lock (FOR SHARE): switching it off at the
-- same moment waits until this save is finished, or this save waits and
-- then sees it switched off. (This relies on Postgres' default isolation
-- level READ COMMITTED.)
create function public.check_partner_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  chosen_is_active boolean;
begin
  -- 거래처분류
  if new.category_id is not null
    and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    select category.is_active into chosen_is_active
    from public.partner_categories as category
    where category.id = new.category_id
    for share;

    if not found then
      raise exception '선택한 거래처분류를 찾을 수 없습니다. 삭제되었을 수 있으니 분류를 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'partner_category_not_found';
    end if;
    if not chosen_is_active then
      raise exception '사용 중지된 거래처분류에는 거래처를 새로 넣을 수 없습니다. 다른 분류를 선택해 주세요.'
        using errcode = 'check_violation', hint = 'partner_category_inactive';
    end if;
  end if;

  -- 영업담당
  if new.sales_rep_id is not null
    and (tg_op = 'INSERT' or new.sales_rep_id is distinct from old.sales_rep_id) then
    select employee.is_active into chosen_is_active
    from public.employees as employee
    where employee.id = new.sales_rep_id
    for share;

    if not found then
      raise exception '영업담당으로 고른 직원을 찾을 수 없습니다. 영업담당을 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'sales_rep_not_found';
    end if;
    if not chosen_is_active then
      raise exception '미사용 직원은 영업담당으로 새로 지정할 수 없습니다. 다른 직원을 선택해 주세요.'
        using errcode = 'check_violation', hint = 'sales_rep_inactive';
    end if;
  end if;

  -- 배송담당
  if new.delivery_rep_id is not null
    and (tg_op = 'INSERT' or new.delivery_rep_id is distinct from old.delivery_rep_id) then
    select employee.is_active into chosen_is_active
    from public.employees as employee
    where employee.id = new.delivery_rep_id
    for share;

    if not found then
      raise exception '배송담당으로 고른 직원을 찾을 수 없습니다. 배송담당을 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'delivery_rep_not_found';
    end if;
    if not chosen_is_active then
      raise exception '미사용 직원은 배송담당으로 새로 지정할 수 없습니다. 다른 직원을 선택해 주세요.'
        using errcode = 'check_violation', hint = 'delivery_rep_inactive';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.check_partner_references() is '거래처에 새로 고른 거래처분류·영업담당·배송담당이 있고 사용 중인지 확인합니다 (이미 지정된 값은 그대로 둘 수 있음).';

create trigger partners_check_references
  before insert or update of category_id, sales_rep_id, delivery_rep_id
  on public.partners
  for each row execute function public.check_partner_references();

comment on trigger partners_check_references on public.partners is '새로 고른 거래처분류·영업담당·배송담당이 사용 중인지 확인합니다.';

-- -----------------------------------------------------------------------------
-- 6. partner_contacts (담당자) and partner_addresses (배송지)
--
-- Rows belong to one partner. The app saves them only together with the
-- partner (create_partner / update_partner, step 9). A partner is never
-- deleted by the app; if an administrator deletes one, its contacts and
-- addresses go with it (on delete cascade).
-- -----------------------------------------------------------------------------

create table public.partner_contacts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  name text not null,
  job_title text,
  mobile text,
  phone text,
  email text,
  memo text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint partner_contacts_name_check
    check (public.is_trimmed_text(name, 50)),
  constraint partner_contacts_job_title_check
    check (job_title is null or public.is_trimmed_text(job_title, 50)),
  constraint partner_contacts_mobile_check
    check (mobile is null or public.is_valid_phone(mobile)),
  constraint partner_contacts_phone_check
    check (phone is null or public.is_valid_phone(phone)),
  constraint partner_contacts_email_check
    check (email is null or public.is_valid_email(email)),
  constraint partner_contacts_memo_check
    check (memo is null or public.is_trimmed_text(memo, 500))
);

create index partner_contacts_partner_id_idx on public.partner_contacts (partner_id);
-- At most one 대표 담당자 per partner.
create unique index partner_contacts_one_primary_key
  on public.partner_contacts (partner_id)
  where is_primary;

comment on table public.partner_contacts is '거래처 담당자 (거래처마다 0명 이상, 대표 담당자는 최대 1명).';
comment on column public.partner_contacts.id is '담당자 고유 ID (자동 생성)';
comment on column public.partner_contacts.partner_id is '거래처 ID';
comment on column public.partner_contacts.name is '이름 (1~50자)';
comment on column public.partner_contacts.job_title is '부서/직책';
comment on column public.partner_contacts.mobile is '휴대폰 번호 (숫자만 저장)';
comment on column public.partner_contacts.phone is '전화번호 (숫자만 저장)';
comment on column public.partner_contacts.email is '이메일';
comment on column public.partner_contacts.memo is '메모 (500자 이하)';
comment on column public.partner_contacts.is_primary is '대표 담당자 여부 (거래처마다 최대 1명)';
comment on column public.partner_contacts.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.partner_contacts.created_at is '등록 일시';
comment on column public.partner_contacts.updated_at is '마지막 수정 일시';

create trigger partner_contacts_set_updated_at
  before update on public.partner_contacts
  for each row execute function public.set_updated_at();

create table public.partner_addresses (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  label text not null,
  postal_code text,
  address text not null,
  address_detail text,
  recipient text,
  phone text,
  memo text,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint partner_addresses_label_check
    check (public.is_trimmed_text(label, 50)),
  constraint partner_addresses_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  constraint partner_addresses_address_check
    check (public.is_trimmed_text(address, 200)),
  constraint partner_addresses_address_detail_check
    check (address_detail is null or public.is_trimmed_text(address_detail, 200)),
  constraint partner_addresses_recipient_check
    check (recipient is null or public.is_trimmed_text(recipient, 50)),
  constraint partner_addresses_phone_check
    check (phone is null or public.is_valid_phone(phone)),
  constraint partner_addresses_memo_check
    check (memo is null or public.is_trimmed_text(memo, 200))
);

create index partner_addresses_partner_id_idx on public.partner_addresses (partner_id);
-- At most one 기본 배송지 per partner ("at least one" is checked at commit,
-- see check_partner_default_address below).
create unique index partner_addresses_one_default_key
  on public.partner_addresses (partner_id)
  where is_default;

comment on table public.partner_addresses is '거래처 배송지 (거래처마다 0곳 이상). 배송지가 있으면 그중 정확히 1곳이 기본 배송지입니다.';
comment on column public.partner_addresses.id is '배송지 고유 ID (자동 생성)';
comment on column public.partner_addresses.partner_id is '거래처 ID';
comment on column public.partner_addresses.label is '배송지명 (예: 본점, 2호점 주방)';
comment on column public.partner_addresses.postal_code is '우편번호 (숫자 5자리)';
comment on column public.partner_addresses.address is '주소 (도로명 주소)';
comment on column public.partner_addresses.address_detail is '상세주소';
comment on column public.partner_addresses.recipient is '받는 분';
comment on column public.partner_addresses.phone is '받는 분 연락처 (숫자만 저장)';
comment on column public.partner_addresses.memo is '배송 메모 (예: 오전 10시 전 납품, 뒷문)';
comment on column public.partner_addresses.is_default is '기본 배송지 여부 (배송지가 있으면 정확히 1곳)';
comment on column public.partner_addresses.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.partner_addresses.created_at is '등록 일시';
comment on column public.partner_addresses.updated_at is '마지막 수정 일시';

create trigger partner_addresses_set_updated_at
  before update on public.partner_addresses
  for each row execute function public.set_updated_at();

-- "A partner with addresses has exactly one 기본 배송지." At most one is
-- kept by the unique index above; "at least one" is checked when the
-- transaction is committed (DEFERRABLE INITIALLY DEFERRED), because a save
-- first clears the old 기본 배송지 and then marks the new one.
-- The partner row is locked first (FOR NO KEY UPDATE): two saves at the
-- same moment are checked one after the other, each seeing the other's
-- result.
create function public.check_partner_default_address()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  checked_ids uuid[];
  checked_id uuid;
  partner_code text;
  address_count integer;
  default_count integer;
begin
  if tg_op = 'INSERT' then
    checked_ids := array[new.partner_id];
  elsif tg_op = 'DELETE' then
    checked_ids := array[old.partner_id];
  else
    checked_ids := array[old.partner_id, new.partner_id];
  end if;

  foreach checked_id in array checked_ids loop
    select partner.code into partner_code
    from public.partners as partner
    where partner.id = checked_id
    for no key update;

    -- The partner was deleted in this same transaction: nothing to check.
    if found then
      select count(*), count(*) filter (where address.is_default)
      into address_count, default_count
      from public.partner_addresses as address
      where address.partner_id = checked_id;

      if address_count > 0 and default_count <> 1 then
        raise exception '거래처(%)의 배송지 중 기본 배송지를 1곳 정해 주세요.', partner_code
          using errcode = 'check_violation', hint = 'partner_default_address_required';
      end if;
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.check_partner_default_address() is '배송지가 있는 거래처에 기본 배송지가 정확히 1곳 있는지 확인합니다 (트랜잭션을 마칠 때 검사).';

create constraint trigger partner_addresses_keep_default
  after insert or delete or update of is_default, partner_id
  on public.partner_addresses
  deferrable initially deferred
  for each row execute function public.check_partner_default_address();

comment on trigger partner_addresses_keep_default on public.partner_addresses is '배송지가 있는데 기본 배송지가 없으면 거절합니다 (트랜잭션이 끝날 때 검사).';

-- -----------------------------------------------------------------------------
-- 7. Row Level Security and privileges
-- Every signed-in employee (role "authenticated") works with all rows.
-- Visitors who are not signed in (role "anon") get nothing.
-- New tables are not exposed to the API automatically: the privileges are
-- given explicitly (revoke first: Supabase may give default privileges).
-- -----------------------------------------------------------------------------

alter table public.employees enable row level security;
alter table public.partner_categories enable row level security;
alter table public.partners enable row level security;
alter table public.partner_contacts enable row level security;
alter table public.partner_addresses enable row level security;

-- employees: read, add, change. Never deleted (no delete policy, no DELETE
-- privilege): switched off with is_active.
create policy "Employees can read employees"
  on public.employees for select to authenticated
  using (true);
create policy "Employees can add employees"
  on public.employees for insert to authenticated
  with check (true);
create policy "Employees can change employees"
  on public.employees for update to authenticated
  using (true) with check (true);

-- partner_categories: read, add, change, delete. A category that partners
-- still use cannot be deleted: the foreign key (on delete restrict) stops it.
create policy "Employees can read partner categories"
  on public.partner_categories for select to authenticated
  using (true);
create policy "Employees can add partner categories"
  on public.partner_categories for insert to authenticated
  with check (true);
create policy "Employees can change partner categories"
  on public.partner_categories for update to authenticated
  using (true) with check (true);
create policy "Employees can delete partner categories"
  on public.partner_categories for delete to authenticated
  using (true);

-- partners: read, add, change. Never deleted.
create policy "Employees can read partners"
  on public.partners for select to authenticated
  using (true);
create policy "Employees can add partners"
  on public.partners for insert to authenticated
  with check (true);
create policy "Employees can change partners"
  on public.partners for update to authenticated
  using (true) with check (true);

-- partner_contacts / partner_addresses: read, add, change, delete (removing
-- a contact or an address deletes its row).
create policy "Employees can read partner contacts"
  on public.partner_contacts for select to authenticated
  using (true);
create policy "Employees can add partner contacts"
  on public.partner_contacts for insert to authenticated
  with check (true);
create policy "Employees can change partner contacts"
  on public.partner_contacts for update to authenticated
  using (true) with check (true);
create policy "Employees can delete partner contacts"
  on public.partner_contacts for delete to authenticated
  using (true);

create policy "Employees can read partner addresses"
  on public.partner_addresses for select to authenticated
  using (true);
create policy "Employees can add partner addresses"
  on public.partner_addresses for insert to authenticated
  with check (true);
create policy "Employees can change partner addresses"
  on public.partner_addresses for update to authenticated
  using (true) with check (true);
create policy "Employees can delete partner addresses"
  on public.partner_addresses for delete to authenticated
  using (true);

revoke all on table public.employees from anon, authenticated;
revoke all on table public.partner_categories from anon, authenticated;
revoke all on table public.partners from anon, authenticated;
revoke all on table public.partner_contacts from anon, authenticated;
revoke all on table public.partner_addresses from anon, authenticated;

grant select, insert, update on table public.employees to authenticated;
grant select, insert, update on table public.partners to authenticated;
grant select, insert, delete on table public.partner_categories to authenticated;
grant select, insert, delete on table public.partner_contacts to authenticated;
grant select, insert, delete on table public.partner_addresses to authenticated;
-- Only these columns can be changed through the API: ids never change, and
-- a contact or an address never moves to another partner. A column the app
-- must edit later has to be added here.
grant update (name, sort_order, is_active)
  on table public.partner_categories to authenticated;
grant update (name, job_title, mobile, phone, email, memo, is_primary, sort_order)
  on table public.partner_contacts to authenticated;
grant update (label, postal_code, address, address_detail, recipient, phone, memo, is_default, sort_order)
  on table public.partner_addresses to authenticated;

grant all on table public.employees to service_role;
grant all on table public.partner_categories to service_role;
grant all on table public.partners to service_role;
grant all on table public.partner_contacts to service_role;
grant all on table public.partner_addresses to service_role;

-- -----------------------------------------------------------------------------
-- 8. partner_list_items: the 거래처관리 list's view
--
-- One row per partner with every partners column, plus:
-- - category_name / category_sort_order / category_is_active (거래처분류;
--   empty for 미분류);
-- - sales_rep_name / sales_rep_is_active, delivery_rep_name /
--   delivery_rep_is_active (영업담당 / 배송담당; empty when not set);
-- - default_address_*: the 기본 배송지 (empty when the partner has none),
--   default_address_text = 주소 + " " + 상세주소 (for the list and its sort);
-- - contact_count, address_count.
-- "partner.*" is turned into a fixed list of columns when the view is
-- created: after adding a column to partners, drop and create this view
-- again (with its comments and privileges).
-- security_invoker: the view uses the permissions (RLS) of the employee
-- asking, exactly like the tables.
-- -----------------------------------------------------------------------------

create view public.partner_list_items
with (security_invoker = true)
as
select
  partner.*,
  category.name as category_name,
  category.sort_order as category_sort_order,
  category.is_active as category_is_active,
  sales_rep.name as sales_rep_name,
  sales_rep.is_active as sales_rep_is_active,
  delivery_rep.name as delivery_rep_name,
  delivery_rep.is_active as delivery_rep_is_active,
  default_address.id as default_address_id,
  default_address.label as default_address_label,
  default_address.postal_code as default_address_postal_code,
  default_address.address as default_address,
  default_address.address_detail as default_address_detail,
  case
    when default_address.id is not null then
      concat_ws(' ', default_address.address, default_address.address_detail)
  end as default_address_text,
  (
    select count(*)::integer
    from public.partner_contacts as contact
    where contact.partner_id = partner.id
  ) as contact_count,
  (
    select count(*)::integer
    from public.partner_addresses as address
    where address.partner_id = partner.id
  ) as address_count
from public.partners as partner
left join public.partner_categories as category
  on category.id = partner.category_id
left join public.employees as sales_rep
  on sales_rep.id = partner.sales_rep_id
left join public.employees as delivery_rep
  on delivery_rep.id = partner.delivery_rep_id
-- At most one row: one 기본 배송지 per partner (unique index).
left join public.partner_addresses as default_address
  on default_address.partner_id = partner.id
  and default_address.is_default;

comment on view public.partner_list_items is '거래처 목록용: 거래처와 거래처분류 이름, 영업담당·배송담당 이름, 기본 배송지, 담당자·배송지 수. 미분류 거래처도 포함됩니다.';
comment on column public.partner_list_items.category_name is '거래처분류 이름 (미분류면 비어 있음)';
comment on column public.partner_list_items.category_sort_order is '거래처분류의 순서 (미분류면 비어 있음)';
comment on column public.partner_list_items.category_is_active is '거래처분류 사용 여부 (미분류면 비어 있음)';
comment on column public.partner_list_items.sales_rep_name is '영업담당 직원 이름 (없으면 비어 있음)';
comment on column public.partner_list_items.sales_rep_is_active is '영업담당 직원 사용 여부 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_name is '배송담당 직원 이름 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_is_active is '배송담당 직원 사용 여부 (없으면 비어 있음)';
comment on column public.partner_list_items.default_address_id is '기본 배송지 ID (배송지가 없으면 비어 있음)';
comment on column public.partner_list_items.default_address_label is '기본 배송지명';
comment on column public.partner_list_items.default_address_postal_code is '기본 배송지 우편번호';
comment on column public.partner_list_items.default_address is '기본 배송지 주소';
comment on column public.partner_list_items.default_address_detail is '기본 배송지 상세주소';
comment on column public.partner_list_items.default_address_text is '기본 배송지 주소 + 상세주소 (목록 표시·정렬용)';
comment on column public.partner_list_items.contact_count is '담당자 수';
comment on column public.partner_list_items.address_count is '배송지 수';

revoke all on table public.partner_list_items from anon, authenticated;
grant select on table public.partner_list_items to authenticated;
grant select on table public.partner_list_items to service_role;

-- -----------------------------------------------------------------------------
-- 9. Saving a partner together with its contacts and addresses
--
-- A partner is three kinds of rows: the partner, its 담당자 and its 배송지.
-- These functions save all of them in one go: everything is saved, or
-- nothing.
--
-- - security invoker: they run with the permissions of the employee calling
--   them (the same RLS and privileges as direct table access).
-- - search_path = '': every table name is written in full (public.…).
-- - Only signed-in employees may call them (grants below).
--
-- Arguments (JSON, written by src/lib/partners/actions.ts; keys are the
-- column names; empty optional values are null):
--   partner:   {"partner_type", "code", "name", "phone", "industry",
--               "sales_rep_id", "delivery_rep_id", "category_id",
--               "is_active", "payment_term", "payment_day",
--               "credit_limit_type", "credit_limit", "invoice_type",
--               "slip_print", "business_number", "company_name",
--               "representative", "business_category", "business_item",
--               "postal_code", "address", "address_detail", "tax_email",
--               "note"}
--   contacts:  [{"id" (null = new), "name", "job_title", "mobile", "phone",
--                "email", "memo", "is_primary"}, …] in screen order
--   addresses: [{"id" (null = new), "label", "postal_code", "address",
--                "address_detail", "recipient", "phone", "memo",
--                "is_default"}, …] in screen order
-- Contacts and addresses that are already saved keep their id (later
-- modules, e.g. 판매·출고, may point to a 배송지).
-- -----------------------------------------------------------------------------

-- Shared by create_partner and update_partner: makes the partner's 담당자
-- and 배송지 exactly the given lists.
-- 1. Checks the lists: JSON arrays, at most 50 rows each, each saved row
--    listed once, at most one 대표 담당자 and at most one 기본 배송지.
--    When addresses are given but none is marked 기본, the first one
--    becomes the 기본 배송지 (the owner's rule).
-- 2. Deletes the saved rows that are no longer listed.
-- 3. Clears the 대표/기본 marks, then updates the listed saved rows (by id)
--    and inserts the new ones (no id), in screen order (sort_order 0, 1, …).
--    A listed id that is not one of this partner's rows means the lists
--    changed after the form was opened: nothing is saved.
create function public.save_partner_contacts_and_addresses(
  target_partner_id uuid,
  contacts jsonb,
  addresses jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry record;
  row_id uuid;
  default_number bigint;
begin
  -- 1. The lists.
  if contacts is null or jsonb_typeof(contacts) <> 'array'
    or addresses is null or jsonb_typeof(addresses) <> 'array' then
    raise exception '담당자와 배송지 목록을 읽을 수 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'partner_rows_invalid';
  end if;
  if jsonb_array_length(contacts) > 50 then
    raise exception '담당자는 거래처 하나에 50명까지 등록할 수 있습니다.'
      using errcode = 'check_violation', hint = 'partner_contacts_too_many';
  end if;
  if jsonb_array_length(addresses) > 50 then
    raise exception '배송지는 거래처 하나에 50곳까지 등록할 수 있습니다.'
      using errcode = 'check_violation', hint = 'partner_addresses_too_many';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(contacts) as item (value)
    where item.value ->> 'id' is not null
    group by item.value ->> 'id'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(addresses) as item (value)
    where item.value ->> 'id' is not null
    group by item.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception '같은 담당자나 배송지가 두 번 들어 있습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'partner_rows_invalid';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(contacts) as item (value)
    where coalesce((item.value ->> 'is_primary')::boolean, false)
  ) > 1 then
    raise exception '대표 담당자는 1명만 정할 수 있습니다.'
      using errcode = 'check_violation', hint = 'partner_primary_contact_duplicate';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(addresses) as item (value)
    where coalesce((item.value ->> 'is_default')::boolean, false)
  ) > 1 then
    raise exception '기본 배송지는 1곳만 정할 수 있습니다.'
      using errcode = 'check_violation', hint = 'partner_default_address_duplicate';
  end if;

  -- The 기본 배송지: the one marked, otherwise the first one.
  select coalesce(
    min(item.number) filter (
      where coalesce((item.value ->> 'is_default')::boolean, false)
    ),
    1
  )
  into default_number
  from jsonb_array_elements(addresses) with ordinality as item (value, number);

  -- 2. Delete the saved rows that are no longer listed.
  delete from public.partner_contacts as contact
  where contact.partner_id = target_partner_id
    and contact.id not in (
      select (item.value ->> 'id')::uuid
      from jsonb_array_elements(contacts) as item (value)
      where item.value ->> 'id' is not null
    );
  delete from public.partner_addresses as address
  where address.partner_id = target_partner_id
    and address.id not in (
      select (item.value ->> 'id')::uuid
      from jsonb_array_elements(addresses) as item (value)
      where item.value ->> 'id' is not null
    );

  -- 3. Clear the marks first (one 대표 / 기본 per partner at any moment),
  --    then save every listed row with its own mark.
  update public.partner_contacts as contact
  set is_primary = false
  where contact.partner_id = target_partner_id
    and contact.is_primary;
  update public.partner_addresses as address
  set is_default = false
  where address.partner_id = target_partner_id
    and address.is_default;

  for entry in
    select item.value, item.number
    from jsonb_array_elements(contacts) with ordinality as item (value, number)
  loop
    row_id := (entry.value ->> 'id')::uuid;
    if row_id is null then
      insert into public.partner_contacts (
        partner_id, name, job_title, mobile, phone, email, memo, is_primary,
        sort_order
      )
      values (
        target_partner_id,
        entry.value ->> 'name',
        entry.value ->> 'job_title',
        entry.value ->> 'mobile',
        entry.value ->> 'phone',
        entry.value ->> 'email',
        entry.value ->> 'memo',
        coalesce((entry.value ->> 'is_primary')::boolean, false),
        (entry.number - 1)::integer
      );
    else
      update public.partner_contacts as contact
      set
        name = entry.value ->> 'name',
        job_title = entry.value ->> 'job_title',
        mobile = entry.value ->> 'mobile',
        phone = entry.value ->> 'phone',
        email = entry.value ->> 'email',
        memo = entry.value ->> 'memo',
        is_primary = coalesce((entry.value ->> 'is_primary')::boolean, false),
        sort_order = (entry.number - 1)::integer
      where contact.id = row_id
        and contact.partner_id = target_partner_id;

      if not found then
        raise exception '이 창을 연 뒤에 담당자 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요.'
          using hint = 'partner_changed';
      end if;
    end if;
  end loop;

  for entry in
    select item.value, item.number
    from jsonb_array_elements(addresses) with ordinality as item (value, number)
  loop
    row_id := (entry.value ->> 'id')::uuid;
    if row_id is null then
      insert into public.partner_addresses (
        partner_id, label, postal_code, address, address_detail, recipient,
        phone, memo, is_default, sort_order
      )
      values (
        target_partner_id,
        entry.value ->> 'label',
        entry.value ->> 'postal_code',
        entry.value ->> 'address',
        entry.value ->> 'address_detail',
        entry.value ->> 'recipient',
        entry.value ->> 'phone',
        entry.value ->> 'memo',
        entry.number = default_number,
        (entry.number - 1)::integer
      );
    else
      update public.partner_addresses as address
      set
        label = entry.value ->> 'label',
        postal_code = entry.value ->> 'postal_code',
        address = entry.value ->> 'address',
        address_detail = entry.value ->> 'address_detail',
        recipient = entry.value ->> 'recipient',
        phone = entry.value ->> 'phone',
        memo = entry.value ->> 'memo',
        is_default = entry.number = default_number,
        sort_order = (entry.number - 1)::integer
      where address.id = row_id
        and address.partner_id = target_partner_id;

      if not found then
        raise exception '이 창을 연 뒤에 배송지 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요.'
          using hint = 'partner_changed';
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.save_partner_contacts_and_addresses(uuid, jsonb, jsonb) is '거래처의 담당자·배송지를 주어진 목록과 똑같이 저장합니다 (create_partner / update_partner가 사용).';

-- 거래처 등록. Returns the new partner's id.
create function public.create_partner(
  partner jsonb,
  contacts jsonb,
  addresses jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  -- Who/when are filled in by the partners trigger; the 거래처분류,
  -- 영업담당 and 배송담당 are checked by check_partner_references.
  insert into public.partners (
    partner_type, code, name, phone, industry, sales_rep_id, delivery_rep_id,
    category_id, is_active, payment_term, payment_day, credit_limit_type,
    credit_limit, invoice_type, slip_print, business_number, company_name,
    representative, business_category, business_item, postal_code, address,
    address_detail, tax_email, note
  )
  values (
    (partner ->> 'partner_type')::public.partner_type,
    partner ->> 'code',
    partner ->> 'name',
    partner ->> 'phone',
    (partner ->> 'industry')::public.partner_industry,
    (partner ->> 'sales_rep_id')::uuid,
    (partner ->> 'delivery_rep_id')::uuid,
    (partner ->> 'category_id')::uuid,
    coalesce((partner ->> 'is_active')::boolean, true),
    (partner ->> 'payment_term')::public.payment_term,
    (partner ->> 'payment_day')::integer,
    (partner ->> 'credit_limit_type')::public.credit_limit_type,
    (partner ->> 'credit_limit')::bigint,
    (partner ->> 'invoice_type')::public.invoice_type,
    (partner ->> 'slip_print')::public.slip_print_type,
    partner ->> 'business_number',
    partner ->> 'company_name',
    partner ->> 'representative',
    partner ->> 'business_category',
    partner ->> 'business_item',
    partner ->> 'postal_code',
    partner ->> 'address',
    partner ->> 'address_detail',
    partner ->> 'tax_email',
    partner ->> 'note'
  )
  returning id into new_id;

  perform public.save_partner_contacts_and_addresses(new_id, contacts, addresses);

  return new_id;
end;
$$;

comment on function public.create_partner(jsonb, jsonb, jsonb) is '거래처 등록: 거래처와 담당자·배송지를 한 번에 저장합니다. 새 거래처 ID를 돌려줍니다.';

-- 거래처 수정. Replaces the partner's fields, 담당자 and 배송지.
-- loaded_updated_at = the partner's updated_at when the form was opened: if
-- someone saved it after that, nothing is saved (the older form would
-- silently undo the other person's changes). Every save changes the
-- partner's updated_at, also when only a 담당자 or 배송지 changed.
-- Returns the partner's id.
create function public.update_partner(
  partner_id uuid,
  loaded_updated_at timestamptz,
  partner jsonb,
  contacts jsonb,
  addresses jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_updated_at timestamptz;
begin
  -- The partner as saved now, locked until this save is finished.
  select saved.updated_at into saved_updated_at
  from public.partners as saved
  where saved.id = update_partner.partner_id
  for update;

  -- (No errcode 'no_data_found' here: the API answers that one with a
  -- plain-text error that loses the hint. The default code is fine.)
  if not found then
    raise exception '거래처를 찾을 수 없습니다. 목록에서 다시 선택해 주세요.'
      using hint = 'partner_not_found';
  end if;
  if loaded_updated_at is null or saved_updated_at <> loaded_updated_at then
    raise exception '이 창을 연 뒤에 거래처 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요.'
      using hint = 'partner_changed';
  end if;

  update public.partners as target
  set
    partner_type = (partner ->> 'partner_type')::public.partner_type,
    code = partner ->> 'code',
    name = partner ->> 'name',
    phone = partner ->> 'phone',
    industry = (partner ->> 'industry')::public.partner_industry,
    sales_rep_id = (partner ->> 'sales_rep_id')::uuid,
    delivery_rep_id = (partner ->> 'delivery_rep_id')::uuid,
    category_id = (partner ->> 'category_id')::uuid,
    is_active = coalesce((partner ->> 'is_active')::boolean, true),
    payment_term = (partner ->> 'payment_term')::public.payment_term,
    payment_day = (partner ->> 'payment_day')::integer,
    credit_limit_type = (partner ->> 'credit_limit_type')::public.credit_limit_type,
    credit_limit = (partner ->> 'credit_limit')::bigint,
    invoice_type = (partner ->> 'invoice_type')::public.invoice_type,
    slip_print = (partner ->> 'slip_print')::public.slip_print_type,
    business_number = partner ->> 'business_number',
    company_name = partner ->> 'company_name',
    representative = partner ->> 'representative',
    business_category = partner ->> 'business_category',
    business_item = partner ->> 'business_item',
    postal_code = partner ->> 'postal_code',
    address = partner ->> 'address',
    address_detail = partner ->> 'address_detail',
    tax_email = partner ->> 'tax_email',
    note = partner ->> 'note'
  where target.id = update_partner.partner_id;

  perform public.save_partner_contacts_and_addresses(
    update_partner.partner_id, contacts, addresses
  );

  return update_partner.partner_id;
end;
$$;

comment on function public.update_partner(uuid, timestamptz, jsonb, jsonb, jsonb) is '거래처 수정: 거래처 정보와 담당자·배송지 전체를 한 번에 바꿉니다. 창을 연 뒤 다른 사람이 먼저 저장했으면(updated_at이 다르면) 저장하지 않습니다.';

-- Only signed-in employees may call them; not-signed-in visitors (anon) and
-- everyone else (public) may not. Revoke first: Supabase gives new functions
-- default privileges. (save_partner_contacts_and_addresses runs with the
-- caller's permissions, so it can do nothing the caller could not do with
-- the tables directly.)
revoke all on function public.save_partner_contacts_and_addresses(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_partner_contacts_and_addresses(uuid, jsonb, jsonb)
  to authenticated, service_role;

revoke all on function public.create_partner(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_partner(jsonb, jsonb, jsonb)
  to authenticated, service_role;

revoke all on function public.update_partner(uuid, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_partner(uuid, timestamptz, jsonb, jsonb, jsonb)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Tell the API (PostgREST) to reload its picture of the database, so the
--     new tables, view and functions are usable right away.
-- -----------------------------------------------------------------------------

notify pgrst, 'reload schema';
