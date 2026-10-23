-- =============================================================================
-- 자료일괄등록: register 상품분류, 상품, 거래처 and 직원 from an Excel file
--
-- Runs after 20261022083130_partner_categories_tree_employees_v2.sql. It
-- only ADDS functions: no table, view, column, rule or row changes, so the
-- data already in the database stays exactly as it is.
--
-- The owner's rules (decided 2026-10-22):
-- - Each 자료일괄등록 screen reads an Excel (.xlsx) or CSV file in the
--   browser, shows a 미리보기 with every row checked (정상 / 오류 /
--   건너뜀), and registers only the 정상 rows when [정상 N건 등록] is
--   pressed.
-- - A file has at most 3,000 rows. Registering is all or nothing: one
--   function call, one transaction. When any row fails, nothing is saved
--   and the message names the Excel row (and, for 상품, the sheet).
-- - Import only ADDS: a code that is already used is an error (상품, 거래처,
--   직원). Only 상품분류 rows reuse the categories that already exist.
-- - 상품 and 거래처 rows give their 분류 as names (대분류 / 중분류 /
--   소분류). With "없는 분류는 자동으로 만들기" (create_missing_categories)
--   missing categories are created (사용, at the end of their list);
--   without it a missing category is an error. A switched-off category (or
--   one below a switched-off category) cannot get new 상품/거래처.
-- - 묶음상품 rows list their 구성상품 by 기준상품코드: 기준상품 already in
--   the database or in the same file's 기준상품 sheet (registered first).
-- - 직원 rows without 직원코드 get the next numbers after the highest code
--   made only of digits (0015, 0016, … in file order), assigned here while
--   the employees table is locked, so two imports at the same moment can
--   never hand out the same code.
--
-- The app checks every rule first (src/lib/imports/), so users normally see
-- a friendly message per cell in the 미리보기. The functions below check
-- again through the tables' own rules (checks, unique indexes, triggers)
-- and the existing save functions (create_bundle_product, create_partner).
--
-- Errors: every failure inside a row is raised again with
--   message = '<sheet/엑셀> <N>행: <Korean reason>'
--   hint    = 'import_row_invalid'
--   detail  = JSON {"sheet", "excel_row", "field", "rule", "reason",
--             "state" (the original error code)}
-- (field = the column key of src/lib/imports/, e.g. "code", "category").
-- Problems with the request as a whole use the hints import_rows_invalid,
-- import_rows_empty and import_too_many_rows. The keys are listed in
-- IMPORT_DB_RULES in src/lib/imports/types.ts: change both places together.
-- Every error with a Korean message uses an error code the API answers
-- with HTTP 4xx (22xxx, 23xxx, P0001): a 5xx answer with a Korean message
-- reaches the app only as "Something went wrong" (PostgREST 14.18).
--
-- What this file does:
--  1. Shared helpers: import_check_rows, import_error_field,
--     import_raise_row_error.
--  2. Look-ups for the 미리보기: import_find_products,
--     import_find_partners, import_find_employees.
--  3. 분류 by names: import_product_category_id, import_partner_category_id.
--  4. The four import functions: import_product_categories,
--     import_products, import_partners, import_employees.
--  5. Privileges, then the API (PostgREST) is told to reload.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Shared helpers
-- -----------------------------------------------------------------------------

-- Checks the shape of one list of rows: a JSON array of at most max_rows
-- objects, each with its Excel row number ("excel_row", a whole number).
-- An empty list is fine here; each import function checks that something
-- is left to register.
create function public.import_check_rows(rows jsonb, max_rows integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception '등록할 내용을 읽을 수 없습니다. 파일을 다시 올려 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_invalid';
  end if;
  if jsonb_array_length(rows) > max_rows then
    raise exception '한 번에 %행까지 등록할 수 있습니다. 파일을 나눠서 올려 주세요.', max_rows
      using errcode = 'invalid_parameter_value', hint = 'import_too_many_rows';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(rows) as item (value)
    where jsonb_typeof(item.value) <> 'object'
      or coalesce(item.value ->> 'excel_row', '') !~ '^[0-9]{1,7}$'
  ) then
    raise exception '등록할 내용을 읽을 수 없습니다. 파일을 다시 올려 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_invalid';
  end if;
end;
$$;

comment on function public.import_check_rows(jsonb, integer) is '자료일괄등록: 행 목록이 JSON 배열(최대 max_rows행, 행마다 엑셀 행번호 excel_row)인지 확인합니다.';

-- The column key (as src/lib/imports/ names it) that a database error
-- belongs to: from the name of the broken rule (check, unique index,
-- foreign key) or the HINT key of our own functions and triggers. null when
-- the error is about the row as a whole.
create function public.import_error_field(error_constraint text, error_hint text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Codes and names (상품, 거래처, 직원)
    when error_constraint in (
      'products_code_lower_key', 'products_code_check',
      'partners_code_lower_key', 'partners_code_check',
      'employees_code_lower_key', 'employees_code_check'
    ) then 'code'
    when error_constraint in (
      'products_name_check', 'partners_name_check', 'employees_name_check'
    ) then 'name'
    when error_constraint in (
      'products_note_check', 'partners_note_check', 'employees_note_check'
    ) then 'note'
    -- 상품
    when error_constraint = 'products_unit_check' then 'unit'
    when error_constraint = 'products_spec_check' then 'spec'
    when error_constraint = 'products_origin_check' then 'origin'
    when error_constraint = 'products_manufacturer_check' then 'manufacturer'
    when error_constraint = 'products_purchase_price_incl_vat_check' then 'purchasePrice'
    when error_constraint = 'products_sale_price_incl_vat_check' then 'salePrice'
    when error_constraint = 'products_shelf_life_days_check' then 'shelfLifeDays'
    when error_constraint in ('products_barcode_check', 'products_barcode_key') then 'barcode'
    when error_constraint = 'products_allergens_check' then 'allergens'
    when error_constraint = 'products_product_type_fields_check' then 'storageType'
    when error_constraint in (
      'product_bundle_items_pkey', 'product_bundle_items_quantity_check',
      'product_bundle_items_not_self_check'
    ) then 'components'
    when error_hint in (
      'bundle_component_not_found', 'bundle_component_not_base',
      'bundle_component_inactive', 'bundle_items_empty',
      'bundle_items_too_many', 'bundle_items_duplicate'
    ) then 'components'
    when error_hint = 'bundle_activation_blocked' then 'isActive'
    -- 분류 (상품, 거래처)
    when error_constraint in ('products_category_id_fkey', 'partners_category_id_fkey')
      then 'category'
    when error_hint in (
      'import_category_not_found', 'import_category_inactive',
      'import_category_invalid', 'partner_category_not_found',
      'partner_category_inactive', 'partner_category_too_deep'
    ) then 'category'
    -- 거래처
    when error_constraint = 'partners_phone_check' then 'phone'
    when error_constraint = 'partners_payment_day_check' then 'paymentTerm'
    when error_constraint = 'partners_credit_limit_check' then 'creditLimit'
    when error_constraint = 'partners_business_number_check' then 'businessNumber'
    when error_constraint = 'partners_company_name_check' then 'companyName'
    when error_constraint = 'partners_representative_check' then 'representative'
    when error_constraint = 'partners_business_category_check' then 'businessCategory'
    when error_constraint = 'partners_business_item_check' then 'businessItem'
    when error_constraint = 'partners_postal_code_check' then 'postalCode'
    when error_constraint in ('partners_address_check', 'partners_address_parts_check')
      then 'address'
    when error_constraint = 'partners_address_detail_check' then 'addressDetail'
    when error_constraint = 'partners_tax_email_check' then 'taxEmail'
    when error_constraint = 'partners_sales_rep_id_fkey'
      or error_hint in ('sales_rep_not_found', 'sales_rep_inactive', 'sales_rep_duty_missing')
      then 'salesRep'
    when error_constraint = 'partners_delivery_rep_id_fkey'
      or error_hint in (
        'delivery_rep_not_found', 'delivery_rep_inactive', 'delivery_rep_duty_missing'
      )
      then 'deliveryRep'
    when error_constraint = 'partner_contacts_name_check'
      or error_hint = 'partner_primary_contact_duplicate' then 'contactName'
    when error_constraint = 'partner_contacts_job_title_check' then 'contactJobTitle'
    when error_constraint = 'partner_contacts_mobile_check' then 'contactMobile'
    when error_constraint = 'partner_contacts_email_check' then 'contactEmail'
    when error_constraint = 'partner_addresses_label_check' then 'deliveryLabel'
    when error_constraint = 'partner_addresses_postal_code_check' then 'deliveryPostalCode'
    when error_constraint = 'partner_addresses_address_check'
      or error_hint in (
        'partner_default_address_required', 'partner_default_address_duplicate'
      )
      then 'deliveryAddress'
    when error_constraint = 'partner_addresses_address_detail_check' then 'deliveryAddressDetail'
    when error_constraint = 'partner_addresses_recipient_check' then 'recipient'
    when error_constraint = 'partner_addresses_phone_check' then 'deliveryPhone'
    when error_constraint = 'partner_addresses_memo_check' then 'deliveryMemo'
    -- 직원
    when error_constraint = 'employees_job_title_check' then 'jobTitle'
    when error_constraint = 'employees_mobile_check'
      or error_hint = 'employee_mobile_required' then 'mobile'
    when error_constraint = 'employees_mobile2_check' then 'mobile2'
    when error_constraint = 'employees_email_check' then 'email'
    when error_constraint = 'employees_phone_check' then 'phone'
    when error_constraint = 'employees_postal_code_check' then 'postalCode'
    when error_constraint in ('employees_address_check', 'employees_address_parts_check')
      then 'address'
    when error_constraint = 'employees_address_detail_check' then 'addressDetail'
    when error_constraint = 'employees_department_check' then 'department'
    when error_constraint = 'employees_resignation_date_check' then 'resignationDate'
    when error_constraint = 'employees_vehicle_number_check' then 'vehicleNumber'
    when error_constraint = 'employees_driver_fields_check' then 'driverOperationType'
  end
$$;

comment on function public.import_error_field(text, text) is '자료일괄등록: 데이터베이스 오류(규칙 이름 또는 HINT 키)가 어느 열의 문제인지 돌려줍니다 (src/lib/imports/의 열 키).';

-- Raises the error of one row again so that it names the Excel row: called
-- from the EXCEPTION part of the import functions with what GET STACKED
-- DIAGNOSTICS returned. Never returns.
-- sheet: 'base' (기준상품 시트), 'bundle' (묶음상품 시트) or 'main' (the
-- only sheet). field: the column key when the import function knows it
-- (e.g. 'category' while it looks up the 분류), otherwise null (then it is
-- worked out from the broken rule, see import_error_field).
create function public.import_raise_row_error(
  sheet text,
  excel_row integer,
  field text,
  error_state text,
  error_message text,
  error_hint text,
  error_constraint text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  row_label text;
  reason text;
begin
  row_label := case sheet
    when 'base' then '기준상품 시트 '
    when 'bundle' then '묶음상품 시트 '
    else '엑셀 '
  end || coalesce(excel_row::text, '?') || '행';

  reason := case
    when error_constraint = 'products_code_lower_key'
      then '이미 사용 중인 상품코드입니다.'
    when error_constraint = 'products_barcode_key'
      then '이미 등록된 바코드입니다.'
    when error_constraint = 'partners_code_lower_key'
      then '이미 사용 중인 거래처코드입니다.'
    when error_constraint = 'employees_code_lower_key'
      then '이미 사용 중인 직원코드입니다.'
    when error_constraint in (
      'product_categories_parent_id_name_key', 'partner_categories_parent_id_name_key'
    ) then '같은 위치에 이름이 같은 분류가 이미 있습니다.'
    -- Our own functions and triggers send a Korean message with a HINT key.
    when coalesce(error_hint, '') <> '' then error_message
    when error_state = '23514'
      then '입력한 값이 규칙에 맞지 않습니다. (규칙: ' || coalesce(error_constraint, '-') || ')'
    when error_state = '23503'
      then '연결된 자료를 찾을 수 없습니다. (규칙: ' || coalesce(error_constraint, '-') || ')'
    when error_state = '23502'
      then '꼭 입력해야 하는 값이 비어 있습니다.'
    when error_state = '42501'
      then '등록할 권한이 없습니다. 다시 로그인해 주세요.'
    else error_message
  end;

  -- The error code: the original one for data and rule errors (classes
  -- 22 and 23, and 42501 = no permission), 'P0001' for everything else.
  -- The API (PostgREST) answers the other codes with HTTP 5xx, and a 5xx
  -- answer with a Korean message comes back as the plain text "Something
  -- went wrong", without the message, hint and detail (tested with
  -- PostgREST 14.18). The original code is kept in the detail ("state").
  raise exception '%: %', row_label, reason
    using
      errcode = case
        when error_state like '22%' or error_state like '23%'
          or error_state = '42501'
          then error_state
        else 'P0001'
      end,
      hint = 'import_row_invalid',
      detail = jsonb_build_object(
        'sheet', sheet,
        'excel_row', excel_row,
        'field', coalesce(field, public.import_error_field(error_constraint, error_hint)),
        'rule', coalesce(nullif(error_hint, ''), error_constraint),
        'reason', reason,
        'state', error_state
      )::text;
end;
$$;

comment on function public.import_raise_row_error(text, integer, text, text, text, text, text) is '자료일괄등록: 한 행의 오류를 엑셀 행번호와 열 키(detail JSON)를 붙여 다시 알립니다 (hint import_row_invalid).';

-- -----------------------------------------------------------------------------
-- 2. Look-ups for the 미리보기 (read only)
--
-- The 미리보기 checks a whole file with one request per kind: which codes
-- are already used (ignoring upper/lower case, like the unique rules),
-- which 바코드 / 사업자등록번호 exist, and the 직원 named as 영업담당 /
-- 배송담당. The lists go in the request body, so 3,000 codes fit easily.
-- Each function returns ONE JSON array (not a set of rows): the API
-- (PostgREST) cuts a set of rows off at 1,000, and a file may name 3,000
-- codes that all exist (e.g. the same file uploaded twice).
-- -----------------------------------------------------------------------------

-- Products whose 상품코드 (ignoring case) is in `codes`, or whose 바코드 is
-- in `barcodes`: [{"id", "code", "name", "product_type", "is_active",
-- "unit", "barcode"}, …] in 상품코드 order.
create function public.import_find_products(codes text[], barcodes text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', product.id,
        'code', product.code,
        'name', product.name,
        'product_type', product.product_type,
        'is_active', product.is_active,
        'unit', product.unit,
        'barcode', product.barcode
      )
      order by product.code
    ),
    '[]'::jsonb
  )
  from public.products as product
  where lower(product.code) = any (
      array(
        select lower(wanted.value)
        from unnest(coalesce(codes, '{}'::text[])) as wanted (value)
      )
    )
    or product.barcode = any (coalesce(barcodes, '{}'::text[]))
$$;

comment on function public.import_find_products(text[], text[]) is '자료일괄등록 미리보기: 상품코드(대소문자 구분 없이)나 바코드가 목록에 있는 상품 (JSON 배열).';

-- Partners whose 거래처코드 (ignoring case) is in `codes`, or whose
-- 사업자등록번호 is in `business_numbers` (for the "같은 사업자번호"
-- warning): [{"id", "code", "name", "business_number"}, …].
create function public.import_find_partners(codes text[], business_numbers text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', partner.id,
        'code', partner.code,
        'name', partner.name,
        'business_number', partner.business_number
      )
      order by partner.code
    ),
    '[]'::jsonb
  )
  from public.partners as partner
  where lower(partner.code) = any (
      array(
        select lower(wanted.value)
        from unnest(coalesce(codes, '{}'::text[])) as wanted (value)
      )
    )
    or partner.business_number = any (coalesce(business_numbers, '{}'::text[]))
$$;

comment on function public.import_find_partners(text[], text[]) is '자료일괄등록 미리보기: 거래처코드(대소문자 구분 없이)나 사업자등록번호가 목록에 있는 거래처 (JSON 배열).';

-- Employees whose 직원코드 (ignoring case) is in `codes`, or whose 직원명
-- is (so the 미리보기 can say "영업담당은 직원코드로 적어 주세요: 쿠팡 =
-- 0005" when a name was written instead of the code, and the 직원
-- 일괄등록 can warn about a person registered already: same 직원명 and
-- 휴대폰번호1, e.g. the same file uploaded twice):
-- [{"id", "code", "name", "is_active", "is_sales_rep",
--   "is_delivery_driver", "mobile"}, …].
create function public.import_find_employees(codes text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', employee.id,
        'code', employee.code,
        'name', employee.name,
        'is_active', employee.is_active,
        'is_sales_rep', employee.is_sales_rep,
        'is_delivery_driver', employee.is_delivery_driver,
        'mobile', employee.mobile
      )
      order by employee.code
    ),
    '[]'::jsonb
  )
  from public.employees as employee
  where lower(employee.code) = any (
      array(
        select lower(wanted.value)
        from unnest(coalesce(codes, '{}'::text[])) as wanted (value)
      )
    )
    or employee.name = any (coalesce(codes, '{}'::text[]))
$$;

comment on function public.import_find_employees(text[]) is '자료일괄등록 미리보기: 직원코드(대소문자 구분 없이)나 직원명이 목록에 있는 직원 (JSON 배열).';

-- -----------------------------------------------------------------------------
-- 3. 분류 by names (상품분류 / 거래처분류)
--
-- path: a JSON array of 1–3 names, from the 대분류 down, e.g.
-- ["가공식품", "통조림"]; null = 미분류 (returns null).
-- Each level is looked up by its exact name under the level above it (the
-- same rule as the unique names among siblings). A missing level is created
-- when create_missing is true (사용, at the end of its list), otherwise it
-- is an error. A level that exists but is 사용 중지 is an error: nothing
-- new may be put into it or below it.
-- The import functions lock the category table first, so nobody adds,
-- renames or switches off a category in the meantime.
-- -----------------------------------------------------------------------------

create function public.import_product_category_id(path jsonb, create_missing boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  level_name text;
  level_number integer := 0;
  level_count integer;
  path_text text := '';
  parent_uuid uuid := null;
  found_id uuid;
  found_is_active boolean;
  next_sort_order integer;
begin
  if path is null or jsonb_typeof(path) = 'null' then
    return null;
  end if;
  -- (jsonb_array_length fails on anything that is not an array.)
  level_count := case
    when jsonb_typeof(path) = 'array' then jsonb_array_length(path)
    else 0
  end;
  if level_count not between 1 and 3 then
    raise exception '분류는 대분류 → 중분류 → 소분류 3단계까지 입력할 수 있습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_category_invalid';
  end if;

  for level_name in select value from jsonb_array_elements_text(path) loop
    level_number := level_number + 1;
    if level_name is null then
      raise exception '분류 이름이 비어 있습니다.'
        using errcode = 'invalid_parameter_value', hint = 'import_category_invalid';
    end if;
    path_text := case
      when level_number = 1 then level_name
      else path_text || ' > ' || level_name
    end;

    select category.id, category.is_active
    into found_id, found_is_active
    from public.product_categories as category
    where category.name = level_name
      and (
        category.parent_id = parent_uuid
        or (parent_uuid is null and category.parent_id is null)
      );

    if found then
      if not found_is_active then
        raise exception '분류 ‘%’이(가) 사용 중지되어 있어 상품을 넣을 수 없습니다. 상품분류설정에서 사용으로 바꾸거나 다른 분류를 적어 주세요.', path_text
          using errcode = 'check_violation', hint = 'import_category_inactive';
      end if;
    elsif create_missing then
      select coalesce(max(category.sort_order), 0) + 1 into next_sort_order
      from public.product_categories as category
      where category.parent_id = parent_uuid
        or (parent_uuid is null and category.parent_id is null);

      insert into public.product_categories (name, parent_id, sort_order)
      values (level_name, parent_uuid, next_sort_order)
      returning id into found_id;
    else
      raise exception '분류 ‘%’이(가) 없습니다. 상품분류설정에서 먼저 만들거나 ‘없는 분류는 자동으로 만들기’를 켜 주세요.', path_text
        using errcode = 'foreign_key_violation', hint = 'import_category_not_found';
    end if;

    parent_uuid := found_id;
  end loop;

  return parent_uuid;
end;
$$;

comment on function public.import_product_category_id(jsonb, boolean) is '자료일괄등록: 이름으로 적은 상품분류(대 > 중 > 소)의 ID. 없는 분류는 create_missing이면 만들고, 사용 중지된 분류는 거절합니다.';

create function public.import_partner_category_id(path jsonb, create_missing boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  level_name text;
  level_number integer := 0;
  level_count integer;
  path_text text := '';
  parent_uuid uuid := null;
  found_id uuid;
  found_is_active boolean;
  next_sort_order integer;
begin
  if path is null or jsonb_typeof(path) = 'null' then
    return null;
  end if;
  -- (jsonb_array_length fails on anything that is not an array.)
  level_count := case
    when jsonb_typeof(path) = 'array' then jsonb_array_length(path)
    else 0
  end;
  if level_count not between 1 and 3 then
    raise exception '거래처분류는 대분류 → 중분류 → 소분류 3단계까지 입력할 수 있습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_category_invalid';
  end if;

  for level_name in select value from jsonb_array_elements_text(path) loop
    level_number := level_number + 1;
    if level_name is null then
      raise exception '거래처분류 이름이 비어 있습니다.'
        using errcode = 'invalid_parameter_value', hint = 'import_category_invalid';
    end if;
    path_text := case
      when level_number = 1 then level_name
      else path_text || ' > ' || level_name
    end;

    select category.id, category.is_active
    into found_id, found_is_active
    from public.partner_categories as category
    where category.name = level_name
      and (
        category.parent_id = parent_uuid
        or (parent_uuid is null and category.parent_id is null)
      );

    if found then
      if not found_is_active then
        raise exception '거래처분류 ‘%’이(가) 사용 중지되어 있어 거래처를 넣을 수 없습니다. 거래처분류설정에서 사용으로 바꾸거나 다른 분류를 적어 주세요.', path_text
          using errcode = 'check_violation', hint = 'import_category_inactive';
      end if;
    elsif create_missing then
      select coalesce(max(category.sort_order), 0) + 1 into next_sort_order
      from public.partner_categories as category
      where category.parent_id = parent_uuid
        or (parent_uuid is null and category.parent_id is null);

      insert into public.partner_categories (name, parent_id, sort_order)
      values (level_name, parent_uuid, next_sort_order)
      returning id into found_id;
    else
      raise exception '거래처분류 ‘%’이(가) 없습니다. 거래처분류설정에서 먼저 만들거나 ‘없는 분류는 자동으로 만들기’를 켜 주세요.', path_text
        using errcode = 'foreign_key_violation', hint = 'import_category_not_found';
    end if;

    parent_uuid := found_id;
  end loop;

  return parent_uuid;
end;
$$;

comment on function public.import_partner_category_id(jsonb, boolean) is '자료일괄등록: 이름으로 적은 거래처분류(대 > 중 > 소)의 ID. 없는 분류는 create_missing이면 만들고, 사용 중지된 분류는 거절합니다.';

-- -----------------------------------------------------------------------------
-- 4. The import functions
--
-- All of them:
-- - run with the permissions of the employee calling them (security
--   invoker: the same RLS and privileges as the 등록 screens);
-- - check the request first (import_check_rows; at most 3,000 rows);
-- - save every row inside one BEGIN … EXCEPTION block: the first failing
--   row undoes everything and is reported with its Excel row
--   (import_raise_row_error). Lock waits, deadlocks and serialization
--   failures are passed on unchanged ("try again"), not as a row error.
-- -----------------------------------------------------------------------------

-- 상품분류 일괄등록.
-- rows: [{"excel_row": 2, "path": ["가공식품", "통조림"], "is_active": true}, …]
--   path = 1–3 names from the 대분류 down. Every missing level is created
--   (at the end of its list); is_active applies to the last level when it
--   is created (levels above it are created as 사용). Levels that exist are
--   reused and never changed.
-- Returns {"inserted": categories created, "created_categories": same,
--          "skipped": rows whose whole path already existed}.
create function public.import_product_categories(rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_rows constant integer := 3000;
  entry record;
  row_value jsonb;
  current_row integer;
  current_field text;
  level_name text;
  level_number integer;
  level_count integer;
  parent_uuid uuid;
  found_id uuid;
  next_sort_order integer;
  row_created boolean;
  categories_before integer;
  skipped_count integer := 0;
  error_state text;
  error_message text;
  error_hint text;
  error_constraint text;
begin
  perform public.import_check_rows(rows, max_rows);
  if jsonb_array_length(rows) = 0 then
    raise exception '등록할 행이 없습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_empty';
  end if;

  -- One category import (or 분류값 save) at a time; everyone can keep
  -- reading the categories meanwhile.
  lock table public.product_categories in share row exclusive mode;
  select count(*) into categories_before from public.product_categories;

  begin
    for entry in select value from jsonb_array_elements(rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;
      current_field := 'major';

      -- (jsonb_array_length fails on anything that is not an array.)
      level_count := case
        when jsonb_typeof(row_value -> 'path') = 'array'
          then jsonb_array_length(row_value -> 'path')
        else 0
      end;
      if level_count not between 1 and 3 then
        raise exception '분류는 대분류 → 중분류 → 소분류 3단계까지 입력할 수 있습니다.'
          using errcode = 'invalid_parameter_value', hint = 'import_category_invalid';
      end if;

      parent_uuid := null;
      level_number := 0;
      row_created := false;
      for level_name in select value from jsonb_array_elements_text(row_value -> 'path') loop
        level_number := level_number + 1;
        current_field := case level_number
          when 1 then 'major'
          when 2 then 'middle'
          else 'minor'
        end;

        select category.id into found_id
        from public.product_categories as category
        where category.name = level_name
          and (
            category.parent_id = parent_uuid
            or (parent_uuid is null and category.parent_id is null)
          );

        if not found then
          select coalesce(max(category.sort_order), 0) + 1 into next_sort_order
          from public.product_categories as category
          where category.parent_id = parent_uuid
            or (parent_uuid is null and category.parent_id is null);

          insert into public.product_categories (name, parent_id, sort_order, is_active)
          values (
            level_name,
            parent_uuid,
            next_sort_order,
            case
              when level_number = level_count
                then coalesce((row_value ->> 'is_active')::boolean, true)
              else true
            end
          )
          returning id into found_id;
          row_created := true;
        end if;

        parent_uuid := found_id;
      end loop;

      if not row_created then
        skipped_count := skipped_count + 1;
      end if;
    end loop;
  exception when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_hint = pg_exception_hint,
      error_constraint = constraint_name;
    if error_state in ('40001', '40P01', '55P03') then
      raise;
    end if;
    perform public.import_raise_row_error(
      'main', current_row, current_field,
      error_state, error_message, error_hint, error_constraint
    );
  end;

  return jsonb_build_object(
    'inserted', (select count(*) from public.product_categories) - categories_before,
    'created_categories', (select count(*) from public.product_categories) - categories_before,
    'skipped', skipped_count
  );
end;
$$;

comment on function public.import_product_categories(jsonb) is '자료일괄등록: 상품분류 경로(대 > 중 > 소)를 한 번에 등록합니다. 없는 분류만 만들고 있는 분류는 그대로 씁니다. 실패하면 아무것도 저장하지 않고 엑셀 행번호를 알립니다.';

-- 상품 일괄등록 (기준상품 and 묶음상품).
-- base_rows: [{"excel_row", "code", "name", "category_path" (null = 미분류),
--              "spec", "unit", "storage_type", "tax_type",
--              "purchase_price_incl_vat", "sale_price_incl_vat", "origin",
--              "manufacturer", "shelf_life_days", "barcode",
--              "allergens" (keys), "is_active", "note"}, …]
-- bundle_rows: [{"excel_row", "code", "name", "category_path", "spec",
--                "unit", "purchase_price_incl_vat", "sale_price_incl_vat",
--                "barcode", "is_active", "note",
--                "items": [{"component_code": "PRC-010", "quantity": 6}, …]}, …]
-- 기준상품 are saved first, so a 묶음상품 may use a 기준상품 of the same
-- file. Each 묶음상품 is saved with create_bundle_product (the same checks
-- as the 등록 screen). Together at most 3,000 rows.
-- Returns {"inserted", "base_inserted", "bundle_inserted",
--          "created_categories", "codes": [상품코드 in the order saved]}.
create function public.import_products(
  base_rows jsonb,
  bundle_rows jsonb,
  create_missing_categories boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_rows constant integer := 3000;
  entry record;
  item record;
  row_value jsonb;
  current_sheet text;
  current_row integer;
  current_field text;
  category_uuid uuid;
  component_uuid uuid;
  bundle_items jsonb;
  categories_before integer;
  base_count integer := 0;
  bundle_count integer := 0;
  saved_codes text[] := '{}';
  error_state text;
  error_message text;
  error_hint text;
  error_constraint text;
begin
  base_rows := coalesce(base_rows, '[]'::jsonb);
  bundle_rows := coalesce(bundle_rows, '[]'::jsonb);
  perform public.import_check_rows(base_rows, max_rows);
  perform public.import_check_rows(bundle_rows, max_rows);
  if jsonb_array_length(base_rows) + jsonb_array_length(bundle_rows) > max_rows then
    raise exception '한 번에 %행까지 등록할 수 있습니다. 파일을 나눠서 올려 주세요.', max_rows
      using errcode = 'invalid_parameter_value', hint = 'import_too_many_rows';
  end if;
  if jsonb_array_length(base_rows) + jsonb_array_length(bundle_rows) = 0 then
    raise exception '등록할 행이 없습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_empty';
  end if;

  -- The categories stay as they are until this import is finished (nobody
  -- switches one off or adds the same one at the same moment).
  lock table public.product_categories in share row exclusive mode;
  select count(*) into categories_before from public.product_categories;

  begin
    -- 1. 기준상품
    current_sheet := 'base';
    for entry in select value from jsonb_array_elements(base_rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;

      current_field := 'category';
      category_uuid := public.import_product_category_id(
        row_value -> 'category_path', create_missing_categories
      );
      current_field := null;

      -- Who/when are filled in by the products trigger.
      insert into public.products (
        product_type, code, name, category_id, spec, unit, storage_type,
        tax_type, purchase_price_incl_vat, sale_price_incl_vat, origin,
        manufacturer, shelf_life_days, barcode, allergens, is_active, note
      )
      values (
        'base',
        row_value ->> 'code',
        row_value ->> 'name',
        category_uuid,
        row_value ->> 'spec',
        row_value ->> 'unit',
        (row_value ->> 'storage_type')::public.storage_type,
        (row_value ->> 'tax_type')::public.tax_type,
        (row_value ->> 'purchase_price_incl_vat')::bigint,
        (row_value ->> 'sale_price_incl_vat')::bigint,
        row_value ->> 'origin',
        row_value ->> 'manufacturer',
        (row_value ->> 'shelf_life_days')::integer,
        row_value ->> 'barcode',
        array(
          select allergen.value
          from jsonb_array_elements_text(
            coalesce(row_value -> 'allergens', '[]'::jsonb)
          ) as allergen (value)
        ),
        coalesce((row_value ->> 'is_active')::boolean, true),
        row_value ->> 'note'
      );

      base_count := base_count + 1;
      saved_codes := array_append(saved_codes, row_value ->> 'code');
    end loop;

    -- 2. 묶음상품
    current_sheet := 'bundle';
    for entry in select value from jsonb_array_elements(bundle_rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;

      current_field := 'category';
      category_uuid := public.import_product_category_id(
        row_value -> 'category_path', create_missing_categories
      );

      -- 구성상품: 기준상품코드 (ignoring case) → id. Whether it is a
      -- 기준상품 and 사용 is checked by create_bundle_product's triggers.
      current_field := 'components';
      bundle_items := '[]'::jsonb;
      for item in
        select value
        from jsonb_array_elements(coalesce(row_value -> 'items', '[]'::jsonb))
      loop
        select product.id into component_uuid
        from public.products as product
        where lower(product.code) = lower(item.value ->> 'component_code');

        if not found then
          raise exception '구성상품 ‘%’을(를) 찾을 수 없습니다. 기준상품코드를 확인해 주세요.', item.value ->> 'component_code'
            using errcode = 'foreign_key_violation', hint = 'bundle_component_not_found';
        end if;

        bundle_items := bundle_items || jsonb_build_array(
          jsonb_build_object(
            'component_id', component_uuid,
            'quantity', item.value -> 'quantity'
          )
        );
      end loop;
      current_field := null;

      perform public.create_bundle_product(
        jsonb_build_object(
          'code', row_value -> 'code',
          'name', row_value -> 'name',
          'category_id', category_uuid,
          'spec', row_value -> 'spec',
          'unit', row_value -> 'unit',
          'purchase_price_incl_vat', row_value -> 'purchase_price_incl_vat',
          'sale_price_incl_vat', row_value -> 'sale_price_incl_vat',
          'barcode', row_value -> 'barcode',
          'is_active', coalesce(row_value -> 'is_active', 'true'::jsonb),
          'note', row_value -> 'note'
        ),
        bundle_items
      );

      bundle_count := bundle_count + 1;
      saved_codes := array_append(saved_codes, row_value ->> 'code');
    end loop;
  exception when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_hint = pg_exception_hint,
      error_constraint = constraint_name;
    if error_state in ('40001', '40P01', '55P03') then
      raise;
    end if;
    perform public.import_raise_row_error(
      current_sheet, current_row, current_field,
      error_state, error_message, error_hint, error_constraint
    );
  end;

  return jsonb_build_object(
    'inserted', base_count + bundle_count,
    'base_inserted', base_count,
    'bundle_inserted', bundle_count,
    'created_categories', (select count(*) from public.product_categories) - categories_before,
    'codes', to_jsonb(saved_codes)
  );
end;
$$;

comment on function public.import_products(jsonb, jsonb, boolean) is '자료일괄등록: 기준상품과 묶음상품(구성상품은 기준상품코드)을 한 번에 등록합니다. 없는 상품분류는 create_missing_categories이면 만듭니다. 실패하면 아무것도 저장하지 않고 시트와 엑셀 행번호를 알립니다.';

-- 거래처 일괄등록.
-- rows: [{"excel_row", the partners columns as create_partner takes them
--         ("partner_type", "code", "name", "phone", "industry", "is_active",
--          "payment_term", "payment_day", "credit_limit_type",
--          "credit_limit", "invoice_type", "slip_print", "business_number",
--          "company_name", "representative", "business_category",
--          "business_item", "postal_code", "address", "address_detail",
--          "tax_email", "note"),
--         "category_path" (거래처분류 names, null = 미분류),
--         "sales_rep_code", "delivery_rep_code" (직원코드 or null),
--         "contacts": [] or [one 대표 담당자 as create_partner takes it],
--         "addresses": [] or [one 기본 배송지 as create_partner takes it]}, …]
-- Each partner is saved with create_partner (the same checks as the 등록
-- screen, incl. 영업담당 = 재직 + 영업담당, 배송담당 = 재직 + 배송담당).
-- Returns {"inserted", "created_categories", "codes": [거래처코드 …]}.
create function public.import_partners(
  rows jsonb,
  create_missing_categories boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_rows constant integer := 3000;
  entry record;
  row_value jsonb;
  current_row integer;
  current_field text;
  category_uuid uuid;
  sales_rep_uuid uuid;
  delivery_rep_uuid uuid;
  categories_before integer;
  partner_count integer := 0;
  saved_codes text[] := '{}';
  error_state text;
  error_message text;
  error_hint text;
  error_constraint text;
begin
  perform public.import_check_rows(rows, max_rows);
  if jsonb_array_length(rows) = 0 then
    raise exception '등록할 행이 없습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_empty';
  end if;

  -- One 거래처분류 change at a time (also 분류값 설정): nobody switches a
  -- category off or adds the same one while this import runs.
  lock table public.partner_categories in share row exclusive mode;
  select count(*) into categories_before from public.partner_categories;

  begin
    for entry in select value from jsonb_array_elements(rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;

      current_field := 'category';
      category_uuid := public.import_partner_category_id(
        row_value -> 'category_path', create_missing_categories
      );

      -- 영업담당 / 배송담당 by 직원코드 (ignoring case). Whether they are
      -- 재직 and have the 담당업무 is checked by check_partner_references.
      current_field := 'salesRep';
      sales_rep_uuid := null;
      if nullif(row_value ->> 'sales_rep_code', '') is not null then
        select employee.id into sales_rep_uuid
        from public.employees as employee
        where lower(employee.code) = lower(row_value ->> 'sales_rep_code');
        if not found then
          raise exception '영업담당 직원코드 ‘%’인 직원이 없습니다. 직원관리에서 직원코드를 확인해 주세요.', row_value ->> 'sales_rep_code'
            using errcode = 'foreign_key_violation', hint = 'import_employee_not_found';
        end if;
      end if;

      current_field := 'deliveryRep';
      delivery_rep_uuid := null;
      if nullif(row_value ->> 'delivery_rep_code', '') is not null then
        select employee.id into delivery_rep_uuid
        from public.employees as employee
        where lower(employee.code) = lower(row_value ->> 'delivery_rep_code');
        if not found then
          raise exception '배송담당 직원코드 ‘%’인 직원이 없습니다. 직원관리에서 직원코드를 확인해 주세요.', row_value ->> 'delivery_rep_code'
            using errcode = 'foreign_key_violation', hint = 'import_employee_not_found';
        end if;
      end if;
      current_field := null;

      perform public.create_partner(
        row_value || jsonb_build_object(
          'category_id', category_uuid,
          'sales_rep_id', sales_rep_uuid,
          'delivery_rep_id', delivery_rep_uuid
        ),
        coalesce(row_value -> 'contacts', '[]'::jsonb),
        coalesce(row_value -> 'addresses', '[]'::jsonb)
      );

      partner_count := partner_count + 1;
      saved_codes := array_append(saved_codes, row_value ->> 'code');
    end loop;
  exception when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_hint = pg_exception_hint,
      error_constraint = constraint_name;
    if error_state in ('40001', '40P01', '55P03') then
      raise;
    end if;
    perform public.import_raise_row_error(
      'main', current_row, current_field,
      error_state, error_message, error_hint, error_constraint
    );
  end;

  return jsonb_build_object(
    'inserted', partner_count,
    'created_categories', (select count(*) from public.partner_categories) - categories_before,
    'codes', to_jsonb(saved_codes)
  );
end;
$$;

comment on function public.import_partners(jsonb, boolean) is '자료일괄등록: 거래처(대표 담당자 1명, 기본 배송지 1곳 포함)를 한 번에 등록합니다. 영업담당·배송담당은 직원코드로, 거래처분류는 이름으로 받습니다. 실패하면 아무것도 저장하지 않고 엑셀 행번호를 알립니다.';

-- 직원 일괄등록.
-- rows: [{"excel_row", "code" (null = 자동), "name", "hire_date",
--         "is_active", "is_sales_rep", "is_delivery_driver", "mobile",
--         "mobile2", "email", "phone", "postal_code", "address",
--         "address_detail", "department", "job_title", "employment_type",
--         "is_salary_paid", "resignation_date", "driver_operation_type",
--         "vehicle_number", "vehicle_type", "note"}, …]
-- Rows without 직원코드 get the next numbers after the highest code made
-- only of digits (in the database and in this file), in file order, with
-- at least 4 digits (0015, 0016, …) — the same numbering as
-- suggest_employee_code(). The employees table is locked meanwhile (other
-- saves of 직원 wait a moment), so two imports never hand out the same code.
-- 휴대폰번호1 is required (as on the 직원 등록 screen).
-- Returns {"inserted", "codes": [직원코드 in file order, incl. the new ones]}.
create function public.import_employees(rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_rows constant integer := 3000;
  entry record;
  row_value jsonb;
  current_row integer;
  current_field text;
  last_number numeric;
  new_code text;
  employee_count integer := 0;
  saved_codes text[] := '{}';
  error_state text;
  error_message text;
  error_hint text;
  error_constraint text;
begin
  perform public.import_check_rows(rows, max_rows);
  if jsonb_array_length(rows) = 0 then
    raise exception '등록할 행이 없습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_empty';
  end if;

  lock table public.employees in share row exclusive mode;

  -- The highest code made only of digits, in the database and in the file.
  select coalesce(max(numbered.code::numeric), 0) into last_number
  from (
    select employee.code
    from public.employees as employee
    where employee.code ~ '^[0-9]{1,30}$'
    union all
    select item.value ->> 'code'
    from jsonb_array_elements(rows) as item (value)
    where (item.value ->> 'code') ~ '^[0-9]{1,30}$'
  ) as numbered;

  begin
    for entry in select value from jsonb_array_elements(rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;
      current_field := null;

      new_code := nullif(row_value ->> 'code', '');
      if new_code is null then
        last_number := last_number + 1;
        new_code := case
          when length(last_number::text) >= 4 then last_number::text
          else lpad(last_number::text, 4, '0')
        end;
      end if;

      if nullif(row_value ->> 'mobile', '') is null then
        raise exception '휴대폰번호1을 입력해 주세요.'
          using errcode = 'not_null_violation', hint = 'employee_mobile_required';
      end if;

      -- Who/when are filled in by the employees trigger.
      insert into public.employees (
        code, name, hire_date, is_active, is_sales_rep, is_delivery_driver,
        mobile, mobile2, email, phone, postal_code, address, address_detail,
        department, job_title, employment_type, is_salary_paid,
        resignation_date, driver_operation_type, vehicle_number,
        vehicle_type, note
      )
      values (
        new_code,
        row_value ->> 'name',
        (row_value ->> 'hire_date')::date,
        coalesce((row_value ->> 'is_active')::boolean, true),
        coalesce((row_value ->> 'is_sales_rep')::boolean, false),
        coalesce((row_value ->> 'is_delivery_driver')::boolean, false),
        row_value ->> 'mobile',
        row_value ->> 'mobile2',
        row_value ->> 'email',
        row_value ->> 'phone',
        row_value ->> 'postal_code',
        row_value ->> 'address',
        row_value ->> 'address_detail',
        row_value ->> 'department',
        row_value ->> 'job_title',
        (row_value ->> 'employment_type')::public.employment_type,
        coalesce((row_value ->> 'is_salary_paid')::boolean, true),
        (row_value ->> 'resignation_date')::date,
        (row_value ->> 'driver_operation_type')::public.driver_operation_type,
        row_value ->> 'vehicle_number',
        (row_value ->> 'vehicle_type')::public.vehicle_type,
        row_value ->> 'note'
      );

      employee_count := employee_count + 1;
      saved_codes := array_append(saved_codes, new_code);
    end loop;
  exception when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_hint = pg_exception_hint,
      error_constraint = constraint_name;
    if error_state in ('40001', '40P01', '55P03') then
      raise;
    end if;
    perform public.import_raise_row_error(
      'main', current_row, current_field,
      error_state, error_message, error_hint, error_constraint
    );
  end;

  return jsonb_build_object(
    'inserted', employee_count,
    'codes', to_jsonb(saved_codes)
  );
end;
$$;

comment on function public.import_employees(jsonb) is '자료일괄등록: 직원을 한 번에 등록합니다. 직원코드가 비어 있으면 숫자 코드 중 가장 큰 번호 다음부터 차례로(0015, 0016 …) 붙입니다. 실패하면 아무것도 저장하지 않고 엑셀 행번호를 알립니다.';

-- -----------------------------------------------------------------------------
-- 5. Privileges
--
-- Only signed-in employees (and the server's service role) may call these
-- functions; not-signed-in visitors (anon) and everyone else (public) may
-- not. Revoke first: Supabase gives new functions default privileges.
-- The helpers run with the caller's permissions, so they can do nothing the
-- caller could not do with the tables directly; the import functions need
-- to call them.
-- -----------------------------------------------------------------------------

revoke all on function public.import_check_rows(jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.import_check_rows(jsonb, integer)
  to authenticated, service_role;

revoke all on function public.import_error_field(text, text)
  from public, anon, authenticated;
grant execute on function public.import_error_field(text, text)
  to authenticated, service_role;

revoke all on function public.import_raise_row_error(text, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.import_raise_row_error(text, integer, text, text, text, text, text)
  to authenticated, service_role;

revoke all on function public.import_find_products(text[], text[])
  from public, anon, authenticated;
grant execute on function public.import_find_products(text[], text[])
  to authenticated, service_role;

revoke all on function public.import_find_partners(text[], text[])
  from public, anon, authenticated;
grant execute on function public.import_find_partners(text[], text[])
  to authenticated, service_role;

revoke all on function public.import_find_employees(text[])
  from public, anon, authenticated;
grant execute on function public.import_find_employees(text[])
  to authenticated, service_role;

revoke all on function public.import_product_category_id(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_product_category_id(jsonb, boolean)
  to authenticated, service_role;

revoke all on function public.import_partner_category_id(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_partner_category_id(jsonb, boolean)
  to authenticated, service_role;

revoke all on function public.import_product_categories(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_product_categories(jsonb)
  to authenticated, service_role;

revoke all on function public.import_products(jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_products(jsonb, jsonb, boolean)
  to authenticated, service_role;

revoke all on function public.import_partners(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_partners(jsonb, boolean)
  to authenticated, service_role;

revoke all on function public.import_employees(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_employees(jsonb)
  to authenticated, service_role;

-- Tell the API (PostgREST) to reload its picture of the database, so the
-- new functions are usable right away.
notify pgrst, 'reload schema';
