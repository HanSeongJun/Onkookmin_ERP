-- =============================================================================
-- 거래처분류 3단계 + 직원관리 확장
--
-- Runs after 20261022062448_partners.sql, which is already in the real
-- (hosted) database together with the rows the owner typed. This file only
-- ADDS to it and fills the new columns of the rows that exist:
--
-- The owner's rules (decided 2026-10-22):
-- - 거래처분류 (partner_categories) gets up to THREE levels, like 상품분류:
--   대분류 (parent_id is null) → 중분류 → 소분류. Every category that
--   exists becomes a 대분류; the partners keep their category.
--   * Names are unique among the categories under the same parent (two
--     대분류 can't share a name either).
--   * Delete only when no partner uses it and it has no sub-categories.
--   * A switched-off category (사용 중지) hides everything below it: a
--     partner can only be newly put into a category that is 사용 together
--     with every category above it (partners already in it keep it).
--   * The 분류값 설정 window saves all its changes (add, rename, reorder,
--     사용/중지, delete) at once with save_partner_categories.
--   * 분류적용 / 분류해제 for the checked partners: set_partner_category.
-- - 직원 (employees) get the fields of the 직원관리 screen:
--   * 직원코드 (same rules as 상품코드, unique ignoring upper/lower case),
--     입사일, 휴대폰번호2, 전화번호, 주소, 부서명, 고용형태, 급여지급여부,
--     퇴사일, and the 배송기사 정보 (운영형태, 차량번호, 차량 종류).
--   * 재직여부 = the existing is_active (true = 재직, false = 퇴사).
--   * 담당업무: 영업담당 (is_sales_rep) = a sales channel / platform such as
--     쿠팡 or 스마트스토어 (later used on 매출/매입 내역); 배송담당
--     (is_delivery_driver) = a driver who delivers a partner's orders. One
--     employee may have both.
--   * A partner's newly chosen 영업담당 must be 재직 and 영업담당; a newly
--     chosen 배송담당 must be 재직 and 배송담당. A partner keeps one whose
--     status or 담당업무 changed later.
--   * Existing employees get the codes 0001, 0002, … in the order they were
--     added, 입사일 = the day they were added (Korea time), and 담당업무 from
--     the partners that point to them (neither → both, so nobody disappears
--     from the 거래처 pickers).
--
-- Messages a user may see are in Korean. Each one raised by our own
-- functions also carries a short English key in HINT; the app reads the key
-- (PARTNER_DB_RULES in src/lib/partners/constants.ts). Change both places
-- together. The employees rules are plain constraints; the app matches them
-- by name (EMPLOYEE_DB_CONSTRAINTS and CHECK_FIELDS in src/lib/employees/).
--
-- What this file does, in this order:
--  1. Enums for 고용형태, 운영형태, 차량 종류.
--  2. employees: new columns, filled for the existing rows, then the rules.
--  3. partner_categories: parent_id, the 3-level trigger, unique names per
--     parent.
--  4. check_partner_references: 상위 분류 사용 여부 + 담당업무 rules.
--  5. Views partner_list_items (again, with the category path) and
--     employee_list_items (new).
--  6. Functions: partner_category_tree_version, save_partner_categories,
--     set_partner_category, suggest_employee_code.
--  7. The API (PostgREST) is told to reload.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums (the order of the values is the sort order of the 직원 list)
-- -----------------------------------------------------------------------------

create type public.employment_type as enum (
  'regular', 'contract', 'daily', 'freelancer', 'other'
);
comment on type public.employment_type is '고용형태: regular=정규직, contract=계약직, daily=일용직, freelancer=프리랜서, other=기타';

create type public.driver_operation_type as enum ('direct', 'consigned', 'chartered');
comment on type public.driver_operation_type is '배송기사 운영형태: direct=직영(회사 차량), consigned=지입(기사 본인 차량을 회사에 지입), chartered=용차(필요할 때 빌리는 차량)';

create type public.vehicle_type as enum (
  'refrigerated_truck', 'frozen_truck', 'box_truck', 'cargo_truck',
  'small_van', 'other'
);
comment on type public.vehicle_type is '차량 종류: refrigerated_truck=냉장탑차, frozen_truck=냉동탑차, box_truck=일반탑차, cargo_truck=카고, small_van=소형(다마스·라보), other=기타';

-- -----------------------------------------------------------------------------
-- 2. employees: 직원관리 fields
-- -----------------------------------------------------------------------------

alter table public.employees
  add column code text,
  add column hire_date date,
  add column is_sales_rep boolean not null default false,
  add column is_delivery_driver boolean not null default false,
  add column mobile2 text,
  add column phone text,
  add column postal_code text,
  add column address text,
  add column address_detail text,
  add column department text,
  add column employment_type public.employment_type,
  add column is_salary_paid boolean not null default true,
  add column resignation_date date,
  add column driver_operation_type public.driver_operation_type,
  add column vehicle_number text,
  add column vehicle_type public.vehicle_type;

-- Fill the new columns of the employees that exist. The "who/when" trigger
-- is switched off meanwhile, so 수정자 / 수정 일시 keep their values (this
-- is not an edit by a user).
alter table public.employees disable trigger employees_set_audit_fields;

-- 직원코드 0001, 0002, … in the order the employees were added (codes are
-- new, so none can clash); 입사일 = the day the employee was added, in
-- Korea time; 담당업무 from the partners that point to them.
with numbered as (
  select
    employee.id,
    row_number() over (order by employee.created_at, employee.id) as number
  from public.employees as employee
)
update public.employees as employee
set
  -- lpad would cut a 5-digit number, so only short numbers get zeros.
  code = case
    when numbered.number < 10000 then lpad(numbered.number::text, 4, '0')
    else numbered.number::text
  end,
  hire_date = (employee.created_at at time zone 'Asia/Seoul')::date,
  is_sales_rep = exists (
    select 1 from public.partners as partner
    where partner.sales_rep_id = employee.id
  ),
  is_delivery_driver = exists (
    select 1 from public.partners as partner
    where partner.delivery_rep_id = employee.id
  )
from numbered
where numbered.id = employee.id;

-- An employee no partner points to gets both 담당업무, so that nobody
-- disappears from the 영업담당 / 배송담당 choices. The owner can uncheck
-- them on the 직원관리 screen.
update public.employees
set is_sales_rep = true, is_delivery_driver = true
where not is_sales_rep and not is_delivery_driver;

alter table public.employees enable trigger employees_set_audit_fields;

alter table public.employees
  alter column code set not null,
  alter column hire_date set not null;

-- Limits: EMPLOYEE_LIMITS in src/lib/employees/schema.ts.
alter table public.employees
  -- 직원코드: 1–30 letters, digits, ".", "_" or "-" (same as 상품코드).
  add constraint employees_code_check
    check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  add constraint employees_mobile2_check
    check (mobile2 is null or public.is_valid_phone(mobile2)),
  add constraint employees_phone_check
    check (phone is null or public.is_valid_phone(phone)),
  add constraint employees_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  add constraint employees_address_check
    check (address is null or public.is_trimmed_text(address, 200)),
  add constraint employees_address_detail_check
    check (address_detail is null or public.is_trimmed_text(address_detail, 200)),
  -- 우편번호 or 상세주소 only make sense with a 주소.
  add constraint employees_address_parts_check
    check (address is not null or (postal_code is null and address_detail is null)),
  add constraint employees_department_check
    check (department is null or public.is_trimmed_text(department, 50)),
  -- 퇴사일 only for a 퇴사 employee, never before the 입사일.
  add constraint employees_resignation_date_check
    check (
      resignation_date is null
      or (not is_active and resignation_date >= hire_date)
    ),
  add constraint employees_vehicle_number_check
    check (vehicle_number is null or public.is_trimmed_text(vehicle_number, 20)),
  -- 배송기사 정보 only for a 배송담당.
  add constraint employees_driver_fields_check
    check (
      is_delivery_driver
      or (
        driver_operation_type is null
        and vehicle_number is null
        and vehicle_type is null
      )
    );

-- 직원코드 is unique ignoring case: "a01" and "A01" are the same code.
create unique index employees_code_lower_key on public.employees (lower(code));

comment on table public.employees is '직원 명단 (직원관리). 영업담당(판매 채널·플랫폼)과 배송담당(직배송 기사)도 여기에 등록하고, 거래처의 영업담당·배송담당으로 고릅니다. 삭제하지 않고 재직여부(is_active)로 관리합니다. 로그인 계정과는 연결되어 있지 않습니다.';
comment on column public.employees.code is '직원코드 (직접 입력, 영문·숫자·.-_ 1~30자, 대소문자 구분 없이 중복 불가. 새로 등록할 때는 다음 번호 0001, 0002 … 를 제안)';
comment on column public.employees.name is '직원명 (1~30자, 같은 이름도 등록 가능)';
comment on column public.employees.hire_date is '입사일';
comment on column public.employees.is_sales_rep is '담당업무: 영업담당 (판매 채널·플랫폼, 예: 쿠팡, 스마트스토어). 거래처의 영업담당으로 고를 수 있음';
comment on column public.employees.is_delivery_driver is '담당업무: 배송담당 (거래처 주문을 직접 배송하는 기사). 거래처의 배송담당으로 고를 수 있음';
comment on column public.employees.mobile is '휴대폰번호1 (숫자만 저장, 화면에는 010-1234-5678 형식). 화면에서는 필수, 예전 직원은 비어 있을 수 있음';
comment on column public.employees.mobile2 is '휴대폰번호2 (숫자만 저장)';
comment on column public.employees.phone is '전화번호 (숫자만 저장)';
comment on column public.employees.email is '이메일';
comment on column public.employees.postal_code is '우편번호 (숫자 5자리)';
comment on column public.employees.address is '주소 (도로명 주소)';
comment on column public.employees.address_detail is '상세주소';
comment on column public.employees.note is '비고';
comment on column public.employees.department is '부서명';
comment on column public.employees.job_title is '직급/직책 (예: 차장, 팀장)';
comment on column public.employees.employment_type is '고용형태 (정규직/계약직/일용직/프리랜서/기타, 비어 있으면 미지정)';
comment on column public.employees.is_salary_paid is '급여지급여부 (true=Y, false=N)';
comment on column public.employees.is_active is '재직여부 (true=재직, false=퇴사). 퇴사한 직원은 영업담당·배송담당으로 새로 고를 수 없음';
comment on column public.employees.resignation_date is '퇴사일 (퇴사한 직원만, 입사일 이후)';
comment on column public.employees.driver_operation_type is '배송기사 운영형태 (직영/지입/용차, 배송담당만)';
comment on column public.employees.vehicle_number is '차량번호 (예: 12가3456, 배송담당만)';
comment on column public.employees.vehicle_type is '차량 종류 (냉장탑차/냉동탑차/일반탑차/카고/소형/기타, 배송담당만)';

-- (Privileges: employees already has table-wide SELECT, INSERT and UPDATE
-- for signed-in employees, which covers the new columns.)

-- -----------------------------------------------------------------------------
-- 3. partner_categories: 대분류 → 중분류 → 소분류
-- -----------------------------------------------------------------------------

-- Every existing category becomes a 대분류 (parent_id stays empty).
alter table public.partner_categories
  add column parent_id uuid
    references public.partner_categories (id) on delete restrict;

create index partner_categories_parent_id_idx
  on public.partner_categories (parent_id);

-- Names were unique in the whole list; now only among the categories under
-- the same parent (NULLS NOT DISTINCT: also no two 대분류 with the same
-- name). DEFERRABLE: save_partner_categories checks it once at its end, so
-- two categories can swap names in one save. Everywhere else it is checked
-- right away (INITIALLY IMMEDIATE).
alter table public.partner_categories
  drop constraint partner_categories_name_key;
alter table public.partner_categories
  add constraint partner_categories_parent_id_name_key
    unique nulls not distinct (parent_id, name)
    deferrable initially immediate,
  add constraint partner_categories_parent_not_self_check
    check (parent_id is null or parent_id <> id);

comment on table public.partner_categories is '거래처분류. 대분류(상위 분류 없음) → 중분류 → 소분류, 최대 3단계입니다. 거래처마다 하나(어느 단계든)를 고르거나 비워 둡니다(미분류). 쓰는 거래처나 하위 분류가 있으면 삭제할 수 없습니다.';
comment on column public.partner_categories.name is '분류 이름 (같은 상위 분류 안에서 중복 불가, 1~30자)';
comment on column public.partner_categories.parent_id is '상위 분류 ID. 비어 있으면 대분류, 대분류를 가리키면 중분류, 중분류를 가리키면 소분류';
comment on column public.partner_categories.sort_order is '같은 상위 분류 안에서 화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.partner_categories.is_active is '사용 여부. 중지하면 이 분류와 그 아래 분류에 거래처를 새로 넣을 수 없습니다 (이미 넣은 거래처는 그대로)';

-- Keeps the tree at most three levels deep and without loops (the same
-- rules as check_product_category_parent for 상품 분류). Runs when a
-- category is added and when its parent changes:
-- 1. Walk up from the new parent to its 대분류. The number of steps is the
--    parent's level (1 = 대분류, 2 = 중분류, 3 = 소분류). Meeting the
--    category itself on the way means it would go under itself or under
--    one of its own sub-categories. A parent that does not exist (yet) is
--    refused right away.
-- 2. Count the levels below the category (they move along with it).
-- 3. parent's level + 1 + levels below must be 3 or less.
-- Every category on the way up is read with a lock (FOR SHARE), so two
-- saves at the same moment cannot create a fourth level (READ COMMITTED).
create function public.check_partner_category_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_depth constant integer := 3;
  ancestor_id uuid := new.parent_id;
  next_ancestor_id uuid;
  parent_depth integer := 0;
  levels_below integer := 0;
begin
  -- A 대분류, or an update that keeps the same parent: nothing gets deeper.
  if new.parent_id is null
    or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;

  -- 1. Walk up from the new parent to the top, locking each row.
  while ancestor_id is not null loop
    if ancestor_id = new.id then
      raise exception '분류를 자기 자신이나 자기 아래에 있는 분류 밑으로 옮길 수 없습니다.'
        using errcode = 'check_violation', hint = 'partner_category_cycle';
    end if;

    select category.parent_id into next_ancestor_id
    from public.partner_categories as category
    where category.id = ancestor_id
    for share;

    if not found then
      raise exception '상위 분류를 찾을 수 없습니다. 다른 직원이 삭제했을 수 있으니 창을 닫고 다시 열어 주세요.'
        using errcode = 'foreign_key_violation', hint = 'partner_category_parent_not_found';
    end if;

    parent_depth := parent_depth + 1;
    -- The tree is never deeper than 3; this only guards against a broken loop.
    exit when parent_depth > max_depth;
    ancestor_id := next_ancestor_id;
  end loop;

  -- 2. Count the levels below this category.
  with recursive descendants (id, level) as (
    select child.id, 1
    from public.partner_categories as child
    where child.parent_id = new.id
    union all
    select child.id, descendants.level + 1
    from public.partner_categories as child
    join descendants on child.parent_id = descendants.id
    where descendants.level < max_depth
  )
  select coalesce(max(descendants.level), 0) into levels_below
  from descendants;

  -- 3. After the save, no category may be deeper than level 3.
  if parent_depth + 1 + levels_below > max_depth then
    if tg_op = 'INSERT' then
      raise exception '소분류 아래에는 분류를 만들 수 없습니다. 거래처분류는 대분류 → 중분류 → 소분류 3단계까지입니다.'
        using errcode = 'check_violation', hint = 'partner_category_too_deep';
    end if;
    raise exception '이 분류를 그곳으로 옮기면 아래에 있는 분류까지 합쳐 4단계 이상이 됩니다. 거래처분류는 대분류 → 중분류 → 소분류 3단계까지입니다.'
      using errcode = 'check_violation', hint = 'partner_category_too_deep';
  end if;

  return new;
end;
$$;

comment on function public.check_partner_category_parent() is '거래처분류가 대분류 → 중분류 → 소분류 3단계를 넘지 않고, 자기 자신이나 자기 아래 분류 밑으로 옮겨지지 않도록 확인합니다.';

create trigger partner_categories_check_parent
  before insert or update of parent_id on public.partner_categories
  for each row execute function public.check_partner_category_parent();

-- (Privileges: signed-in employees may already SELECT, INSERT and DELETE,
-- and UPDATE only name, sort_order and is_active. parent_id is NOT added:
-- a category is never moved to another parent by the app.)

-- -----------------------------------------------------------------------------
-- 4. check_partner_references: the rules for a partner's newly chosen
--    거래처분류, 영업담당 and 배송담당 (replaces the version of
--    20261022062448_partners.sql; the trigger stays the same).
--
-- Only a change is checked: a partner keeps a category, 영업담당 or
-- 배송담당 that was switched off (or lost its 담당업무) later.
-- - 거래처분류: must exist, and it and every category above it must be 사용.
-- - 영업담당: must exist, be 재직 and have 담당업무 영업담당.
-- - 배송담당: must exist, be 재직 and have 담당업무 배송담당.
-- Every row read is locked (FOR SHARE): switching it off at the same moment
-- waits until this save is finished, or this save waits and then sees the
-- new values (READ COMMITTED).
-- -----------------------------------------------------------------------------

create or replace function public.check_partner_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  chosen_is_active boolean;
  chosen_has_duty boolean;
  ancestor_id uuid;
  ancestor_name text;
  ancestor_parent_id uuid;
  level_count integer := 0;
begin
  -- 거래처분류: the chosen category, then every category above it.
  if new.category_id is not null
    and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    ancestor_id := new.category_id;
    while ancestor_id is not null loop
      select category.name, category.parent_id, category.is_active
      into ancestor_name, ancestor_parent_id, chosen_is_active
      from public.partner_categories as category
      where category.id = ancestor_id
      for share;

      if not found then
        raise exception '선택한 거래처분류를 찾을 수 없습니다. 삭제되었을 수 있으니 분류를 다시 선택해 주세요.'
          using errcode = 'foreign_key_violation', hint = 'partner_category_not_found';
      end if;
      if not chosen_is_active then
        if level_count = 0 then
          raise exception '사용 중지된 거래처분류에는 거래처를 새로 넣을 수 없습니다. 다른 분류를 선택해 주세요.'
            using errcode = 'check_violation', hint = 'partner_category_inactive';
        end if;
        raise exception '상위 분류 ‘%’이(가) 사용 중지되어 이 거래처분류에는 거래처를 새로 넣을 수 없습니다. 다른 분류를 선택해 주세요.', ancestor_name
          using errcode = 'check_violation', hint = 'partner_category_inactive';
      end if;

      level_count := level_count + 1;
      -- The tree is never deeper than 3; this only guards against a loop.
      exit when level_count >= 3;
      ancestor_id := ancestor_parent_id;
    end loop;
  end if;

  -- 영업담당
  if new.sales_rep_id is not null
    and (tg_op = 'INSERT' or new.sales_rep_id is distinct from old.sales_rep_id) then
    select employee.is_active, employee.is_sales_rep
    into chosen_is_active, chosen_has_duty
    from public.employees as employee
    where employee.id = new.sales_rep_id
    for share;

    if not found then
      raise exception '영업담당으로 고른 직원을 찾을 수 없습니다. 영업담당을 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'sales_rep_not_found';
    end if;
    if not chosen_is_active then
      raise exception '퇴사한 직원은 영업담당으로 새로 지정할 수 없습니다. 다른 영업담당을 선택해 주세요.'
        using errcode = 'check_violation', hint = 'sales_rep_inactive';
    end if;
    if not chosen_has_duty then
      raise exception '담당업무에 ‘영업담당’이 체크되지 않은 직원은 영업담당으로 지정할 수 없습니다. 직원관리에서 담당업무를 확인해 주세요.'
        using errcode = 'check_violation', hint = 'sales_rep_duty_missing';
    end if;
  end if;

  -- 배송담당
  if new.delivery_rep_id is not null
    and (tg_op = 'INSERT' or new.delivery_rep_id is distinct from old.delivery_rep_id) then
    select employee.is_active, employee.is_delivery_driver
    into chosen_is_active, chosen_has_duty
    from public.employees as employee
    where employee.id = new.delivery_rep_id
    for share;

    if not found then
      raise exception '배송담당으로 고른 직원을 찾을 수 없습니다. 배송담당을 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'delivery_rep_not_found';
    end if;
    if not chosen_is_active then
      raise exception '퇴사한 직원은 배송담당으로 새로 지정할 수 없습니다. 다른 배송담당을 선택해 주세요.'
        using errcode = 'check_violation', hint = 'delivery_rep_inactive';
    end if;
    if not chosen_has_duty then
      raise exception '담당업무에 ‘배송담당’이 체크되지 않은 직원은 배송담당(기사)으로 지정할 수 없습니다. 직원관리에서 담당업무를 확인해 주세요.'
        using errcode = 'check_violation', hint = 'delivery_rep_duty_missing';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.check_partner_references() is '거래처에 새로 고른 거래처분류(상위 분류까지 사용 중), 영업담당(재직 + 영업담당), 배송담당(재직 + 배송담당)을 확인합니다. 이미 지정된 값은 그대로 둘 수 있습니다.';
comment on trigger partners_check_references on public.partners is '새로 고른 거래처분류·영업담당·배송담당이 지금 고를 수 있는 것인지 확인합니다.';

-- -----------------------------------------------------------------------------
-- 5. Views
-- -----------------------------------------------------------------------------

-- partner_list_items: the 거래처관리 / 거래처분류설정 lists. Created again
-- with the category path and the two categories above the partner's own
-- (for the "this category and everything below it" filter, like
-- product_list_items), and the 담당업무 of the 영업담당 / 배송담당.
-- "partner.*" is turned into a fixed list of columns when the view is
-- created: after adding a column to partners, drop and create this view
-- again (with its comments and privileges).
drop view public.partner_list_items;

create view public.partner_list_items
with (security_invoker = true)
as
select
  partner.*,
  category.name as category_name,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id,
  case
    when category.id is not null then
      concat_ws(' > ', grandparent_category.name, parent_category.name, category.name)
  end as category_path,
  case
    when category.id is not null then
      array_remove(
        array[grandparent_category.sort_order, parent_category.sort_order, category.sort_order],
        null
      )
  end as category_sort_key,
  category.is_active
    and coalesce(parent_category.is_active, true)
    and coalesce(grandparent_category.is_active, true) as category_is_active,
  sales_rep.code as sales_rep_code,
  sales_rep.name as sales_rep_name,
  sales_rep.is_active as sales_rep_is_active,
  sales_rep.is_sales_rep as sales_rep_has_duty,
  delivery_rep.code as delivery_rep_code,
  delivery_rep.name as delivery_rep_name,
  delivery_rep.is_active as delivery_rep_is_active,
  delivery_rep.is_delivery_driver as delivery_rep_has_duty,
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
left join public.partner_categories as parent_category
  on parent_category.id = category.parent_id
left join public.partner_categories as grandparent_category
  on grandparent_category.id = parent_category.parent_id
left join public.employees as sales_rep
  on sales_rep.id = partner.sales_rep_id
left join public.employees as delivery_rep
  on delivery_rep.id = partner.delivery_rep_id
-- At most one row: one 기본 배송지 per partner (unique index).
left join public.partner_addresses as default_address
  on default_address.partner_id = partner.id
  and default_address.is_default;

comment on view public.partner_list_items is '거래처 목록용: 거래처와 거래처분류(경로·상위 분류 ID), 영업담당·배송담당, 기본 배송지, 담당자·배송지 수. 미분류 거래처도 포함됩니다.';
comment on column public.partner_list_items.category_name is '거래처분류 이름 (미분류면 비어 있음)';
comment on column public.partner_list_items.category_parent_id is '거래처분류의 상위 분류 ID (없으면 비어 있음)';
comment on column public.partner_list_items.category_grandparent_id is '거래처분류의 상위의 상위 분류 ID (없으면 비어 있음)';
comment on column public.partner_list_items.category_path is '거래처분류 경로 (예: 오프라인 거래처 > 외식업 > 주요 거래처, 미분류면 비어 있음)';
comment on column public.partner_list_items.category_sort_key is '거래처분류 정렬용: 대분류부터 각 단계의 순서 번호 (미분류면 비어 있음)';
comment on column public.partner_list_items.category_is_active is '거래처분류와 그 위 분류가 모두 사용 중이면 true (미분류면 비어 있음)';
comment on column public.partner_list_items.sales_rep_code is '영업담당 직원코드 (없으면 비어 있음)';
comment on column public.partner_list_items.sales_rep_name is '영업담당 직원명 (없으면 비어 있음)';
comment on column public.partner_list_items.sales_rep_is_active is '영업담당 재직여부 (없으면 비어 있음)';
comment on column public.partner_list_items.sales_rep_has_duty is '영업담당 직원의 담당업무에 영업담당이 있는지 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_code is '배송담당 직원코드 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_name is '배송담당 직원명 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_is_active is '배송담당 재직여부 (없으면 비어 있음)';
comment on column public.partner_list_items.delivery_rep_has_duty is '배송담당 직원의 담당업무에 배송담당이 있는지 (없으면 비어 있음)';
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

-- employee_list_items: the 직원관리 list. Every employees column, plus the
-- address as one text (for the list and its sort) and how many partners
-- have the employee as 영업담당 / 배송담당 (사용 and 미사용 partners).
create view public.employee_list_items
with (security_invoker = true)
as
select
  employee.*,
  case
    when employee.address is not null then
      concat_ws(' ', employee.address, employee.address_detail)
  end as address_text,
  (
    select count(*)::integer
    from public.partners as partner
    where partner.sales_rep_id = employee.id
  ) as sales_partner_count,
  (
    select count(*)::integer
    from public.partners as partner
    where partner.delivery_rep_id = employee.id
  ) as delivery_partner_count,
  (
    select count(*)::integer
    from public.partners as partner
    where partner.sales_rep_id = employee.id
      or partner.delivery_rep_id = employee.id
  ) as partner_count
from public.employees as employee;

comment on view public.employee_list_items is '직원 목록용: 직원과 주소(주소 + 상세주소), 영업담당·배송담당으로 맡은 거래처 수.';
comment on column public.employee_list_items.address_text is '주소 + 상세주소 (목록 표시·정렬용, 주소가 없으면 비어 있음)';
comment on column public.employee_list_items.sales_partner_count is '이 직원이 영업담당인 거래처 수 (사용·미사용 거래처)';
comment on column public.employee_list_items.delivery_partner_count is '이 직원이 배송담당인 거래처 수 (사용·미사용 거래처)';
comment on column public.employee_list_items.partner_count is '이 직원이 영업담당이나 배송담당인 거래처 수 (한 거래처는 한 번만 셈)';

revoke all on table public.employee_list_items from anon, authenticated;
grant select on table public.employee_list_items to authenticated;
grant select on table public.employee_list_items to service_role;

-- -----------------------------------------------------------------------------
-- 6. Functions
--
-- All run with the permissions of the employee calling them (security
-- invoker: the same RLS and privileges as direct table access), use full
-- names (search_path = ''), and may be called only by signed-in employees
-- (grants at the end of this section).
-- -----------------------------------------------------------------------------

-- A short text that changes whenever any 거래처분류 is added, changed or
-- deleted (the number of categories + a checksum of every id and its
-- updated_at). The 분류값 설정 window reads it when it opens and hands it to
-- save_partner_categories, which refuses to save when the categories
-- changed in the meantime.
create function public.partner_category_tree_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::text || ':' || coalesce(
    md5(
      string_agg(
        category.id::text || '@' || extract(epoch from category.updated_at)::text,
        ',' order by category.id
      )
    ),
    '-'
  )
  from public.partner_categories as category
$$;

comment on function public.partner_category_tree_version() is '거래처분류 전체의 버전 (분류가 추가·수정·삭제되면 바뀜). 분류값 설정 창이 열 때 읽고 저장할 때 비교합니다.';

-- 분류값 설정: saves every change of the window in one go (everything is
-- saved, or nothing).
--
-- loaded_version: partner_category_tree_version() when the window opened.
-- If anyone changed the categories since, nothing is saved (the window
-- would otherwise undo or clash with their changes).
--
-- changes (JSON, written by src/lib/partner-categories/actions.ts):
--   {
--     "deleted": ["<id>", …],        saved categories to delete
--     "categories": [                 added categories and changed ones
--       {"id": "<id>" | null,         null = added in the window
--        "temp_id": "new-1" | null,   the window's key of an added one
--        "parent_id": "<id>" | null,  added one: its saved parent
--        "parent_temp_id": "new-0" | null,  … or its parent added in the
--                                     same save (both null = 대분류)
--        "name": "…", "is_active": true, "sort_order": 1}, …
--     ]
--   }
-- A saved category keeps its parent (the window cannot move one to
-- another parent); only its name, 사용 여부 and order change.
--
-- Rules (Korean message + HINT key, see PARTNER_DB_RULES):
-- - names trimmed, 1–30 characters, NFC; unique under the same parent
--   (checked on the result of the whole save, so two names can be swapped);
-- - a deleted category has no partners and no sub-categories that stay;
-- - at most 3 levels (trigger check_partner_category_parent).
-- Returns {"added": n, "updated": n, "deleted": n,
--          "new_ids": {"<temp_id>": "<new id>", …}}.
create function public.save_partner_categories(
  loaded_version text,
  changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_changes constant integer := 1000;
  uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  invalid_message constant text :=
    '분류 변경 내용을 읽을 수 없습니다. 창을 닫고 다시 열어 주세요.';
  changed_message constant text :=
    '이 창을 연 뒤에 다른 직원이 거래처분류를 바꿨습니다. 창을 닫고 다시 열어 수정해 주세요.';
  deleted_list jsonb;
  item_list jsonb;
  deleted_ids uuid[] := '{}';
  entry record;
  item jsonb;
  item_name text;
  parent_uuid uuid;
  new_id uuid;
  new_ids jsonb := '{}'::jsonb;
  new_count integer;
  added_count integer := 0;
  updated_count integer := 0;
  deleted_count integer := 0;
  round_count integer;
  progress boolean;
  problem_name text;
begin
  -- 1. The shape of the request.
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception '%', invalid_message
      using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
  end if;
  deleted_list := coalesce(changes -> 'deleted', '[]'::jsonb);
  item_list := coalesce(changes -> 'categories', '[]'::jsonb);
  if jsonb_typeof(deleted_list) <> 'array' or jsonb_typeof(item_list) <> 'array' then
    raise exception '%', invalid_message
      using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
  end if;
  if jsonb_array_length(deleted_list) + jsonb_array_length(item_list) > max_changes then
    raise exception '한 번에 저장할 수 있는 분류 변경은 %개까지입니다. 나눠서 저장해 주세요.', max_changes
      using errcode = 'check_violation', hint = 'partner_category_changes_invalid';
  end if;

  -- 2. One save at a time (a second one waits here), and only on the
  --    categories the window showed. SHARE ROW EXCLUSIVE lets everyone keep
  --    reading the categories and choosing them for partners meanwhile.
  lock table public.partner_categories in share row exclusive mode;
  if loaded_version is distinct from public.partner_category_tree_version() then
    raise exception '%', changed_message
      using hint = 'partner_category_tree_changed';
  end if;

  -- 3. The categories to delete.
  for entry in select value from jsonb_array_elements(deleted_list) loop
    if jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~ uuid_pattern then
      raise exception '%', invalid_message
        using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
    end if;
    deleted_ids := array_append(deleted_ids, (entry.value #>> '{}')::uuid);
  end loop;
  select coalesce(array_agg(distinct deleted.id), '{}') into deleted_ids
  from unnest(deleted_ids) as deleted (id);

  if (
    select count(*) from public.partner_categories as category
    where category.id = any (deleted_ids)
  ) <> cardinality(deleted_ids) then
    raise exception '%', changed_message using hint = 'partner_category_tree_changed';
  end if;

  for entry in
    select
      category.name,
      (
        select count(*)
        from public.partners as partner
        where partner.category_id = category.id
      ) as partner_count,
      exists (
        select 1
        from public.partner_categories as child
        where child.parent_id = category.id
          and child.id <> all (deleted_ids)
      ) as keeps_children
    from public.partner_categories as category
    where category.id = any (deleted_ids)
    order by category.name
  loop
    if entry.partner_count > 0 then
      raise exception '‘%’ 분류에 거래처 %개가 있어서 삭제할 수 없습니다. 먼저 그 거래처들을 다른 분류로 옮기거나 분류해제해 주세요. (더 쓰지 않는 분류라면 삭제 대신 사용 중지해 주세요.)', entry.name, entry.partner_count
        using errcode = 'foreign_key_violation', hint = 'partner_category_in_use';
    end if;
    if entry.keeps_children then
      raise exception '‘%’ 분류 아래에 하위 분류가 있어서 삭제할 수 없습니다. 하위 분류를 먼저 삭제해 주세요.', entry.name
        using errcode = 'foreign_key_violation', hint = 'partner_category_has_children';
    end if;
  end loop;

  -- 4. Every added or changed category.
  for entry in select value from jsonb_array_elements(item_list) loop
    item := entry.value;
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'is_active') is distinct from 'boolean'
      or coalesce(item ->> 'sort_order', '') !~ '^[0-9]{1,9}$' then
      raise exception '%', invalid_message
        using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
    end if;

    item_name := item ->> 'name';
    if item_name is null or not public.is_trimmed_text(item_name, 30)
      or not (item_name is nfc normalized) then
      raise exception '분류 이름은 앞뒤 공백 없이 1~30자로 입력해 주세요. (‘%’)', coalesce(item_name, '')
        using errcode = 'check_violation', hint = 'partner_category_name_invalid';
    end if;

    if item ->> 'id' is not null then
      -- A saved category: it must still exist and not be deleted as well.
      if (item ->> 'id') !~ uuid_pattern
        or (item ->> 'id')::uuid = any (deleted_ids) then
        raise exception '%', invalid_message
          using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
      end if;
      if not exists (
        select 1 from public.partner_categories as category
        where category.id = (item ->> 'id')::uuid
      ) then
        raise exception '%', changed_message using hint = 'partner_category_tree_changed';
      end if;
    else
      -- An added category: a key, and a parent that is saved (and not
      -- deleted) or added in this same save.
      if coalesce(item ->> 'temp_id', '') = '' then
        raise exception '%', invalid_message
          using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
      end if;
      if item ->> 'parent_id' is not null then
        if (item ->> 'parent_id') !~ uuid_pattern
          or (item ->> 'parent_id')::uuid = any (deleted_ids) then
          raise exception '%', invalid_message
            using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
        end if;
        if not exists (
          select 1 from public.partner_categories as category
          where category.id = (item ->> 'parent_id')::uuid
        ) then
          raise exception '%', changed_message using hint = 'partner_category_tree_changed';
        end if;
      elsif item ->> 'parent_temp_id' is not null then
        if not exists (
          select 1
          from jsonb_array_elements(item_list) as other (value)
          where other.value ->> 'id' is null
            and other.value ->> 'temp_id' = item ->> 'parent_temp_id'
        ) then
          raise exception '%', invalid_message
            using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
        end if;
      end if;
    end if;
  end loop;

  -- Each saved category and each key listed once.
  if exists (
    select 1
    from jsonb_array_elements(item_list) as item_row (value)
    group by coalesce(lower(item_row.value ->> 'id'), 'new:' || (item_row.value ->> 'temp_id'))
    having count(*) > 1
  ) then
    raise exception '%', invalid_message
      using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
  end if;

  -- 5. Names after the save: unique under the same parent.
  select final.name into problem_name
  from (
    select
      coalesce(category.parent_id::text, 'top') as parent_key,
      coalesce(changed.value ->> 'name', category.name) as name
    from public.partner_categories as category
    left join jsonb_array_elements(item_list) as changed (value)
      on lower(changed.value ->> 'id') = category.id::text
    where category.id <> all (deleted_ids)
    union all
    select
      coalesce(
        lower(added.value ->> 'parent_id'),
        'new:' || (added.value ->> 'parent_temp_id'),
        'top'
      ),
      added.value ->> 'name'
    from jsonb_array_elements(item_list) as added (value)
    where added.value ->> 'id' is null
  ) as final
  group by final.parent_key, final.name
  having count(*) > 1
  order by final.name
  limit 1;

  if problem_name is not null then
    raise exception '같은 위치에 ‘%’ 분류가 두 개 있습니다. 하나의 이름을 바꿔 주세요.', problem_name
      using errcode = 'unique_violation', hint = 'partner_category_name_duplicate';
  end if;

  -- The unique name rule is checked again at the end of this function, so
  -- names can be swapped in between.
  set constraints public.partner_categories_parent_id_name_key deferred;

  -- 6. Delete: sub-categories first, then the categories above them.
  begin
    loop
      delete from public.partner_categories as category
      where category.id = any (deleted_ids)
        and not exists (
          select 1
          from public.partner_categories as child
          where child.parent_id = category.id
        );
      get diagnostics round_count = row_count;
      deleted_count := deleted_count + round_count;
      exit when round_count = 0;
    end loop;
  exception when foreign_key_violation then
    -- A partner was put into it a moment ago (after the check above).
    raise exception '방금 다른 직원이 삭제하려는 분류에 거래처를 넣었습니다. 창을 닫고 다시 열어 확인해 주세요.'
      using errcode = 'foreign_key_violation', hint = 'partner_category_in_use';
  end;

  -- 7. Add: parents before their children (a child of a category added in
  --    this save waits for the next round).
  select count(*) into new_count
  from jsonb_array_elements(item_list) as item_row (value)
  where item_row.value ->> 'id' is null;

  loop
    progress := false;
    for entry in
      select item_row.value
      from jsonb_array_elements(item_list) with ordinality as item_row (value, number)
      where item_row.value ->> 'id' is null
      order by item_row.number
    loop
      item := entry.value;
      continue when new_ids ? (item ->> 'temp_id');
      if item ->> 'parent_id' is not null then
        parent_uuid := (item ->> 'parent_id')::uuid;
      elsif item ->> 'parent_temp_id' is not null then
        continue when not (new_ids ? (item ->> 'parent_temp_id'));
        parent_uuid := (new_ids ->> (item ->> 'parent_temp_id'))::uuid;
      else
        parent_uuid := null;
      end if;

      insert into public.partner_categories (name, parent_id, sort_order, is_active)
      values (
        item ->> 'name',
        parent_uuid,
        (item ->> 'sort_order')::integer,
        (item ->> 'is_active')::boolean
      )
      returning id into new_id;

      new_ids := new_ids || jsonb_build_object(item ->> 'temp_id', new_id);
      added_count := added_count + 1;
      progress := true;
    end loop;
    exit when not progress;
  end loop;

  -- Left over: an added category whose parent never got added (a loop).
  if added_count <> new_count then
    raise exception '%', invalid_message
      using errcode = 'invalid_parameter_value', hint = 'partner_category_changes_invalid';
  end if;

  -- 8. Change the saved ones (only when something really changed, so the
  --    others keep their updated_at).
  for entry in
    select item_row.value
    from jsonb_array_elements(item_list) as item_row (value)
    where item_row.value ->> 'id' is not null
  loop
    item := entry.value;
    update public.partner_categories as category
    set
      name = item ->> 'name',
      is_active = (item ->> 'is_active')::boolean,
      sort_order = (item ->> 'sort_order')::integer
    where category.id = (item ->> 'id')::uuid
      and (category.name, category.is_active, category.sort_order)
        is distinct from (
          item ->> 'name',
          (item ->> 'is_active')::boolean,
          (item ->> 'sort_order')::integer
        );
    if found then
      updated_count := updated_count + 1;
    end if;
  end loop;

  -- 9. The unique name rule, now.
  begin
    set constraints public.partner_categories_parent_id_name_key immediate;
  exception when unique_violation then
    raise exception '같은 위치에 이름이 같은 분류가 있습니다. 이름을 바꿔 주세요.'
      using errcode = 'unique_violation', hint = 'partner_category_name_duplicate';
  end;

  return jsonb_build_object(
    'added', added_count,
    'updated', updated_count,
    'deleted', deleted_count,
    'new_ids', new_ids
  );
end;
$$;

comment on function public.save_partner_categories(text, jsonb) is '분류값 설정 창의 변경(추가·이름 변경·순서·사용 여부·삭제)을 한 번에 저장합니다. 창을 연 뒤 다른 사람이 분류를 바꿨으면(버전이 다르면) 저장하지 않습니다.';

-- 분류적용 / 분류해제 for the checked partners, in one request:
-- target_category_id = the chosen category (any level), or null / left out
-- = 미분류.
-- The rules of check_partner_references apply (the category and every one
-- above it must be 사용). Partners already in that category are left as
-- they are. Returns the number of partners that changed.
create function public.set_partner_category(
  partner_ids uuid[],
  target_category_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if partner_ids is null or cardinality(partner_ids) = 0 then
    raise exception '먼저 거래처를 체크해 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'partner_ids_invalid';
  end if;
  if cardinality(partner_ids) > 1000 then
    raise exception '한 번에 거래처 1000개까지 바꿀 수 있습니다.'
      using errcode = 'invalid_parameter_value', hint = 'partner_ids_invalid';
  end if;

  update public.partners as partner
  set category_id = target_category_id
  where partner.id = any (partner_ids)
    and partner.category_id is distinct from target_category_id;
  get diagnostics changed_count = row_count;

  return changed_count;
end;
$$;

comment on function public.set_partner_category(uuid[], uuid) is '체크한 거래처들의 거래처분류를 한 번에 바꿉니다 (분류적용). target_category_id가 비어 있으면 미분류로 (분류해제). 바뀐 거래처 수를 돌려줍니다.';

-- The 직원코드 the 직원 등록 form suggests: the highest code made only of
-- digits + 1, with at least 4 digits (0001, 0002, …, 0010, …, 10000).
-- Codes with letters (e.g. "D-01") are skipped. The user may change it;
-- the unique rule still applies when saving.
create function public.suggest_employee_code()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when length(next_number) >= 4 then next_number
    else lpad(next_number, 4, '0')
  end
  from (
    select (coalesce(max(employee.code::numeric), 0) + 1)::text as next_number
    from public.employees as employee
    where employee.code ~ '^[0-9]{1,30}$'
  ) as highest
$$;

comment on function public.suggest_employee_code() is '새 직원에게 제안할 직원코드: 숫자로만 된 코드 중 가장 큰 번호 + 1 (4자리, 예: 0001, 0012).';

-- Only signed-in employees may call them; not-signed-in visitors (anon)
-- and everyone else (public) may not. Revoke first: Supabase gives new
-- functions default privileges.
revoke all on function public.partner_category_tree_version()
  from public, anon, authenticated;
grant execute on function public.partner_category_tree_version()
  to authenticated, service_role;

revoke all on function public.save_partner_categories(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_partner_categories(text, jsonb)
  to authenticated, service_role;

revoke all on function public.set_partner_category(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.set_partner_category(uuid[], uuid)
  to authenticated, service_role;

revoke all on function public.suggest_employee_code()
  from public, anon, authenticated;
grant execute on function public.suggest_employee_code()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Tell the API (PostgREST) to reload its picture of the database, so the
--    new columns, views and functions are usable right away.
-- -----------------------------------------------------------------------------

notify pgrst, 'reload schema';
