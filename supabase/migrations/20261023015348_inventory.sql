-- =============================================================================
-- 재고관리 1차 (inventory): 창고·구역·위치, 로트, 재고 원장(전표), FEFO 출고
--
-- Runs after 20261022101634_bulk_import.sql. It only ADDS types, tables,
-- views, functions and one trigger on products (a product's 단위 is fixed
-- once it has stock records, see check_product_unit_change): no existing
-- table, view, function or row changes (the new table app_settings gets
-- its one settings row).
--
-- The owner's rules (decided 2026-10-23):
-- - Stock is kept per LOT and per LOCATION.
--   * A lot (stock_lots) = one 기준상품 received once, with its 기한 (소비기한
--     or 유통기한, or none), 제조일자, 입고일, 입고 단가 (부가세 포함) and
--     매입처. Its 로트번호 is typed or given automatically
--     ("L20261023-001": L + registration date + number of that day).
--   * A location = 창고 (warehouses) > 구역 (warehouse_zones, each with a
--     보관온도 상온/냉장/냉동) > 위치/선반 (storage_locations, e.g.
--     "B-02-R02"). Every 구역 gets a "기본" 위치 automatically and always
--     keeps it. Users add, rename and switch them off (사용중지); deleting
--     works only while nothing was ever stored there.
-- - Only 기준상품 have stock. A 묶음상품 that is received or issued is turned
--   into its 기준상품 × 수량 (구성표) first; every 기준상품 gets its own lot.
-- - Stock never goes below 0: not for any lot at any location, and not at
--   any earlier date either (a back-dated 전표 is checked against the
--   history of every lot and location it takes stock from).
-- - Every change of stock is a 전표 (stock_documents: 기초재고, 입고, 출고,
--   폐기, 이동, 실사조정, 취소) with lines (stock_movements: lot, location,
--   signed quantity). Lines are NEVER changed or deleted. A wrong 전표 is
--   undone with a 취소 전표 holding the opposite lines, only while the stock
--   it would take back is still there.
-- - stock_balances = the current quantity of every (lot, location). Only
--   the trigger on stock_movements changes it, so it always equals the sum
--   of the lines; stock_integrity_check() proves it (and more).
-- - 출고 picks lots by FEFO: the earliest 기한 first, then the earliest
--   입고일 (then the older lot); lots without a 기한 last; never a lot whose
--   기한 is before the 전표 date (기한 경과). 폐기 picks lots by hand.
-- - 입고 단가 is VAT-inclusive (부가세 포함) like product prices; 부가세
--   별도 amounts use vat_excluded_amount (migration 4).
-- - 기한 임박 = 0 to N days left, N = app_settings.expiry_warning_days
--   (default 7, changed on the 재고 설정 screen); 기한 경과 = the 기한일 is
--   before today (Korea time).
--
-- Who may do what:
-- - Every signed-in employee reads everything, and adds / changes /
--   deletes 창고·구역·위치 and the settings directly (like the 분류 tables).
-- - The stock tables (lots, balances, documents, movements) are READ-ONLY
--   for employees: they change only through the functions in steps 11–12
--   (receive_stock, issue_stock, dispose_stock, transfer_stock,
--   apply_stock_count, reverse_stock_document, import_opening_stock).
--   Those functions are SECURITY DEFINER (they run with the rights of the
--   database owner): this is the only way to let employees write stock
--   while keeping direct writes impossible. Each one checks every value it
--   gets, records the employee (auth.uid()) and may only be called by
--   signed-in employees (EXECUTE granted to authenticated, not to anon).
--   This is a deliberate exception to the project's "security invoker"
--   rule; the read functions are security invoker as usual.
--
-- Concurrency (two employees at the same moment):
-- - Every function that takes stock from existing lots first locks those
--   lot rows (FOR NO KEY UPDATE) in one statement, ordered by id. Work on
--   the same lot is therefore done one after the other, always in the same
--   order, so it can never deadlock; then it reads the quantities again and
--   decides. New lots (입고, 기초재고, 실사 추가) need no lock.
-- - Document and lot numbers come from stock_number_counters (one row per
--   prefix and day, locked until the end of the transaction): each
--   function takes at most one document number and at most one kind of
--   lot number, always in that order.
-- - The CHECK (quantity >= 0) on stock_balances is the last guard: even a
--   bug can never store negative stock.
--
-- Messages a user may see are in Korean; each error raised here carries an
-- English key in HINT (listed in INVENTORY_DB_RULES in
-- src/lib/inventory/constants.ts — change both together) and, for errors
-- about one line, DETAIL = JSON {"line": 1-based line number, "field":
-- the JSON key, "list": "lines" | "new_lots"}. Every such error uses an
-- error code the API answers with HTTP 4xx (22xxx, 23xxx or P0001).
--
-- What this file does, in this order:
--  1. Enums.
--  2. Small shared functions (today in Korea, units, codes, errors, reading
--     JSON values).
--  3. app_settings (기한 임박 기준일).
--  4. warehouses, warehouse_zones, storage_locations (+ the "기본" 위치).
--  5. The stock tables: stock_documents, stock_lots, stock_movements,
--     stock_balances, stock_number_counters, and their triggers.
--  6. Row Level Security and privileges of the tables.
--  7. Views: lot_stock_items, product_stock_summary, storage_location_items,
--     stock_document_list_items, stock_movement_items.
--  8. Helpers of the save functions (numbers, documents, lots, history).
--  9. Read functions: stock_bundle_components, stock_issue_plan,
--     plan_stock_issue, allocate_fefo, stock_transfer_warnings,
--     stock_count_sheet.
-- 10. Reports: stock_period_report, product_stock_ledger, stock_dashboard,
--     stock_integrity_check.
-- 11. Save functions: receive_stock, issue_stock, dispose_stock,
--     transfer_stock, apply_stock_count, reverse_stock_document.
-- 12. 기초재고 일괄등록: import_find_opening_stock_refs,
--     import_opening_stock.
-- 13. Function privileges, then the API (PostgREST) is told to reload.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.expiry_kind as enum ('use_by', 'sell_by', 'none');
comment on type public.expiry_kind is '기한 종류: use_by=소비기한, sell_by=유통기한, none=기한 없음';

-- The order is the sort order of the document lists.
create type public.stock_document_type as enum (
  'opening', 'receipt', 'issue', 'disposal', 'transfer', 'count', 'reversal'
);
comment on type public.stock_document_type is '재고 전표 종류: opening=기초재고, receipt=입고, issue=출고, disposal=폐기, transfer=이동, count=실사조정, reversal=취소';

create type public.disposal_reason as enum ('expired', 'damaged', 'quality', 'other');
comment on type public.disposal_reason is '폐기 사유: expired=기한 경과, damaged=파손, quality=품질 불량, other=기타(메모 필수)';

-- -----------------------------------------------------------------------------
-- 2. Small shared functions
-- -----------------------------------------------------------------------------

-- Today's date in Korea (Asia/Seoul), whatever the server's time zone.
-- now() is the start of the transaction, so one request sees one "today".
create function public.stock_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

comment on function public.stock_today() is '오늘 날짜 (한국 시간 기준)';

-- Units whose quantities may have decimals (up to 3 places): weight and
-- volume. Every other unit (개, 박스, 봉, 캔 …) counts whole pieces only.
-- Same list as unitAllowsFraction in src/lib/inventory/constants.ts.
create function public.unit_allows_fraction(unit text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(unit, ''))) in ('kg', 'g', 'l', 'ml')
$$;

comment on function public.unit_allows_fraction(text) is '소수점 수량을 쓸 수 있는 단위인지 (kg, g, L, mL). 다른 단위(개, 박스, 봉 …)는 정수만 씁니다.';

-- Codes of 창고 / 구역 / 위치: letters, digits, Hangul syllables, ".", "_"
-- and "-" (no spaces), 1 to max_length characters (e.g. "W01", "B-02-R02",
-- "기본"). Same rule as STOCK_PLACE_CODE_PATTERN in src/lib/inventory/constants.ts.
create function public.is_stock_place_code(value text, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value ~ '^[0-9A-Za-z가-힣._-]+$'
    and char_length(value) between 1 and max_length
$$;

comment on function public.is_stock_place_code(text, integer) is '창고·구역·위치 코드 규칙: 영문·숫자·한글·.-_ (공백 없음), 1~max_length자';

-- The number part of a document / lot number: at least 3 digits
-- ("001", "042", "1000").
create function public.stock_number_text(sequence_number integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when sequence_number < 1000 then lpad(sequence_number::text, 3, '0')
    else sequence_number::text
  end
$$;

comment on function public.stock_number_text(integer) is '전표·로트 번호의 일련번호 부분 (3자리 이상, 예: 001)';

-- A quantity as people read it in a message: "1,234", "12.5", "0.125".
create function public.stock_quantity_text(quantity numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when quantity is null then '-'
    when quantity = trunc(quantity) then to_char(quantity, 'FM999,999,999,999,990')
    else to_char(quantity, 'FM999,999,999,999,990.999')
  end
$$;

comment on function public.stock_quantity_text(numeric) is '메시지에 쓰는 수량 글자 (천 단위 쉼표, 소수점 아래 0 생략)';

-- Raises the error of a save or read function: a Korean message, the HINT
-- key and DETAIL = JSON {"line", "field", "list", …}. Never returns.
-- state: the error code (22023 = invalid value, 23514 = rule broken,
-- 23503 = something it points to is missing, P0001 = other).
create function public.raise_stock_error(
  message text,
  rule text,
  line_no integer default null,
  field text default null,
  state text default 'P0001',
  extra jsonb default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', message
    using
      errcode = state,
      hint = rule,
      detail = (
        jsonb_build_object('line', line_no, 'field', field)
        || coalesce(extra, '{}'::jsonb)
      )::text;
end;
$$;

comment on function public.raise_stock_error(text, text, integer, text, text, jsonb) is '재고 함수의 오류를 알립니다: 한국어 메시지, HINT 키, DETAIL JSON(줄 번호 line, 항목 field).';

-- Reading values from the JSON arguments of the save functions. Each one
-- checks the value and raises a Korean error naming the line and field.

-- A required or optional id (uuid). Empty → null (or an error if required).
create function public.read_stock_uuid(
  value jsonb,
  required boolean,
  line_no integer,
  field text,
  label text,
  list text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  value_text text;
begin
  if value is null or jsonb_typeof(value) = 'null'
    or (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '') then
    if required then
      perform public.raise_stock_error(
        label || '을(를) 선택해 주세요.', 'stock_value_required',
        line_no, field, '22023', jsonb_build_object('list', list)
      );
    end if;
    return null;
  end if;
  value_text := btrim(value #>> '{}');
  if jsonb_typeof(value) <> 'string'
    or value_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform public.raise_stock_error(
      label || '을(를) 다시 선택해 주세요.', 'stock_id_invalid',
      line_no, field, '22023', jsonb_build_object('list', list)
    );
  end if;
  return value_text::uuid;
end;
$$;

comment on function public.read_stock_uuid(jsonb, boolean, integer, text, text, text) is '재고 함수: JSON 값에서 ID(uuid)를 읽습니다 (형식이 틀리면 오류).';

-- A quantity: a JSON number (or the same digits as text) with at most 3
-- decimals, at most 100,000,000; above 0 (or 0 too when allow_zero);
-- whole numbers only when whole_only (units such as 개, 박스).
create function public.read_stock_quantity(
  value jsonb,
  whole_only boolean,
  allow_zero boolean,
  line_no integer,
  field text,
  label text,
  list text default null
)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  value_text text;
  quantity numeric;
  extra jsonb := jsonb_build_object('list', list);
begin
  if value is null or jsonb_typeof(value) = 'null'
    or (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '') then
    perform public.raise_stock_error(
      label || '을(를) 입력해 주세요.', 'stock_quantity_required',
      line_no, field, '22023', extra
    );
  end if;
  value_text := btrim(value #>> '{}');
  if jsonb_typeof(value) not in ('number', 'string')
    or value_text !~ '^[0-9]+(\.[0-9]+)?$' then
    perform public.raise_stock_error(
      label || '은(는) 숫자로 입력해 주세요.', 'stock_quantity_invalid',
      line_no, field, '22023', extra
    );
  end if;
  quantity := value_text::numeric;
  if quantity = 0 and not allow_zero then
    perform public.raise_stock_error(
      label || '은(는) 0보다 커야 합니다.', 'stock_quantity_not_positive',
      line_no, field, '22023', extra
    );
  end if;
  if quantity <> round(quantity, 3) then
    perform public.raise_stock_error(
      label || '은(는) 소수점 아래 3자리까지 입력할 수 있습니다.', 'stock_quantity_too_precise',
      line_no, field, '22023', extra
    );
  end if;
  if quantity > 100000000 then
    perform public.raise_stock_error(
      label || '은(는) 100,000,000 이하로 입력해 주세요.', 'stock_quantity_too_large',
      line_no, field, '22023', extra
    );
  end if;
  if whole_only and quantity <> trunc(quantity) then
    perform public.raise_stock_error(
      label || '은(는) 정수로 입력해 주세요. (kg·g·L·mL 단위 상품만 소수점을 쓸 수 있습니다.)',
      'stock_quantity_not_whole', line_no, field, '22023', extra
    );
  end if;
  return quantity;
end;
$$;

comment on function public.read_stock_quantity(jsonb, boolean, boolean, integer, text, text, text) is '재고 함수: 수량을 읽습니다 (0 초과(또는 0 허용), 소수점 3자리, 1억 이하, 개·박스 등은 정수).';

-- An optional amount in whole won (부가세 포함 단가): 0 to 10,000,000,000.
create function public.read_stock_amount(
  value jsonb,
  line_no integer,
  field text,
  label text,
  list text default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  value_text text;
begin
  if value is null or jsonb_typeof(value) = 'null'
    or (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '') then
    return null;
  end if;
  value_text := btrim(value #>> '{}');
  if jsonb_typeof(value) not in ('number', 'string')
    or value_text !~ '^[0-9]{1,11}$'
    or value_text::bigint > 10000000000 then
    perform public.raise_stock_error(
      label || '은(는) 0원 이상 100억 원 이하의 정수(원 단위)로 입력해 주세요.',
      'stock_amount_invalid', line_no, field, '22023', jsonb_build_object('list', list)
    );
  end if;
  return value_text::bigint;
end;
$$;

comment on function public.read_stock_amount(jsonb, integer, text, text, text) is '재고 함수: 원 단위 금액(선택)을 읽습니다 (0~100억, 정수).';

-- An optional calendar date written "YYYY-MM-DD" (2000-01-01 to 2099-12-31).
create function public.read_stock_date(
  value jsonb,
  line_no integer,
  field text,
  label text,
  list text default null
)
returns date
language plpgsql
set search_path = ''
as $$
declare
  value_text text;
  result date;
begin
  if value is null or jsonb_typeof(value) = 'null'
    or (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '') then
    return null;
  end if;
  value_text := btrim(value #>> '{}');
  if jsonb_typeof(value) = 'string' and value_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    -- make_date refuses days that do not exist (2026-02-30).
    begin
      result := make_date(
        substr(value_text, 1, 4)::integer,
        substr(value_text, 6, 2)::integer,
        substr(value_text, 9, 2)::integer
      );
    exception when others then
      result := null;
    end;
  end if;
  if result is null or result < date '2000-01-01' or result > date '2099-12-31' then
    perform public.raise_stock_error(
      label || '을(를) 날짜(예: 2026-10-23)로 입력해 주세요.', 'stock_date_invalid',
      line_no, field, '22023', jsonb_build_object('list', list)
    );
  end if;
  return result;
end;
$$;

comment on function public.read_stock_date(jsonb, integer, text, text, text) is '재고 함수: 날짜(선택, YYYY-MM-DD)를 읽습니다.';

-- Optional text: trimmed (spaces, tabs and line breaks at both ends), empty
-- → null, at most max_length characters, Unicode NFC.
create function public.read_stock_text(
  value jsonb,
  max_length integer,
  line_no integer,
  field text,
  label text,
  list text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  value_text text;
begin
  if value is null or jsonb_typeof(value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(value) not in ('string', 'number') then
    perform public.raise_stock_error(
      label || '을(를) 글자로 입력해 주세요.', 'stock_text_invalid',
      line_no, field, '22023', jsonb_build_object('list', list)
    );
  end if;
  value_text := normalize(
    regexp_replace(value #>> '{}', '^\s+|\s+$', '', 'g'),
    NFC
  );
  if value_text = '' then
    return null;
  end if;
  if char_length(value_text) > max_length then
    perform public.raise_stock_error(
      format('%s은(는) %s자 이하로 입력해 주세요.', label, max_length),
      'stock_text_too_long', line_no, field, '22023', jsonb_build_object('list', list)
    );
  end if;
  return value_text;
end;
$$;

comment on function public.read_stock_text(jsonb, integer, integer, text, text, text) is '재고 함수: 글자(선택)를 읽습니다 (앞뒤 공백 제거, 빈 값은 null, 최대 길이).';

-- The 전표 date: today (Korea) when empty; never in the future; not before
-- 2000-01-01. Back-dating is allowed (the history is checked).
create function public.read_stock_doc_date(value jsonb)
returns date
language plpgsql
set search_path = ''
as $$
declare
  result date;
begin
  result := coalesce(
    public.read_stock_date(value, null, 'doc_date', '전표 일자'),
    public.stock_today()
  );
  if result > public.stock_today() then
    perform public.raise_stock_error(
      format('전표 일자는 오늘(%s) 이후로 정할 수 없습니다.', public.stock_today()),
      'stock_doc_date_future', null, 'doc_date', '22023'
    );
  end if;
  return result;
end;
$$;

comment on function public.read_stock_doc_date(jsonb) is '재고 함수: 전표 일자를 읽습니다 (비우면 오늘, 미래 날짜 불가).';

-- Checks the shape of a list of lines: a JSON array of at most 3,000
-- objects; at least one unless allow_empty.
create function public.check_stock_lines(
  lines jsonb,
  allow_empty boolean,
  list text default 'lines'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if lines is null or jsonb_typeof(lines) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(lines) as item (value)
      where jsonb_typeof(item.value) <> 'object'
    ) then
    perform public.raise_stock_error(
      '전표 내용을 읽을 수 없습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.',
      'stock_lines_invalid', null, list, '22023', jsonb_build_object('list', list)
    );
  end if;
  if jsonb_array_length(lines) = 0 and not allow_empty then
    perform public.raise_stock_error(
      '전표에 줄을 1개 이상 넣어 주세요.', 'stock_lines_empty',
      null, list, '22023', jsonb_build_object('list', list)
    );
  end if;
  if jsonb_array_length(lines) > 3000 then
    perform public.raise_stock_error(
      '전표 하나에 3,000줄까지 넣을 수 있습니다. 전표를 나눠서 등록해 주세요.',
      'stock_too_many_lines', null, list, '22023', jsonb_build_object('list', list)
    );
  end if;
end;
$$;

comment on function public.check_stock_lines(jsonb, boolean, text) is '재고 함수: 줄 목록이 JSON 배열(최대 3,000줄)인지 확인합니다.';

-- 기한일 worked out from 제조일자 and the product's 유통기한 기준일수 N
-- ("제조일로부터 N일"): the 제조일자 counts as day 1, so the 기한일 is
-- 제조일자 + (N − 1) days (e.g. 2026-10-01, 10일 → 2026-10-10).
-- Same rule as suggestExpiryDate in src/lib/inventory/constants.ts.
create function public.stock_expiry_from_manufactured(
  manufactured date,
  shelf_life_days integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when manufactured is null or shelf_life_days is null or shelf_life_days < 1 then null
    else manufactured + (shelf_life_days - 1)
  end
$$;

comment on function public.stock_expiry_from_manufactured(date, integer) is '제조일자 + 유통기한 기준일수로 기한일 계산 (제조일을 1일째로 셈: 10월 1일 제조, 10일 → 10월 10일).';

-- -----------------------------------------------------------------------------
-- 3. app_settings: settings of the app (one row)
-- -----------------------------------------------------------------------------

create table public.app_settings (
  id integer primary key default 1,
  expiry_warning_days integer not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  -- Exactly one row (id 1).
  constraint app_settings_single_row_check check (id = 1),
  -- 기한 임박 기준일: 0 (only the 기한일 itself) to 365 days.
  constraint app_settings_expiry_warning_days_check
    check (expiry_warning_days is not null and expiry_warning_days between 0 and 365)
);

comment on table public.app_settings is '앱 설정 (한 줄). 재고 설정 화면에서 바꿉니다.';
comment on column public.app_settings.id is '항상 1 (설정은 한 줄)';
comment on column public.app_settings.expiry_warning_days is '기한 임박 기준일: 남은 일수가 이 값 이하이면 기한 임박 (0~365, 기본 7)';
comment on column public.app_settings.created_at is '등록 일시';
comment on column public.app_settings.updated_at is '마지막 수정 일시';
comment on column public.app_settings.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.app_settings.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger app_settings_set_audit_fields
  before insert or update on public.app_settings
  for each row execute function public.set_audit_fields();

insert into public.app_settings (id, expiry_warning_days) values (1, 7);

-- -----------------------------------------------------------------------------
-- 4. 창고 (warehouses) > 구역 (warehouse_zones) > 위치 (storage_locations)
--
-- Deleting a 창고 also deletes its 구역 and 위치, and deleting a 구역 its
-- 위치 (on delete cascade) — but only while no stock was ever stored at any
-- of those 위치: stock_balances and stock_movements point to the 위치 with
-- "on delete restrict", so the whole delete is refused otherwise.
-- -----------------------------------------------------------------------------

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  postal_code text,
  address text,
  address_detail text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  -- Limits: STOCK_PLACE_LIMITS in src/lib/inventory/constants.ts.
  constraint warehouses_code_check check (public.is_stock_place_code(code, 20)),
  constraint warehouses_name_check
    check (public.is_trimmed_text(name, 50) and name is nfc normalized),
  constraint warehouses_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  constraint warehouses_address_check
    check (address is null or public.is_trimmed_text(address, 200)),
  constraint warehouses_address_detail_check
    check (address_detail is null or public.is_trimmed_text(address_detail, 200)),
  constraint warehouses_address_parts_check
    check (address is not null or (postal_code is null and address_detail is null)),
  constraint warehouses_note_check
    check (note is null or public.is_trimmed_text(note, 500))
);

-- 창고코드 is unique ignoring case ("w01" = "W01").
create unique index warehouses_code_lower_key on public.warehouses (lower(code));

comment on table public.warehouses is '창고. 아래에 구역(보관온도별)과 위치(선반)가 있습니다. 재고를 넣은 적이 있으면 삭제할 수 없고 사용중지로 관리합니다.';
comment on column public.warehouses.id is '창고 고유 ID (자동 생성)';
comment on column public.warehouses.code is '창고코드 (영문·숫자·한글·.-_ 1~20자, 대소문자 구분 없이 중복 불가)';
comment on column public.warehouses.name is '창고명 (1~50자)';
comment on column public.warehouses.postal_code is '우편번호 (숫자 5자리)';
comment on column public.warehouses.address is '주소';
comment on column public.warehouses.address_detail is '상세주소';
comment on column public.warehouses.note is '메모 (500자 이하)';
comment on column public.warehouses.is_active is '사용 여부. 사용중지된 창고에는 재고를 새로 넣을 수 없습니다 (있는 재고는 꺼낼 수 있음)';
comment on column public.warehouses.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.warehouses.created_at is '등록 일시';
comment on column public.warehouses.updated_at is '마지막 수정 일시';
comment on column public.warehouses.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.warehouses.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger warehouses_set_audit_fields
  before insert or update on public.warehouses
  for each row execute function public.set_audit_fields();

create table public.warehouse_zones (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  code text not null,
  name text not null,
  storage_type public.storage_type not null,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  constraint warehouse_zones_code_check check (public.is_stock_place_code(code, 20)),
  constraint warehouse_zones_name_check
    check (public.is_trimmed_text(name, 50) and name is nfc normalized),
  constraint warehouse_zones_note_check
    check (note is null or public.is_trimmed_text(note, 500))
);

-- 구역코드 is unique within its 창고, ignoring case.
create unique index warehouse_zones_code_lower_key
  on public.warehouse_zones (warehouse_id, lower(code));

comment on table public.warehouse_zones is '창고의 구역. 구역마다 보관온도(상온/냉장/냉동)가 있고, 상품의 보관온도와 다르면 화면에 경고합니다. 만들면 ‘기본’ 위치가 자동으로 생깁니다.';
comment on column public.warehouse_zones.id is '구역 고유 ID (자동 생성)';
comment on column public.warehouse_zones.warehouse_id is '창고 ID (바꿀 수 없음)';
comment on column public.warehouse_zones.code is '구역코드 (창고 안에서 중복 불가, 1~20자)';
comment on column public.warehouse_zones.name is '구역명 (1~50자, 예: 냉장 A구역)';
comment on column public.warehouse_zones.storage_type is '구역의 보관온도 (상온/냉장/냉동)';
comment on column public.warehouse_zones.note is '메모 (500자 이하)';
comment on column public.warehouse_zones.is_active is '사용 여부. 사용중지된 구역에는 재고를 새로 넣을 수 없습니다';
comment on column public.warehouse_zones.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.warehouse_zones.created_at is '등록 일시';
comment on column public.warehouse_zones.updated_at is '마지막 수정 일시';
comment on column public.warehouse_zones.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.warehouse_zones.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger warehouse_zones_set_audit_fields
  before insert or update on public.warehouse_zones
  for each row execute function public.set_audit_fields();

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.warehouse_zones (id) on delete cascade,
  code text not null,
  name text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  constraint storage_locations_code_check check (public.is_stock_place_code(code, 30)),
  constraint storage_locations_name_check
    check (name is null or (public.is_trimmed_text(name, 50) and name is nfc normalized))
);

-- 위치코드 is unique within its 구역, ignoring case.
create unique index storage_locations_code_lower_key
  on public.storage_locations (zone_id, lower(code));
-- Exactly one 기본 위치 per 구역: at most one here; at least one because it
-- is created with the 구역 and can never be deleted or lose the mark.
create unique index storage_locations_one_default_key
  on public.storage_locations (zone_id)
  where is_default;

comment on table public.storage_locations is '구역 안의 위치(선반, 로케이션). 구역마다 ‘기본’ 위치가 1개 있습니다 (자동 생성, 삭제 불가). 재고는 로트 × 위치마다 따로 셉니다.';
comment on column public.storage_locations.id is '위치 고유 ID (자동 생성)';
comment on column public.storage_locations.zone_id is '구역 ID (바꿀 수 없음)';
comment on column public.storage_locations.code is '위치코드 (구역 안에서 중복 불가, 1~30자, 예: B-02-R02)';
comment on column public.storage_locations.name is '위치 이름 (선택, 50자 이하)';
comment on column public.storage_locations.is_default is '구역의 기본 위치 여부 (구역마다 1개, 바꿀 수 없음). 기초재고 일괄등록에서 선반코드를 비우면 여기에 넣습니다';
comment on column public.storage_locations.is_active is '사용 여부. 사용중지된 위치에는 재고를 새로 넣을 수 없습니다 (있는 재고는 꺼낼 수 있음)';
comment on column public.storage_locations.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.storage_locations.created_at is '등록 일시';
comment on column public.storage_locations.updated_at is '마지막 수정 일시';
comment on column public.storage_locations.created_by is '등록한 사용자 (auth.users의 ID)';
comment on column public.storage_locations.updated_by is '마지막으로 수정한 사용자 (auth.users의 ID)';

create trigger storage_locations_set_audit_fields
  before insert or update on public.storage_locations
  for each row execute function public.set_audit_fields();

-- A new 구역 gets its "기본" 위치 right away (same statement).
create function public.create_default_storage_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.storage_locations (zone_id, code, name, is_default, sort_order)
  values (new.id, '기본', '기본 위치', true, 0);
  return null;
end;
$$;

comment on function public.create_default_storage_location() is '새 구역에 ‘기본’ 위치를 자동으로 만듭니다.';

create trigger warehouse_zones_create_default_location
  after insert on public.warehouse_zones
  for each row execute function public.create_default_storage_location();

-- A 구역 never moves to another 창고, a 위치 never moves to another 구역
-- and keeps its 기본 mark (the stock history would change its meaning).
-- The 기본 위치 is deleted only together with its 구역.
create function public.protect_stock_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'warehouse_zones' then
    if new.warehouse_id <> old.warehouse_id then
      raise exception '구역은 다른 창고로 옮길 수 없습니다. 새 구역을 만들어 재고를 이동해 주세요.'
        using errcode = 'check_violation', hint = 'stock_place_move_refused';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- While its 구역 exists (it is not being deleted with it).
    if old.is_default and exists (
      select 1 from public.warehouse_zones as zone where zone.id = old.zone_id
    ) then
      raise exception '기본 위치는 삭제할 수 없습니다. 구역에는 위치가 하나 이상 있어야 합니다. 쓰지 않으려면 사용중지로 바꿔 주세요.'
        using errcode = 'check_violation', hint = 'stock_location_default_fixed';
    end if;
    return old;
  end if;

  if new.zone_id <> old.zone_id then
    raise exception '위치는 다른 구역으로 옮길 수 없습니다. 새 위치를 만들어 재고를 이동해 주세요.'
      using errcode = 'check_violation', hint = 'stock_place_move_refused';
  end if;
  if new.is_default <> old.is_default then
    raise exception '기본 위치 표시는 바꿀 수 없습니다.'
      using errcode = 'check_violation', hint = 'stock_location_default_fixed';
  end if;
  return new;
end;
$$;

comment on function public.protect_stock_place() is '구역·위치가 다른 창고·구역으로 옮겨지거나 기본 위치가 지워지지 않게 막습니다.';

create trigger warehouse_zones_protect
  before update on public.warehouse_zones
  for each row execute function public.protect_stock_place();

create trigger storage_locations_protect
  before update or delete on public.storage_locations
  for each row execute function public.protect_stock_place();

-- -----------------------------------------------------------------------------
-- 5. The stock tables
-- -----------------------------------------------------------------------------

-- 5a. stock_documents: 전표 (header)
create table public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type public.stock_document_type not null,
  doc_no text not null,
  doc_date date not null,
  partner_id uuid references public.partners (id) on delete restrict,
  memo text,
  reverses_id uuid references public.stock_documents (id) on delete restrict,
  reversed_by_id uuid references public.stock_documents (id) on delete restrict,
  reversed_at timestamptz,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),

  constraint stock_documents_doc_no_key unique (doc_no),
  -- A 전표 is undone at most once, by one 취소 전표.
  constraint stock_documents_reverses_id_key unique (reverses_id),
  constraint stock_documents_reversed_by_id_key unique (reversed_by_id),
  -- The same save sent twice (e.g. a retry after a network error) is
  -- saved once (see find_stock_request).
  constraint stock_documents_request_id_key unique (request_id),
  -- Only a 취소 전표 points to the 전표 it undoes.
  constraint stock_documents_reverses_check
    check ((doc_type = 'reversal') = (reverses_id is not null)),
  constraint stock_documents_reversed_check
    check ((reversed_by_id is null) = (reversed_at is null)),
  constraint stock_documents_doc_date_check
    check (doc_date is not null and doc_date >= date '2000-01-01'),
  constraint stock_documents_memo_check
    check (memo is null or public.is_trimmed_text(memo, 500))
);

create index stock_documents_doc_date_idx on public.stock_documents (doc_date desc, created_at desc);
create index stock_documents_doc_type_idx on public.stock_documents (doc_type, doc_date desc);
create index stock_documents_partner_id_idx on public.stock_documents (partner_id);

comment on table public.stock_documents is '재고 전표 (기초재고, 입고, 출고, 폐기, 이동, 실사조정, 취소). 저장한 뒤에는 고치거나 지울 수 없고, 잘못된 전표는 취소 전표로 되돌립니다.';
comment on column public.stock_documents.id is '전표 고유 ID (자동 생성)';
comment on column public.stock_documents.doc_type is '전표 종류 (opening 기초재고, receipt 입고, issue 출고, disposal 폐기, transfer 이동, count 실사조정, reversal 취소)';
comment on column public.stock_documents.doc_no is '전표번호 (자동: 종류-전표일자-일련번호, 예: 입고-20261023-001)';
comment on column public.stock_documents.doc_date is '전표 일자 (한국 날짜, 지난 날짜 가능, 미래 불가)';
comment on column public.stock_documents.partner_id is '거래처 ID (입고: 매입처, 출고: 거래처, 그 외 비어 있음)';
comment on column public.stock_documents.memo is '메모·사유 (500자 이하)';
comment on column public.stock_documents.reverses_id is '취소 전표가 되돌리는 원래 전표 ID (취소 전표만)';
comment on column public.stock_documents.reversed_by_id is '이 전표를 되돌린 취소 전표 ID (취소된 전표만)';
comment on column public.stock_documents.reversed_at is '취소된 일시';
comment on column public.stock_documents.request_id is '저장 요청 번호 (같은 저장 요청이 두 번 와도 한 번만 저장)';
comment on column public.stock_documents.created_at is '등록 일시';
comment on column public.stock_documents.updated_at is '마지막 수정 일시 (취소 표시가 붙을 때만 바뀜)';
comment on column public.stock_documents.created_by is '등록한 사용자 (auth.users의 ID)';

-- 5b. stock_lots: 로트 (one 기준상품 received once)
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  lot_no text not null,
  supplier_lot_no text,
  expiry_kind public.expiry_kind not null,
  expiry_date date,
  manufactured_date date,
  received_date date not null,
  unit_cost_incl_vat bigint,
  supplier_id uuid references public.partners (id) on delete restrict,
  origin text,
  memo text,
  created_document_id uuid not null references public.stock_documents (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),

  -- Limits: STOCK_LIMITS in src/lib/inventory/constants.ts.
  constraint stock_lots_lot_no_check
    check (public.is_trimmed_text(lot_no, 40) and lot_no is nfc normalized),
  constraint stock_lots_supplier_lot_no_check
    check (supplier_lot_no is null or public.is_trimmed_text(supplier_lot_no, 40)),
  -- 기한 없음 ⇔ no 기한일.
  constraint stock_lots_expiry_check
    check (
      (expiry_kind = 'none' and expiry_date is null)
      or (expiry_kind <> 'none' and expiry_date is not null)
    ),
  constraint stock_lots_manufactured_date_check
    check (
      manufactured_date is null
      or (
        manufactured_date <= received_date
        and (expiry_date is null or manufactured_date <= expiry_date)
      )
    ),
  constraint stock_lots_unit_cost_check
    check (
      unit_cost_incl_vat is null
      or (unit_cost_incl_vat >= 0 and unit_cost_incl_vat <= 10000000000)
    ),
  constraint stock_lots_origin_check
    check (origin is null or public.is_trimmed_text(origin, 100)),
  constraint stock_lots_memo_check
    check (memo is null or public.is_trimmed_text(memo, 500))
);

-- 로트번호 is unique per 상품, ignoring case.
create unique index stock_lots_product_lot_no_key on public.stock_lots (product_id, lower(lot_no));
create index stock_lots_expiry_date_idx on public.stock_lots (expiry_date);
create index stock_lots_supplier_id_idx on public.stock_lots (supplier_id);
create index stock_lots_created_document_id_idx on public.stock_lots (created_document_id);

comment on table public.stock_lots is '로트: 한 번 입고된 기준상품 묶음 (기한 종류·기한일·제조일자·입고일·입고 단가). 위치별 수량은 stock_balances에 있습니다. 저장한 뒤에는 바뀌지 않습니다.';
comment on column public.stock_lots.id is '로트 고유 ID (자동 생성)';
comment on column public.stock_lots.product_id is '기준상품 ID (묶음상품에는 재고가 없음)';
comment on column public.stock_lots.lot_no is '로트번호 (직접 입력 또는 자동 L+등록일-일련번호, 상품마다 중복 불가)';
comment on column public.stock_lots.supplier_lot_no is '공급처(제조사) 로트번호 (선택, 회수(리콜) 조회용)';
comment on column public.stock_lots.expiry_kind is '기한 종류 (use_by 소비기한, sell_by 유통기한, none 없음)';
comment on column public.stock_lots.expiry_date is '소비기한 또는 유통기한 날짜 (기한 없음이면 비어 있음)';
comment on column public.stock_lots.manufactured_date is '제조일자 (선택)';
comment on column public.stock_lots.received_date is '입고일 (FEFO에서 기한이 같으면 먼저 입고된 로트부터)';
comment on column public.stock_lots.unit_cost_incl_vat is '입고 단가 (원, 부가세 포함, 비어 있으면 상품의 기본 매입가로 재고금액 추정)';
comment on column public.stock_lots.supplier_id is '매입처 ID (거래처)';
comment on column public.stock_lots.origin is '로트의 원산지 (선택, 비어 있으면 상품의 원산지)';
comment on column public.stock_lots.memo is '메모';
comment on column public.stock_lots.created_document_id is '이 로트를 만든 전표 ID (입고·기초재고·실사조정)';
comment on column public.stock_lots.created_at is '등록 일시';
comment on column public.stock_lots.created_by is '등록한 사용자 (auth.users의 ID)';

-- 5c. stock_movements: 전표의 줄 (append-only)
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  document_id uuid not null references public.stock_documents (id) on delete restrict,
  line_no integer not null,
  lot_id uuid not null references public.stock_lots (id) on delete restrict,
  location_id uuid not null references public.storage_locations (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  doc_date date not null,
  movement_type public.stock_document_type not null,
  is_reversal boolean not null default false,
  quantity_delta numeric(14, 3) not null,
  unit_cost_incl_vat bigint,
  reason public.disposal_reason,
  memo text,
  bundle_id uuid references public.products (id) on delete restrict,
  bundle_quantity numeric(14, 3),
  bundle_unit_cost_incl_vat bigint,
  reverses_movement_id uuid references public.stock_movements (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint stock_movements_seq_key unique (seq),
  -- Each line is undone at most once.
  constraint stock_movements_reverses_movement_id_key unique (reverses_movement_id),
  constraint stock_movements_quantity_delta_check
    check (quantity_delta is not null and quantity_delta <> 0),
  constraint stock_movements_line_no_check
    check (line_no is not null and line_no between 1 and 100000),
  -- A 취소 line is the opposite of exactly one earlier line.
  constraint stock_movements_reversal_check
    check (is_reversal = (reverses_movement_id is not null)),
  -- 폐기 lines (and their 취소) have a reason; no other line does.
  constraint stock_movements_reason_check
    check ((movement_type = 'disposal') = (reason is not null)),
  -- A 묶음상품 line keeps the 묶음상품, its quantity and (입고) the 단가
  -- typed per 묶음상품.
  constraint stock_movements_bundle_check
    check (
      (bundle_id is null and bundle_quantity is null and bundle_unit_cost_incl_vat is null)
      or (
        bundle_id is not null and bundle_quantity is not null and bundle_quantity > 0
        and (
          bundle_unit_cost_incl_vat is null
          or (bundle_unit_cost_incl_vat >= 0 and bundle_unit_cost_incl_vat <= 10000000000)
        )
      )
    ),
  constraint stock_movements_memo_check
    check (memo is null or public.is_trimmed_text(memo, 500))
);

create index stock_movements_document_id_idx on public.stock_movements (document_id, line_no, seq);
create index stock_movements_lot_location_idx on public.stock_movements (lot_id, location_id, doc_date, seq);
create index stock_movements_product_date_idx on public.stock_movements (product_id, doc_date, seq);
create index stock_movements_location_id_idx on public.stock_movements (location_id);
create index stock_movements_bundle_id_idx on public.stock_movements (bundle_id) where bundle_id is not null;

comment on table public.stock_movements is '재고 원장: 전표의 줄 (로트 × 위치 × 수량 증감). 추가만 할 수 있고 고치거나 지울 수 없습니다. stock_balances는 이 줄들의 합계입니다.';
comment on column public.stock_movements.id is '줄 고유 ID (자동 생성)';
comment on column public.stock_movements.seq is '저장 순서 번호 (자동). 같은 날짜 안에서 수불 순서';
comment on column public.stock_movements.document_id is '전표 ID';
comment on column public.stock_movements.line_no is '전표 화면의 줄 번호 (1부터). 묶음상품·FEFO로 나뉜 줄은 같은 번호';
comment on column public.stock_movements.lot_id is '로트 ID';
comment on column public.stock_movements.location_id is '위치 ID';
comment on column public.stock_movements.product_id is '기준상품 ID (로트의 상품, 자동)';
comment on column public.stock_movements.doc_date is '전표 일자 (전표에서 자동)';
comment on column public.stock_movements.movement_type is '수불 구분 (전표 종류, 취소 줄은 원래 전표의 종류)';
comment on column public.stock_movements.is_reversal is '취소 줄 여부 (원래 줄의 반대 수량)';
comment on column public.stock_movements.quantity_delta is '수량 증감 (+ 들어옴, - 나감, 상품의 단위, 소수점 3자리)';
comment on column public.stock_movements.unit_cost_incl_vat is '로트의 입고 단가 (원, 부가세 포함, 자동)';
comment on column public.stock_movements.reason is '폐기 사유 (폐기 줄만)';
comment on column public.stock_movements.memo is '줄 메모';
comment on column public.stock_movements.bundle_id is '묶음상품으로 입고·출고한 줄이면 그 묶음상품 ID';
comment on column public.stock_movements.bundle_quantity is '묶음상품 수량 (묶음상품 줄만, 묶음상품의 단위)';
comment on column public.stock_movements.bundle_unit_cost_incl_vat is '입고 때 입력한 묶음상품 1개의 단가 (원, 부가세 포함; 묶음상품 입고 줄만). 전표 금액은 이 값 × 묶음상품 수량 (기준상품 로트의 단가는 원 단위로 나눈 값이라 합계가 조금 다를 수 있음)';
comment on column public.stock_movements.reverses_movement_id is '취소 줄이 되돌리는 원래 줄 ID';
comment on column public.stock_movements.created_at is '등록 일시';

-- 5d. stock_balances: current quantity per (lot, location)
create table public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.stock_lots (id) on delete restrict,
  location_id uuid not null references public.storage_locations (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_balances_lot_location_key unique (lot_id, location_id),
  -- No negative stock, ever.
  constraint stock_balances_quantity_check check (quantity is not null and quantity >= 0)
);

create index stock_balances_product_id_idx on public.stock_balances (product_id) where quantity > 0;
create index stock_balances_location_id_idx on public.stock_balances (location_id);

comment on table public.stock_balances is '현재 재고: 로트 × 위치별 수량 (0 이상). 전표 줄(stock_movements)이 저장될 때만 자동으로 바뀌며 직접 고칠 수 없습니다.';
comment on column public.stock_balances.id is '고유 ID (자동 생성)';
comment on column public.stock_balances.lot_id is '로트 ID';
comment on column public.stock_balances.location_id is '위치 ID';
comment on column public.stock_balances.product_id is '기준상품 ID (로트의 상품)';
comment on column public.stock_balances.quantity is '현재 수량 (0 이상, 상품의 단위)';
comment on column public.stock_balances.created_at is '처음 들어온 일시';
comment on column public.stock_balances.updated_at is '마지막으로 바뀐 일시';

-- 5e. stock_number_counters: the last number of each prefix and day
create table public.stock_number_counters (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  last_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_number_counters_scope_key unique (scope),
  constraint stock_number_counters_last_number_check
    check (last_number is not null and last_number >= 1)
);

comment on table public.stock_number_counters is '전표번호·로트번호의 일련번호 (종류와 날짜마다 마지막 번호). 재고 저장 함수만 씁니다.';
comment on column public.stock_number_counters.id is '고유 ID (자동 생성)';
comment on column public.stock_number_counters.scope is '번호 종류와 날짜 (예: doc:receipt:20261023, lot:20261023)';
comment on column public.stock_number_counters.last_number is '마지막으로 준 번호';
comment on column public.stock_number_counters.created_at is '등록 일시';
comment on column public.stock_number_counters.updated_at is '마지막으로 번호를 준 일시';

-- 5f. Triggers of the stock tables

-- Refuses changing or deleting rows of the stock ledger (also TRUNCATE).
create function public.refuse_stock_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '재고 기록(전표, 로트, 원장)은 고치거나 지울 수 없습니다. 잘못 등록한 전표는 [취소]로 되돌린 뒤 다시 등록해 주세요.'
    using errcode = 'integrity_constraint_violation', hint = 'stock_ledger_append_only';
end;
$$;

comment on function public.refuse_stock_ledger_change() is '재고 원장(전표·로트·줄)의 수정·삭제를 막습니다 (추가만 가능).';

-- stock_documents: who/when on insert; afterwards only the 취소 mark may be
-- added, once (by reverse_stock_document).
create function public.prepare_stock_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := auth.uid();
    new.reversed_by_id := null;
    new.reversed_at := null;
    return new;
  end if;

  if old.reversed_by_id is null
    and new.reversed_by_id is not null
    and new.id = old.id
    and new.doc_type = old.doc_type
    and new.doc_no = old.doc_no
    and new.doc_date = old.doc_date
    and new.partner_id is not distinct from old.partner_id
    and new.memo is not distinct from old.memo
    and new.reverses_id is not distinct from old.reverses_id
    and new.request_id is not distinct from old.request_id
    and new.created_at = old.created_at
    and new.created_by is not distinct from old.created_by then
    new.reversed_at := now();
    new.updated_at := now();
    return new;
  end if;

  raise exception '재고 기록(전표, 로트, 원장)은 고치거나 지울 수 없습니다. 잘못 등록한 전표는 [취소]로 되돌린 뒤 다시 등록해 주세요.'
    using errcode = 'integrity_constraint_violation', hint = 'stock_ledger_append_only';
end;
$$;

comment on function public.prepare_stock_document() is '전표의 등록자·일시를 채우고, 저장된 전표는 취소 표시 외에는 바꾸지 못하게 합니다.';

create trigger stock_documents_prepare
  before insert or update on public.stock_documents
  for each row execute function public.prepare_stock_document();

create trigger stock_documents_refuse_delete
  before delete on public.stock_documents
  for each row execute function public.refuse_stock_ledger_change();

create trigger stock_documents_refuse_truncate
  before truncate on public.stock_documents
  for each statement execute function public.refuse_stock_ledger_change();

-- "A 전표 has at least one line", checked when the transaction ends (the
-- save functions add the header first, then its lines).
create function public.check_stock_document_has_movements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stock_movements as movement where movement.document_id = new.id
  ) then
    raise exception '줄이 없는 전표는 저장할 수 없습니다.'
      using errcode = 'check_violation', hint = 'stock_lines_empty';
  end if;
  return null;
end;
$$;

comment on function public.check_stock_document_has_movements() is '전표에 줄이 1개 이상 있는지 확인합니다 (트랜잭션이 끝날 때 검사).';

create constraint trigger stock_documents_has_movements
  after insert on public.stock_documents
  deferrable initially deferred
  for each row execute function public.check_stock_document_has_movements();

-- stock_lots: only 기준상품; a 매입처 must be a 매입처 or 매출·매입
-- 거래처; who/when filled in.
create function public.prepare_stock_lot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found_product_type public.product_type;
  found_partner_type public.partner_type;
begin
  select product.product_type into found_product_type
  from public.products as product
  where product.id = new.product_id;
  if not found then
    raise exception '상품을 찾을 수 없습니다. 상품을 다시 선택해 주세요.'
      using errcode = 'foreign_key_violation', hint = 'stock_product_not_found';
  end if;
  if found_product_type <> 'base' then
    raise exception '재고는 기준상품에만 있습니다. 묶음상품은 구성 기준상품으로 나눠서 입고됩니다.'
      using errcode = 'check_violation', hint = 'stock_product_not_base';
  end if;

  if new.supplier_id is not null then
    select partner.partner_type into found_partner_type
    from public.partners as partner
    where partner.id = new.supplier_id;
    if not found then
      raise exception '매입처를 찾을 수 없습니다. 매입처를 다시 선택해 주세요.'
        using errcode = 'foreign_key_violation', hint = 'stock_partner_not_found';
    end if;
    if found_partner_type not in ('purchase', 'both') then
      raise exception '입고의 거래처는 매입처(또는 매출·매입) 거래처만 고를 수 있습니다.'
        using errcode = 'check_violation', hint = 'stock_partner_not_supplier';
    end if;
  end if;

  new.created_at := now();
  new.created_by := auth.uid();
  return new;
end;
$$;

comment on function public.prepare_stock_lot() is '로트를 저장하기 전에 기준상품인지, 매입처가 맞는지 확인하고 등록자·일시를 채웁니다.';

create trigger stock_lots_prepare
  before insert on public.stock_lots
  for each row execute function public.prepare_stock_lot();

create trigger stock_lots_refuse_change
  before update or delete on public.stock_lots
  for each row execute function public.refuse_stock_ledger_change();

create trigger stock_lots_refuse_truncate
  before truncate on public.stock_lots
  for each statement execute function public.refuse_stock_ledger_change();

-- stock_movements, before insert: the columns that come from the lot and
-- the 전표 are filled in here (whatever was sent): product, 입고 단가,
-- 전표 일자, 수불 구분 (a 취소 line counts as the original 전표's kind).
-- A lot cannot move before its 입고일.
create function public.prepare_stock_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lot_row record;
  document_row record;
  original_type public.stock_document_type;
begin
  select lot.product_id, lot.unit_cost_incl_vat, lot.received_date, lot.lot_no
  into lot_row
  from public.stock_lots as lot
  where lot.id = new.lot_id;
  if not found then
    raise exception '로트를 찾을 수 없습니다.'
      using errcode = 'foreign_key_violation', hint = 'stock_lot_not_found';
  end if;

  select document.doc_type, document.doc_date, document.reverses_id
  into document_row
  from public.stock_documents as document
  where document.id = new.document_id;
  if not found then
    raise exception '전표를 찾을 수 없습니다.'
      using errcode = 'foreign_key_violation', hint = 'stock_document_not_found';
  end if;

  if document_row.doc_type = 'reversal' then
    select original.doc_type into original_type
    from public.stock_documents as original
    where original.id = document_row.reverses_id;
    new.movement_type := original_type;
    new.is_reversal := true;
  else
    new.movement_type := document_row.doc_type;
    new.is_reversal := false;
  end if;

  new.product_id := lot_row.product_id;
  new.unit_cost_incl_vat := lot_row.unit_cost_incl_vat;
  new.doc_date := document_row.doc_date;
  new.created_at := now();

  if new.doc_date < lot_row.received_date then
    raise exception '로트 %의 입고일(%)보다 앞선 날짜로 재고를 움직일 수 없습니다. 전표 일자를 확인해 주세요.',
      lot_row.lot_no, lot_row.received_date
      using errcode = 'check_violation', hint = 'stock_date_before_receipt';
  end if;
  return new;
end;
$$;

comment on function public.prepare_stock_movement() is '전표 줄을 저장하기 전에 상품·단가·전표 일자·수불 구분을 로트와 전표에서 채웁니다.';

create trigger stock_movements_prepare
  before insert on public.stock_movements
  for each row execute function public.prepare_stock_movement();

-- stock_movements, after insert: adds the quantity to stock_balances. A
-- balance below 0 is refused by stock_balances_quantity_check.
-- Stock coming in may start a new (lot, location) row; stock going out
-- changes the existing row. (An "insert … on conflict do update" with a
-- negative quantity would be refused by the CHECK before the conflict is
-- seen, so the two cases are written separately.)
create function public.apply_stock_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity_delta > 0 then
    insert into public.stock_balances as balance (lot_id, location_id, product_id, quantity)
    values (new.lot_id, new.location_id, new.product_id, new.quantity_delta)
    on conflict (lot_id, location_id) do update
      set quantity = balance.quantity + excluded.quantity;
  else
    update public.stock_balances as balance
    set quantity = balance.quantity + new.quantity_delta
    where balance.lot_id = new.lot_id
      and balance.location_id = new.location_id;
    if not found then
      raise exception '꺼낼 재고가 없습니다 (이 로트는 이 위치에 재고가 없습니다).'
        using errcode = 'check_violation', hint = 'stock_insufficient';
    end if;
  end if;
  return null;
end;
$$;

comment on function public.apply_stock_movement() is '전표 줄의 수량을 현재 재고(stock_balances)에 더합니다.';

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create trigger stock_movements_refuse_change
  before update or delete on public.stock_movements
  for each row execute function public.refuse_stock_ledger_change();

create trigger stock_movements_refuse_truncate
  before truncate on public.stock_movements
  for each statement execute function public.refuse_stock_ledger_change();

-- stock_balances: changed only by apply_stock_movement (a trigger inside a
-- trigger: depth 2). A direct insert, update or delete is refused, so the
-- balances always equal the sum of the lines.
create function public.protect_stock_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or pg_trigger_depth() < 2 then
    raise exception '재고 수량은 직접 고칠 수 없습니다. 입고·출고·폐기·이동·실사조정 전표로만 바뀝니다.'
      using errcode = 'integrity_constraint_violation', hint = 'stock_ledger_append_only';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.id := old.id;
    new.lot_id := old.lot_id;
    new.location_id := old.location_id;
    new.product_id := old.product_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.protect_stock_balance() is '현재 재고(stock_balances)는 전표 줄이 저장될 때만 바뀌게 합니다.';

create trigger stock_balances_protect
  before insert or update or delete on public.stock_balances
  for each row execute function public.protect_stock_balance();

create trigger stock_balances_refuse_truncate
  before truncate on public.stock_balances
  for each statement execute function public.refuse_stock_ledger_change();

-- products: the 단위 of a product with stock records never changes. Every
-- quantity of its lots, lines and balances (and a 묶음상품's
-- bundle_quantity on 입고/출고 lines) is counted in that 단위 and no unit
-- is stored next to them, so changing it would silently change the meaning
-- of the whole history (12.5 kg → 12.5 박스). The save functions lock the
-- product row (FOR SHARE, stock_receive_line) while they make its lots,
-- so a 단위 change at the same moment waits and then sees the new lot.
create function public.check_product_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit is distinct from old.unit
    and (
      exists (select 1 from public.stock_lots as lot where lot.product_id = old.id)
      or exists (
        select 1 from public.stock_movements as movement where movement.bundle_id = old.id
      )
    ) then
    raise exception '재고 기록이 있는 상품은 단위를 바꿀 수 없습니다. 재고 수량과 수불이 모두 ‘%’ 단위로 기록되어 있습니다. 다른 단위로 관리하려면 새 상품을 등록해 주세요.', old.unit
      using errcode = 'check_violation', hint = 'product_unit_has_stock';
  end if;
  return new;
end;
$$;

comment on function public.check_product_unit_change() is '재고 기록(로트, 묶음상품 입출고 줄)이 있는 상품의 단위를 바꾸지 못하게 합니다 (수량의 뜻이 바뀌므로).';

create trigger products_keep_unit_with_stock
  before update of unit on public.products
  for each row execute function public.check_product_unit_change();

-- -----------------------------------------------------------------------------
-- 6. Row Level Security and privileges of the tables
-- Every signed-in employee (authenticated) reads everything. 창고·구역·위치
-- and the settings are changed directly; the stock tables only through the
-- save functions (no INSERT/UPDATE/DELETE privilege at all). Visitors who
-- are not signed in (anon) get nothing.
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_zones enable row level security;
alter table public.storage_locations enable row level security;
alter table public.stock_documents enable row level security;
alter table public.stock_lots enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_number_counters enable row level security;

create policy "Employees can read app settings"
  on public.app_settings for select to authenticated
  using (true);
create policy "Employees can change app settings"
  on public.app_settings for update to authenticated
  using (true) with check (true);

create policy "Employees can read warehouses"
  on public.warehouses for select to authenticated
  using (true);
create policy "Employees can add warehouses"
  on public.warehouses for insert to authenticated
  with check (true);
create policy "Employees can change warehouses"
  on public.warehouses for update to authenticated
  using (true) with check (true);
create policy "Employees can delete warehouses"
  on public.warehouses for delete to authenticated
  using (true);

create policy "Employees can read warehouse zones"
  on public.warehouse_zones for select to authenticated
  using (true);
create policy "Employees can add warehouse zones"
  on public.warehouse_zones for insert to authenticated
  with check (true);
create policy "Employees can change warehouse zones"
  on public.warehouse_zones for update to authenticated
  using (true) with check (true);
create policy "Employees can delete warehouse zones"
  on public.warehouse_zones for delete to authenticated
  using (true);

create policy "Employees can read storage locations"
  on public.storage_locations for select to authenticated
  using (true);
create policy "Employees can add storage locations"
  on public.storage_locations for insert to authenticated
  with check (true);
create policy "Employees can change storage locations"
  on public.storage_locations for update to authenticated
  using (true) with check (true);
create policy "Employees can delete storage locations"
  on public.storage_locations for delete to authenticated
  using (true);

create policy "Employees can read stock documents"
  on public.stock_documents for select to authenticated
  using (true);
create policy "Employees can read stock lots"
  on public.stock_lots for select to authenticated
  using (true);
create policy "Employees can read stock movements"
  on public.stock_movements for select to authenticated
  using (true);
create policy "Employees can read stock balances"
  on public.stock_balances for select to authenticated
  using (true);
-- stock_number_counters: no policy for employees (only the save functions,
-- which run as the owner, use it).

revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.warehouses from anon, authenticated;
revoke all on table public.warehouse_zones from anon, authenticated;
revoke all on table public.storage_locations from anon, authenticated;
revoke all on table public.stock_documents from anon, authenticated;
revoke all on table public.stock_lots from anon, authenticated;
revoke all on table public.stock_movements from anon, authenticated;
revoke all on table public.stock_balances from anon, authenticated;
revoke all on table public.stock_number_counters from anon, authenticated;

grant select on table public.app_settings to authenticated;
grant update (expiry_warning_days) on table public.app_settings to authenticated;

grant select, insert, delete on table public.warehouses to authenticated;
grant update (code, name, postal_code, address, address_detail, note, is_active, sort_order)
  on table public.warehouses to authenticated;
grant select, insert, delete on table public.warehouse_zones to authenticated;
grant update (code, name, storage_type, note, is_active, sort_order)
  on table public.warehouse_zones to authenticated;
grant select, insert, delete on table public.storage_locations to authenticated;
grant update (code, name, is_active, sort_order)
  on table public.storage_locations to authenticated;

grant select on table public.stock_documents to authenticated;
grant select on table public.stock_lots to authenticated;
grant select on table public.stock_movements to authenticated;
grant select on table public.stock_balances to authenticated;

grant all on table public.app_settings to service_role;
grant all on table public.warehouses to service_role;
grant all on table public.warehouse_zones to service_role;
grant all on table public.storage_locations to service_role;
grant all on table public.stock_documents to service_role;
grant all on table public.stock_lots to service_role;
grant all on table public.stock_movements to service_role;
grant all on table public.stock_balances to service_role;
grant all on table public.stock_number_counters to service_role;

-- -----------------------------------------------------------------------------
-- 7. Views (security_invoker: they use the permissions of the employee
-- asking, exactly like the tables)
-- -----------------------------------------------------------------------------

-- lot_stock_items: the stock on hand, one row per (lot, location) with a
-- quantity above 0 (재고처별 재고현황, 폐기·이동 pickers, the dashboard).
-- - days_left = 기한일 − today (Korea); expiry_status: 'expired' (기한
--   경과: days_left < 0), 'imminent' (기한 임박: 0 ≤ days_left ≤ the
--   setting), 'ok', or 'none' (no 기한).
-- - storage_mismatch: the 구역's 보관온도 differs from the product's;
--   storage_too_warm: the 구역 is warmer than the product needs (e.g. a 냉장
--   product in a 상온 구역) — the dangerous case.
-- - effective_unit_cost_incl_vat: the lot's 입고 단가, or the product's 기본
--   매입가 when the lot has none (cost_estimated = true); value_incl_vat =
--   round(quantity × that cost); value_excl_vat = its 부가세 별도 amount by
--   the product's 과세구분 (vat_excluded_amount).
create view public.lot_stock_items
with (security_invoker = true)
as
select
  balance.id as balance_id,
  balance.lot_id,
  balance.location_id,
  balance.quantity,
  balance.updated_at as balance_updated_at,
  lot.product_id,
  lot.lot_no,
  lot.supplier_lot_no,
  lot.expiry_kind,
  lot.expiry_date,
  lot.manufactured_date,
  lot.received_date,
  lot.unit_cost_incl_vat,
  lot.supplier_id,
  supplier.code as supplier_code,
  supplier.name as supplier_name,
  lot.origin as lot_origin,
  lot.memo as lot_memo,
  lot.created_document_id,
  product.code as product_code,
  product.name as product_name,
  product.spec as product_spec,
  product.unit as product_unit,
  product.barcode as product_barcode,
  product.storage_type as product_storage_type,
  product.tax_type as product_tax_type,
  product.is_active as product_is_active,
  product.origin as product_origin,
  product.purchase_price_incl_vat as product_purchase_price_incl_vat,
  product.category_id,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id,
  location.code as location_code,
  location.name as location_name,
  location.is_default as location_is_default,
  location.is_active as location_is_active,
  location.sort_order as location_sort_order,
  zone.id as zone_id,
  zone.code as zone_code,
  zone.name as zone_name,
  zone.storage_type as zone_storage_type,
  zone.is_active as zone_is_active,
  zone.sort_order as zone_sort_order,
  warehouse.id as warehouse_id,
  warehouse.code as warehouse_code,
  warehouse.name as warehouse_name,
  warehouse.is_active as warehouse_is_active,
  warehouse.sort_order as warehouse_sort_order,
  lot.expiry_date - today.value as days_left,
  case
    when lot.expiry_date is null then 'none'
    when lot.expiry_date < today.value then 'expired'
    when lot.expiry_date - today.value <= settings.expiry_warning_days then 'imminent'
    else 'ok'
  end as expiry_status,
  zone.storage_type <> product.storage_type as storage_mismatch,
  zone.storage_type < product.storage_type as storage_too_warm,
  coalesce(lot.unit_cost_incl_vat, product.purchase_price_incl_vat) as effective_unit_cost_incl_vat,
  (lot.unit_cost_incl_vat is null and product.purchase_price_incl_vat is not null) as cost_estimated,
  round(balance.quantity * coalesce(lot.unit_cost_incl_vat, product.purchase_price_incl_vat))::bigint
    as value_incl_vat,
  public.vat_excluded_amount(
    round(balance.quantity * coalesce(lot.unit_cost_incl_vat, product.purchase_price_incl_vat))::bigint,
    product.tax_type = 'taxable'
  ) as value_excl_vat
from public.stock_balances as balance
join public.stock_lots as lot on lot.id = balance.lot_id
join public.products as product on product.id = lot.product_id
join public.storage_locations as location on location.id = balance.location_id
join public.warehouse_zones as zone on zone.id = location.zone_id
join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
left join public.partners as supplier on supplier.id = lot.supplier_id
left join public.product_categories as category on category.id = product.category_id
left join public.product_categories as parent_category on parent_category.id = category.parent_id
cross join (select public.stock_today() as value) as today
cross join public.app_settings as settings
where balance.quantity > 0;

comment on view public.lot_stock_items is '현재 재고 (로트 × 위치, 수량 0 초과): 상품·로트·위치 정보, 남은 일수, 기한 상태(expired 경과 / imminent 임박 / ok / none), 보관온도 불일치, 재고금액.';
comment on column public.lot_stock_items.days_left is '기한일까지 남은 일수 (오늘 = 0, 지났으면 음수, 기한 없음이면 비어 있음)';
comment on column public.lot_stock_items.expiry_status is '기한 상태: expired=기한 경과, imminent=기한 임박(설정한 일수 이하), ok=여유, none=기한 없음';
comment on column public.lot_stock_items.storage_mismatch is '구역의 보관온도가 상품의 보관온도와 다름';
comment on column public.lot_stock_items.storage_too_warm is '구역이 상품에 필요한 온도보다 따뜻함 (예: 냉장 상품이 상온 구역에) — 위험';
comment on column public.lot_stock_items.effective_unit_cost_incl_vat is '재고 단가 (로트의 입고 단가, 없으면 상품의 기본 매입가, 부가세 포함)';
comment on column public.lot_stock_items.cost_estimated is '입고 단가가 없어 기본 매입가로 추정한 금액인지';
comment on column public.lot_stock_items.value_incl_vat is '재고금액 (부가세 포함, 원) = 수량 × 재고 단가 (반올림)';
comment on column public.lot_stock_items.value_excl_vat is '재고금액 (부가세 별도, 원)';

-- product_stock_summary: one row per 기준상품 (also without stock): the
-- quantity on hand everywhere, lots, the nearest 기한, the quantities that
-- are 기한 경과 / 기한 임박, the value.
create view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.code as product_code,
  product.name as product_name,
  product.spec as product_spec,
  product.unit as product_unit,
  product.barcode as product_barcode,
  product.storage_type as product_storage_type,
  product.tax_type as product_tax_type,
  product.is_active as product_is_active,
  product.purchase_price_incl_vat as product_purchase_price_incl_vat,
  product.shelf_life_days as product_shelf_life_days,
  product.category_id,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id,
  coalesce(stock.quantity, 0) as on_hand_quantity,
  coalesce(stock.quantity, 0) - coalesce(stock.expired_quantity, 0) as available_quantity,
  coalesce(stock.lot_count, 0) as lot_count,
  coalesce(stock.location_count, 0) as location_count,
  stock.nearest_expiry_date,
  stock.nearest_expiry_kind,
  coalesce(stock.expired_quantity, 0) as expired_quantity,
  coalesce(stock.imminent_quantity, 0) as imminent_quantity,
  coalesce(stock.mismatch_count, 0) as mismatch_count,
  case when stock.product_id is null then 0 else stock.value_incl_vat end as value_incl_vat,
  case when stock.product_id is null then 0 else stock.value_excl_vat end as value_excl_vat,
  coalesce(stock.cost_estimated, false) as cost_estimated,
  coalesce(stock.cost_missing, false) as cost_missing
from public.products as product
left join public.product_categories as category on category.id = product.category_id
left join public.product_categories as parent_category on parent_category.id = category.parent_id
left join (
  select
    item.product_id,
    sum(item.quantity) as quantity,
    count(distinct item.lot_id)::integer as lot_count,
    count(distinct item.location_id)::integer as location_count,
    min(item.expiry_date) as nearest_expiry_date,
    (array_agg(item.expiry_kind order by item.expiry_date) filter (where item.expiry_date is not null))[1]
      as nearest_expiry_kind,
    sum(item.quantity) filter (where item.expiry_status = 'expired') as expired_quantity,
    sum(item.quantity) filter (where item.expiry_status = 'imminent') as imminent_quantity,
    count(*) filter (where item.storage_mismatch)::integer as mismatch_count,
    sum(item.value_incl_vat) as value_incl_vat,
    sum(item.value_excl_vat) as value_excl_vat,
    bool_or(item.cost_estimated) as cost_estimated,
    bool_or(item.value_incl_vat is null) as cost_missing
  from public.lot_stock_items as item
  group by item.product_id
) as stock on stock.product_id = product.id
where product.product_type = 'base';

comment on view public.product_stock_summary is '기준상품별 현재 재고 요약 (재고 없는 상품도 포함): 수량, 로트 수, 가장 빠른 기한, 기한 경과·임박 수량, 재고금액.';
comment on column public.product_stock_summary.on_hand_quantity is '현재 재고 수량 (모든 위치 합계)';
comment on column public.product_stock_summary.available_quantity is '출고할 수 있는 수량 (현재 재고 - 기한 경과 수량)';
comment on column public.product_stock_summary.nearest_expiry_date is '재고가 있는 로트 중 가장 빠른 기한일';
comment on column public.product_stock_summary.expired_quantity is '기한 경과 수량';
comment on column public.product_stock_summary.imminent_quantity is '기한 임박 수량';
comment on column public.product_stock_summary.mismatch_count is '보관온도가 맞지 않는 구역에 있는 (로트 × 위치) 수';
comment on column public.product_stock_summary.value_incl_vat is '재고금액 (부가세 포함, 원). 단가를 아는 로트가 하나도 없으면 비어 있음';
comment on column public.product_stock_summary.value_excl_vat is '재고금액 (부가세 별도, 원)';
comment on column public.product_stock_summary.cost_estimated is '입고 단가가 없어 기본 매입가로 추정한 금액이 들어 있는지';
comment on column public.product_stock_summary.cost_missing is '입고 단가도 기본 매입가도 없어 금액을 알 수 없는 재고가 있는지';

-- storage_location_items: every 위치 with its 구역 and 창고, whether it can
-- take new stock (it, its 구역 and its 창고 are 사용), and its use (stock
-- now, ever used: then it can no longer be deleted).
create view public.storage_location_items
with (security_invoker = true)
as
select
  location.id as location_id,
  location.code as location_code,
  location.name as location_name,
  location.is_default as location_is_default,
  location.is_active as location_is_active,
  location.sort_order as location_sort_order,
  location.updated_at as location_updated_at,
  zone.id as zone_id,
  zone.code as zone_code,
  zone.name as zone_name,
  zone.storage_type as zone_storage_type,
  zone.is_active as zone_is_active,
  zone.sort_order as zone_sort_order,
  warehouse.id as warehouse_id,
  warehouse.code as warehouse_code,
  warehouse.name as warehouse_name,
  warehouse.is_active as warehouse_is_active,
  warehouse.sort_order as warehouse_sort_order,
  (location.is_active and zone.is_active and warehouse.is_active) as can_receive,
  coalesce(usage.stock_row_count, 0) as stock_row_count,
  coalesce(usage.stock_quantity_total, 0) as stock_quantity_total,
  (usage.location_id is not null) as is_used
from public.storage_locations as location
join public.warehouse_zones as zone on zone.id = location.zone_id
join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
left join (
  select
    balance.location_id,
    count(*) filter (where balance.quantity > 0)::integer as stock_row_count,
    coalesce(sum(balance.quantity), 0) as stock_quantity_total
  from public.stock_balances as balance
  group by balance.location_id
) as usage on usage.location_id = location.id;

comment on view public.storage_location_items is '위치 목록 (구역·창고 포함): 새 재고를 넣을 수 있는지(can_receive), 재고가 있는 로트 수, 사용한 적이 있는지(is_used: 있으면 삭제 불가).';
comment on column public.storage_location_items.location_updated_at is '위치를 마지막으로 수정한 일시 (수정 창이 열린 뒤 다른 직원이 바꿨는지 확인용)';
comment on column public.storage_location_items.can_receive is '위치·구역·창고가 모두 사용 중이라 새 재고를 넣을 수 있음';
comment on column public.storage_location_items.stock_row_count is '지금 재고가 있는 로트 수';
comment on column public.storage_location_items.stock_quantity_total is '지금 재고 수량 합계 (단위가 섞여 있을 수 있음, 0인지 확인용)';
comment on column public.storage_location_items.is_used is '재고를 넣은 적이 있음 (삭제할 수 없음)';

-- stock_document_list_items: 전표 목록. Every stock_documents column plus
-- the 거래처, the 취소 links, and a summary of the lines: 줄 수, 상품 수,
-- the first product (상품명 "외 N건"), the value in / out (부가세 포함,
-- quantity × lot cost), product_ids (filter "contains this product") and
-- search_text (상품코드·상품명·로트번호, for the search box).
-- effective_type: the kind of 전표, or for a 취소 전표 the kind it undoes.
create view public.stock_document_list_items
with (security_invoker = true)
as
select
  document.*,
  coalesce(original.doc_type, document.doc_type) as effective_type,
  partner.code as partner_code,
  partner.name as partner_name,
  partner.partner_type,
  original.doc_no as reverses_doc_no,
  original.doc_date as reverses_doc_date,
  reversal.doc_no as reversed_by_doc_no,
  reversal.doc_date as reversed_by_doc_date,
  coalesce(summary.line_count, 0) as line_count,
  coalesce(summary.movement_count, 0) as movement_count,
  coalesce(summary.product_count, 0) as product_count,
  summary.product_ids,
  summary.first_product_id,
  first_product.code as first_product_code,
  first_product.name as first_product_name,
  first_product.unit as first_product_unit,
  coalesce(amounts.value_in_incl_vat, 0) as value_in_incl_vat,
  coalesce(amounts.value_out_incl_vat, 0) as value_out_incl_vat,
  coalesce(summary.cost_unknown, false) as cost_unknown,
  summary.search_text
from public.stock_documents as document
left join public.partners as partner on partner.id = document.partner_id
left join public.stock_documents as original on original.id = document.reverses_id
left join public.stock_documents as reversal on reversal.id = document.reversed_by_id
left join lateral (
  select
    count(distinct movement.line_no)::integer as line_count,
    count(*)::integer as movement_count,
    count(distinct movement.product_id)::integer as product_count,
    array_agg(distinct movement.product_id) as product_ids,
    (array_agg(movement.product_id order by movement.line_no, movement.seq))[1] as first_product_id,
    bool_or(movement.unit_cost_incl_vat is null) as cost_unknown,
    string_agg(
      distinct concat_ws(' ', product.code, product.name, lot.lot_no, lot.supplier_lot_no, bundle.code, bundle.name),
      ' '
    ) as search_text
  from public.stock_movements as movement
  join public.products as product on product.id = movement.product_id
  join public.stock_lots as lot on lot.id = movement.lot_id
  left join public.products as bundle on bundle.id = movement.bundle_id
  where movement.document_id = document.id
) as summary on true
-- The value in / out: |quantity| × the lot's 단가 per line; a 묶음상품 입고
-- line with its typed 단가 counts once, as 묶음상품 수량 × that 단가 (the
-- lots' shares are rounded to whole won per 기준상품 unit, so their sum
-- would drift from what was typed).
left join lateral (
  select
    sum(part.amount) filter (where part.direction > 0)::bigint as value_in_incl_vat,
    sum(part.amount) filter (where part.direction < 0)::bigint as value_out_incl_vat
  from (
    select
      sign(movement.quantity_delta) as direction,
      round(abs(movement.quantity_delta) * movement.unit_cost_incl_vat) as amount
    from public.stock_movements as movement
    where movement.document_id = document.id
      and movement.bundle_unit_cost_incl_vat is null
    union all
    select
      sign(sum(movement.quantity_delta)) as direction,
      round(min(movement.bundle_quantity) * min(movement.bundle_unit_cost_incl_vat)) as amount
    from public.stock_movements as movement
    where movement.document_id = document.id
      and movement.bundle_unit_cost_incl_vat is not null
    group by movement.line_no, movement.bundle_id
  ) as part
) as amounts on true
left join public.products as first_product on first_product.id = summary.first_product_id;

comment on view public.stock_document_list_items is '재고 전표 목록: 전표 + 거래처, 취소 연결, 줄 요약(줄 수, 상품 수, 첫 상품, 들어온·나간 금액, 검색용 글자).';
comment on column public.stock_document_list_items.effective_type is '전표 종류 (취소 전표는 되돌린 원래 전표의 종류)';
comment on column public.stock_document_list_items.line_count is '화면의 줄 수';
comment on column public.stock_document_list_items.movement_count is '원장 줄 수 (묶음상품·FEFO로 나뉜 줄 포함)';
comment on column public.stock_document_list_items.product_count is '기준상품 종류 수';
comment on column public.stock_document_list_items.product_ids is '들어 있는 기준상품 ID 목록 (상품으로 전표 찾기)';
comment on column public.stock_document_list_items.first_product_name is '첫 줄의 상품명 (목록에 "외 N건"으로 표시)';
comment on column public.stock_document_list_items.value_in_incl_vat is '들어온 재고의 금액 (수량 × 로트 입고 단가, 묶음상품 입고 줄은 입력한 묶음 단가 × 묶음상품 수량, 부가세 포함, 단가 없는 로트 제외)';
comment on column public.stock_document_list_items.value_out_incl_vat is '나간 재고의 금액 (수량 × 로트 입고 단가, 묶음상품 입고의 취소 줄은 묶음 단가 × 묶음상품 수량, 부가세 포함, 단가 없는 로트 제외)';
comment on column public.stock_document_list_items.cost_unknown is '입고 단가가 없는 로트가 들어 있음';
comment on column public.stock_document_list_items.search_text is '검색용: 상품코드·상품명·로트번호·묶음상품';

-- stock_movement_items: the lines of the 전표 with their 전표, lot,
-- product, 묶음상품 and location (전표 상세, 수불).
create view public.stock_movement_items
with (security_invoker = true)
as
select
  movement.id,
  movement.seq,
  movement.document_id,
  movement.line_no,
  movement.lot_id,
  movement.location_id,
  movement.product_id,
  movement.doc_date,
  movement.movement_type,
  movement.is_reversal,
  movement.quantity_delta,
  movement.unit_cost_incl_vat,
  movement.reason,
  movement.memo,
  movement.bundle_id,
  movement.bundle_quantity,
  movement.bundle_unit_cost_incl_vat,
  movement.reverses_movement_id,
  movement.created_at,
  document.doc_no,
  document.doc_type,
  document.partner_id,
  partner.code as partner_code,
  partner.name as partner_name,
  lot.lot_no,
  lot.supplier_lot_no,
  lot.expiry_kind,
  lot.expiry_date,
  lot.manufactured_date,
  lot.received_date,
  product.code as product_code,
  product.name as product_name,
  product.spec as product_spec,
  product.unit as product_unit,
  product.storage_type as product_storage_type,
  product.tax_type as product_tax_type,
  bundle.code as bundle_code,
  bundle.name as bundle_name,
  bundle.unit as bundle_unit,
  location.code as location_code,
  location.name as location_name,
  zone.id as zone_id,
  zone.code as zone_code,
  zone.name as zone_name,
  zone.storage_type as zone_storage_type,
  warehouse.id as warehouse_id,
  warehouse.code as warehouse_code,
  warehouse.name as warehouse_name,
  round(abs(movement.quantity_delta) * movement.unit_cost_incl_vat)::bigint as amount_incl_vat,
  public.vat_excluded_amount(
    round(abs(movement.quantity_delta) * movement.unit_cost_incl_vat)::bigint,
    product.tax_type = 'taxable'
  ) as amount_excl_vat
from public.stock_movements as movement
join public.stock_documents as document on document.id = movement.document_id
left join public.partners as partner on partner.id = document.partner_id
join public.stock_lots as lot on lot.id = movement.lot_id
join public.products as product on product.id = movement.product_id
left join public.products as bundle on bundle.id = movement.bundle_id
join public.storage_locations as location on location.id = movement.location_id
join public.warehouse_zones as zone on zone.id = location.zone_id
join public.warehouses as warehouse on warehouse.id = zone.warehouse_id;

comment on view public.stock_movement_items is '재고 전표의 줄 (원장): 전표·로트·상품·묶음상품·위치 정보와 금액(수량 × 로트 입고 단가).';
comment on column public.stock_movement_items.amount_incl_vat is '금액 (|수량| × 로트 입고 단가, 부가세 포함, 단가 없으면 비어 있음)';
comment on column public.stock_movement_items.amount_excl_vat is '금액 (부가세 별도)';

revoke all on table public.lot_stock_items from anon, authenticated;
revoke all on table public.product_stock_summary from anon, authenticated;
revoke all on table public.storage_location_items from anon, authenticated;
revoke all on table public.stock_document_list_items from anon, authenticated;
revoke all on table public.stock_movement_items from anon, authenticated;
grant select on table public.lot_stock_items to authenticated, service_role;
grant select on table public.product_stock_summary to authenticated, service_role;
grant select on table public.storage_location_items to authenticated, service_role;
grant select on table public.stock_document_list_items to authenticated, service_role;
grant select on table public.stock_movement_items to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Helpers of the save functions
-- -----------------------------------------------------------------------------

-- The next number of a counter ("doc:receipt:20261023", "lot:20261023"):
-- 1, 2, 3 … The counter row stays locked until the transaction ends, so
-- two saves never get the same number (and a save that fails gives its
-- number back).
create function public.next_stock_number(counter_scope text)
returns integer
language sql
set search_path = ''
as $$
  insert into public.stock_number_counters as counter (scope, last_number)
  values (counter_scope, 1)
  on conflict (scope) do update
    set last_number = counter.last_number + 1,
      updated_at = now()
  returning counter.last_number
$$;

comment on function public.next_stock_number(text) is '전표·로트 번호의 다음 일련번호 (종류·날짜별, 동시에 저장해도 겹치지 않음).';

-- The same save sent again (same request_id): the 전표 it already made, as
-- the save functions return it; null when there is none.
create function public.find_stock_request(header jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  request uuid;
  existing record;
begin
  request := public.read_stock_uuid(header -> 'request_id', false, null, 'request_id', '저장 요청 번호');
  if request is null then
    return null;
  end if;
  -- The same request arriving twice at the same moment: the second waits
  -- here until the first is finished, then finds its 전표. (One lock per
  -- save, taken before any other lock, so it cannot deadlock.)
  perform pg_advisory_xact_lock(hashtextextended('stock_request:' || request::text, 0));
  select document.id, document.doc_no, document.doc_date, document.doc_type
  into existing
  from public.stock_documents as document
  where document.request_id = request;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'document_id', existing.id,
    'doc_no', existing.doc_no,
    'doc_date', existing.doc_date,
    'doc_type', existing.doc_type,
    'already_saved', true,
    'warnings', '[]'::jsonb
  );
end;
$$;

comment on function public.find_stock_request(jsonb) is '같은 저장 요청(request_id)으로 이미 만든 전표가 있으면 그 결과를 돌려줍니다 (두 번 저장 방지).';

-- Creates the 전표 header with its 전표번호 "<종류>-<YYYYMMDD>-<NNN>".
create function public.create_stock_document(
  document_type public.stock_document_type,
  document_date date,
  document_partner_id uuid,
  document_memo text,
  reversed_document_id uuid,
  header jsonb
)
returns public.stock_documents
language plpgsql
set search_path = ''
as $$
declare
  prefix text;
  date_text text := to_char(document_date, 'YYYYMMDD');
  created public.stock_documents;
begin
  prefix := case document_type
    when 'opening' then '기초'
    when 'receipt' then '입고'
    when 'issue' then '출고'
    when 'disposal' then '폐기'
    when 'transfer' then '이동'
    when 'count' then '실사'
    when 'reversal' then '취소'
  end;
  insert into public.stock_documents (
    doc_type, doc_no, doc_date, partner_id, memo, reverses_id, request_id
  )
  values (
    document_type,
    prefix || '-' || date_text || '-' || public.stock_number_text(
      public.next_stock_number('doc:' || document_type::text || ':' || date_text)
    ),
    document_date,
    document_partner_id,
    document_memo,
    reversed_document_id,
    public.read_stock_uuid(header -> 'request_id', false, null, 'request_id', '저장 요청 번호')
  )
  returning * into created;
  return created;
end;
$$;

comment on function public.create_stock_document(public.stock_document_type, date, uuid, text, uuid, jsonb) is '재고 전표 머리(전표번호 자동)를 만듭니다.';

-- Creates a lot. 로트번호: as typed (unique per 상품, ignoring case), or
-- automatic "L<YYYYMMDD>-<NNN>" with the 전표 date (skipping a number the
-- product already uses as a typed 로트번호).
create function public.create_stock_lot(
  lot_product_id uuid,
  typed_lot_no text,
  lot_supplier_lot_no text,
  lot_expiry_kind public.expiry_kind,
  lot_expiry_date date,
  lot_manufactured_date date,
  lot_received_date date,
  lot_unit_cost bigint,
  lot_supplier_id uuid,
  lot_origin text,
  lot_memo text,
  lot_document public.stock_documents,
  line_no integer,
  list text
)
returns public.stock_lots
language plpgsql
set search_path = ''
as $$
declare
  chosen_lot_no text := typed_lot_no;
  date_text text := to_char(lot_document.doc_date, 'YYYYMMDD');
  product_name text;
  created public.stock_lots;
begin
  if chosen_lot_no is not null then
    if exists (
      select 1 from public.stock_lots as lot
      where lot.product_id = lot_product_id and lower(lot.lot_no) = lower(chosen_lot_no)
    ) then
      select product.name into product_name from public.products as product where product.id = lot_product_id;
      perform public.raise_stock_error(
        format('‘%s’에 로트번호 ‘%s’이(가) 이미 있습니다. 다른 로트번호를 적거나 비워 두면 자동으로 붙입니다.', product_name, chosen_lot_no),
        'stock_lot_no_duplicate', line_no, 'lot_no', '23505', jsonb_build_object('list', list)
      );
    end if;
  else
    loop
      chosen_lot_no := 'L' || date_text || '-'
        || public.stock_number_text(public.next_stock_number('lot:' || date_text));
      exit when not exists (
        select 1 from public.stock_lots as lot
        where lot.product_id = lot_product_id and lower(lot.lot_no) = lower(chosen_lot_no)
      );
    end loop;
  end if;

  insert into public.stock_lots (
    product_id, lot_no, supplier_lot_no, expiry_kind, expiry_date,
    manufactured_date, received_date, unit_cost_incl_vat, supplier_id, origin,
    memo, created_document_id
  )
  values (
    lot_product_id, chosen_lot_no, lot_supplier_lot_no, lot_expiry_kind, lot_expiry_date,
    lot_manufactured_date, lot_received_date, lot_unit_cost, lot_supplier_id, lot_origin,
    lot_memo, lot_document.id
  )
  returning * into created;
  return created;
end;
$$;

comment on function public.create_stock_lot(uuid, text, text, public.expiry_kind, date, date, date, bigint, uuid, text, text, public.stock_documents, integer, text) is '로트를 만듭니다 (로트번호를 비우면 L+전표일자-일련번호 자동).';

-- Locks lots before their stock is changed: all at once, ordered by id, so
-- two saves on the same lots wait for each other instead of deadlocking.
create function public.lock_stock_lots(lot_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.stock_lots as lot
  where lot.id = any (lot_ids)
  order by lot.id
  for no key update;
end;
$$;

comment on function public.lock_stock_lots(uuid[]) is '재고를 바꾸기 전에 로트들을 ID 순서로 한꺼번에 잠급니다 (동시 저장 시 차례대로 처리, 교착 방지).';

-- Where a location is, and whether it may take new stock.
create function public.stock_location_info(target_location_id uuid)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  location_is_active boolean,
  zone_id uuid,
  zone_code text,
  zone_name text,
  zone_storage_type public.storage_type,
  zone_is_active boolean,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text,
  warehouse_is_active boolean,
  can_receive boolean,
  label text
)
language sql
stable
set search_path = ''
as $$
  select
    location.id,
    location.code,
    location.name,
    location.is_active,
    zone.id,
    zone.code,
    zone.name,
    zone.storage_type,
    zone.is_active,
    warehouse.id,
    warehouse.code,
    warehouse.name,
    warehouse.is_active,
    location.is_active and zone.is_active and warehouse.is_active,
    warehouse.name || ' > ' || zone.name || ' > ' || location.code
  from public.storage_locations as location
  join public.warehouse_zones as zone on zone.id = location.zone_id
  join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
  where location.id = target_location_id
$$;

comment on function public.stock_location_info(uuid) is '위치의 구역·창고 정보와 새 재고를 넣을 수 있는지 (위치·구역·창고 모두 사용 중).';

-- A location that takes new stock (입고, 이동 받는 곳, 실사 추가): it must
-- exist and be 사용 together with its 구역 and 창고.
create function public.check_stock_input_location(
  target_location_id uuid,
  line_no integer,
  field text,
  list text default null
)
returns public.storage_type
language plpgsql
set search_path = ''
as $$
declare
  info record;
begin
  select * into info from public.stock_location_info(target_location_id);
  if not found then
    perform public.raise_stock_error(
      '위치를 찾을 수 없습니다. 위치를 다시 선택해 주세요.', 'stock_location_not_found',
      line_no, field, '23503', jsonb_build_object('list', list)
    );
  end if;
  if not info.can_receive then
    perform public.raise_stock_error(
      format('사용중지된 위치(%s)에는 재고를 넣을 수 없습니다. 창고·구역·위치가 모두 사용 중인지 확인해 주세요.', info.label),
      'stock_location_inactive', line_no, field, '23514', jsonb_build_object('list', list)
    );
  end if;
  return info.zone_storage_type;
end;
$$;

comment on function public.check_stock_input_location(uuid, integer, text, text) is '새 재고를 넣을 위치가 있고 창고·구역·위치가 모두 사용 중인지 확인합니다.';

-- The quantity of a (lot, location) at the end of a day (all lines dated
-- on or before it).
create function public.stock_balance_as_of(
  target_lot_id uuid,
  target_location_id uuid,
  as_of date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(movement.quantity_delta), 0)
  from public.stock_movements as movement
  where movement.lot_id = target_lot_id
    and movement.location_id = target_location_id
    and movement.doc_date <= as_of
$$;

comment on function public.stock_balance_as_of(uuid, uuid, date) is '로트 × 위치의 그 날짜 마감 수량 (그날까지의 전표 줄 합계).';

-- How much of a (lot, location) a NEW line dated from_date may take away
-- without making the stock negative at any time: the smallest running
-- balance from that date on. A new line comes after every line of its own
-- date (lines are ordered by date, then by when they were saved). For
-- today's date this is simply the current quantity.
create function public.stock_available_from(
  target_lot_id uuid,
  target_location_id uuid,
  from_date date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select least(
    public.stock_balance_as_of(target_lot_id, target_location_id, from_date),
    coalesce(
      (
        select min(history.running)
        from (
          select
            movement.doc_date,
            sum(movement.quantity_delta) over (
              order by movement.doc_date, movement.seq
              rows between unbounded preceding and current row
            ) as running
          from public.stock_movements as movement
          where movement.lot_id = target_lot_id
            and movement.location_id = target_location_id
        ) as history
        where history.doc_date > from_date
      ),
      public.stock_balance_as_of(target_lot_id, target_location_id, from_date)
    )
  )
$$;

comment on function public.stock_available_from(uuid, uuid, date) is '그 날짜로 새로 꺼낼 수 있는 수량: 그 날짜 이후의 재고 흐름에서 가장 작은 잔량 (오늘 날짜면 현재 수량).';

-- After a back-dated line took stock away: the running balance of the
-- (lot, location), by date and then saving order, must never be below 0.
create function public.check_stock_pair_history(
  target_lot_id uuid,
  target_location_id uuid,
  line_no integer,
  list text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  lowest record;
  lot_label text;
begin
  select history.running, history.doc_date
  into lowest
  from (
    select
      movement.doc_date,
      sum(movement.quantity_delta) over (
        order by movement.doc_date, movement.seq
        rows between unbounded preceding and current row
      ) as running
    from public.stock_movements as movement
    where movement.lot_id = target_lot_id
      and movement.location_id = target_location_id
  ) as history
  order by history.running, history.doc_date
  limit 1;

  if found and lowest.running < 0 then
    select product.name || ' 로트 ' || lot.lot_no into lot_label
    from public.stock_lots as lot
    join public.products as product on product.id = lot.product_id
    where lot.id = target_lot_id;
    perform public.raise_stock_error(
      format('이 날짜로 등록하면 %s일에 %s(%s)의 재고가 0보다 작아집니다. 그 사이에 나간 재고가 있으니 전표 일자를 확인해 주세요.',
        lowest.doc_date,
        lot_label,
        (select info.label from public.stock_location_info(target_location_id) as info)),
      'stock_history_negative', line_no, 'quantity', '23514', jsonb_build_object('list', list)
    );
  end if;
end;
$$;

comment on function public.check_stock_pair_history(uuid, uuid, integer, text) is '지난 날짜로 재고를 꺼낸 뒤, 그 로트 × 위치의 날짜별 잔량이 한 번도 0보다 작아지지 않는지 확인합니다.';

-- -----------------------------------------------------------------------------
-- 9. Read functions (security invoker, no changes)
-- -----------------------------------------------------------------------------

-- What a product line means in 기준상품: a 기준상품 is itself; a 묶음상품 is
-- its 구성표 (기준상품 × 수량 per 묶음상품). For each 기준상품:
-- quantity = target_quantity × quantity_per_unit, and its share of the
-- line's 입고 단가 (target_unit_cost, per unit of the line's product,
-- 부가세 포함):
-- - 'price_weight' (every 기준상품 has a 기본 매입가 and their sum is above
--   0): unit cost = round(P × 기본 매입가 ÷ Σ(기본 매입가 × 구성 수량)), the
--   same arithmetic as mixed_taxable_amount (0.5 rounded up);
-- - 'quantity' (otherwise): every unit gets the same share,
--   round(P ÷ Σ 구성 수량).
-- The shares are rounded to whole won per 기준상품 unit, so Σ(share × 구성
-- 수량) may differ from P by up to 0.5원 × Σ 구성 수량 per 묶음상품 — and the
-- difference grows with the quantity received (e.g. 1,000 박스 × 24개입 at
-- 551,990원 → lots worth 552,000,000원, +10,000원). The 전표 therefore keeps
-- the typed P (stock_movements.bundle_unit_cost_incl_vat) and its value
-- uses it; 재고금액 uses the lots' whole-won shares. Same rule as
-- splitBundleUnitCost in src/lib/inventory/constants.ts: change both
-- together.
-- Returns a JSON array (empty when the product does not exist).
create function public.stock_bundle_components(
  target_product_id uuid,
  target_quantity numeric default 1,
  target_unit_cost bigint default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  target record;
  total_weight numeric;
  all_priced boolean;
  quantity_total numeric;
  use_price boolean;
begin
  select product.id, product.product_type into target
  from public.products as product
  where product.id = target_product_id;
  if not found then
    return '[]'::jsonb;
  end if;

  if target.product_type = 'base' then
    return (
      select jsonb_build_array(jsonb_build_object(
        'product_id', product.id,
        'code', product.code,
        'name', product.name,
        'unit', product.unit,
        'storage_type', product.storage_type,
        'shelf_life_days', product.shelf_life_days,
        'is_active', product.is_active,
        'purchase_price_incl_vat', product.purchase_price_incl_vat,
        'quantity_per_unit', 1,
        'quantity', target_quantity,
        'unit_cost_incl_vat', target_unit_cost,
        'cost_rule', 'direct'
      ))
      from public.products as product
      where product.id = target_product_id
    );
  end if;

  select
    sum(component.purchase_price_incl_vat * item.quantity),
    bool_and(component.purchase_price_incl_vat is not null),
    sum(item.quantity)
  into total_weight, all_priced, quantity_total
  from public.product_bundle_items as item
  join public.products as component on component.id = item.component_id
  where item.bundle_id = target_product_id;
  use_price := coalesce(all_priced, false) and coalesce(total_weight, 0) > 0;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', component.id,
          'code', component.code,
          'name', component.name,
          'unit', component.unit,
          'storage_type', component.storage_type,
          'shelf_life_days', component.shelf_life_days,
          'is_active', component.is_active,
          'purchase_price_incl_vat', component.purchase_price_incl_vat,
          'quantity_per_unit', item.quantity,
          'quantity', target_quantity * item.quantity,
          'unit_cost_incl_vat', case
            when target_unit_cost is null then null
            when use_price then public.mixed_taxable_amount(
              target_unit_cost, component.purchase_price_incl_vat, total_weight
            )
            else public.mixed_taxable_amount(target_unit_cost, 1, quantity_total)
          end,
          'cost_rule', case when use_price then 'price_weight' else 'quantity' end
        )
        order by item.sort_order, component.code
      ),
      '[]'::jsonb
    )
    from public.product_bundle_items as item
    join public.products as component on component.id = item.component_id
    where item.bundle_id = target_product_id
  );
end;
$$;

comment on function public.stock_bundle_components(uuid, numeric, bigint) is '상품 1줄을 기준상품으로 나눈 결과 (묶음상품은 구성표대로): 수량과 입고 단가 나눔 (기본 매입가 비율, 없으면 수량 비율). JSON 배열.';

-- The FEFO plan of 출고 lines (shared by the preview and issue_stock).
-- lines: [{"product_id", "quantity", "warehouse_id"?, "zone_id"?,
--          "location_id"?}, …] — a 묶음상품 is split into its 기준상품.
-- For each 기준상품, lots are taken in this order (FEFO):
--   1. lots WITH a 기한 before lots without one ("none" last);
--   2. the earliest 기한일; 3. the earliest 입고일; 4. the older lot;
--   5. within one lot: 창고코드, 구역코드, 위치코드.
-- Never: a lot whose 기한일 is before the 전표 date (기한 경과), unless
-- include_expired; a lot received after the 전표 date. Several lines (or
-- 묶음상품) with the same 기준상품 share its stock: lines limited to a
-- 위치, then to a 구역, then to a 창고 are planned first, then the others,
-- each group in line order (see the loop below).
-- only_lot_ids (issue_stock): only these lots (the ones it locked).
-- Returns {"doc_date", "ok" (no shortage), "lines" (in line order): [{"line",
--   "product_id", "product_code", "product_name", "product_type", "unit",
--   "quantity", "shortage" (bool), "demands": [{"product_id", "code",
--   "name", "unit", "storage_type", "quantity", "allocated", "shortage",
--   "available", "expired_excluded", "taken_by_other_lines" (stock at the
--   line's places that lines planned before it took), "allocations": [{lot,
--   location, "quantity", "available", "days_left", …}]}]}]}.
create function public.stock_issue_plan(
  lines jsonb,
  plan_date date default null,
  include_expired boolean default false,
  only_lot_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := public.stock_today();
  effective_date date := coalesce(plan_date, public.stock_today());
  -- Results are collected in arrays (appending to an array is cheap; adding
  -- to a JSON array copies it each time) and turned into JSON at the end.
  result_lines jsonb[] := '{}';
  -- What earlier planned lines took per (lot, location) ("lot:location").
  consumed jsonb := '{}'::jsonb;
  all_ok boolean := true;
  entry record;
  line_no integer;
  line_product_id uuid;
  product_row record;
  line_quantity numeric;
  filter_warehouse uuid;
  filter_zone uuid;
  filter_location uuid;
  component record;
  demands jsonb[];
  allocations jsonb[];
  remaining numeric;
  available_total numeric;
  expired_total numeric;
  candidate record;
  candidate_key text;
  candidate_base numeric;
  candidate_consumed numeric;
  candidate_available numeric;
  taken_total numeric;
  take numeric;
  line_short boolean;
begin
  if effective_date > today then
    perform public.raise_stock_error(
      format('전표 일자는 오늘(%s) 이후로 정할 수 없습니다.', today),
      'stock_doc_date_future', null, 'doc_date', '22023'
    );
  end if;
  perform public.check_stock_lines(lines, false);

  -- Lines limited to one 위치 are planned first, then lines limited to a
  -- 구역, then to a 창고, then the lines without a limit — each group in
  -- line order. A limited line can only use stock at its place, a line
  -- without a limit any stock, so this keeps a limited line from finding
  -- its place already emptied by an earlier unlimited line (e.g. line 1:
  -- 10 anywhere, line 2: 3 at 위치 A where the earliest lot is). It is a
  -- simple rule, not a full search (lines limited to overlapping places
  -- still share in this order). The result lists the lines in their own
  -- order again.
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
    order by
      case
        when nullif(btrim(coalesce(item.value ->> 'location_id', '')), '') is not null then 0
        when nullif(btrim(coalesce(item.value ->> 'zone_id', '')), '') is not null then 1
        when nullif(btrim(coalesce(item.value ->> 'warehouse_id', '')), '') is not null then 2
        else 3
      end,
      item.ordinality
  loop
    line_no := entry.ordinality::integer;
    line_product_id := public.read_stock_uuid(entry.value -> 'product_id', true, line_no, 'product_id', '상품');
    select product.id, product.code, product.name, product.product_type, product.unit,
      product.storage_type
    into product_row
    from public.products as product
    where product.id = line_product_id;
    if not found then
      perform public.raise_stock_error(
        '상품을 찾을 수 없습니다. 상품을 다시 선택해 주세요.', 'stock_product_not_found',
        line_no, 'product_id', '23503'
      );
    end if;
    line_quantity := public.read_stock_quantity(
      entry.value -> 'quantity', not public.unit_allows_fraction(product_row.unit), false,
      line_no, 'quantity', '수량'
    );

    filter_warehouse := public.read_stock_uuid(entry.value -> 'warehouse_id', false, line_no, 'warehouse_id', '창고');
    filter_zone := public.read_stock_uuid(entry.value -> 'zone_id', false, line_no, 'zone_id', '구역');
    filter_location := public.read_stock_uuid(entry.value -> 'location_id', false, line_no, 'location_id', '위치');
    if filter_warehouse is not null
      and not exists (select 1 from public.warehouses as warehouse where warehouse.id = filter_warehouse) then
      perform public.raise_stock_error('창고를 찾을 수 없습니다. 창고를 다시 선택해 주세요.',
        'stock_location_not_found', line_no, 'warehouse_id', '23503');
    end if;
    if filter_zone is not null
      and not exists (select 1 from public.warehouse_zones as zone where zone.id = filter_zone) then
      perform public.raise_stock_error('구역을 찾을 수 없습니다. 구역을 다시 선택해 주세요.',
        'stock_location_not_found', line_no, 'zone_id', '23503');
    end if;
    if filter_location is not null
      and not exists (select 1 from public.storage_locations as location where location.id = filter_location) then
      perform public.raise_stock_error('위치를 찾을 수 없습니다. 위치를 다시 선택해 주세요.',
        'stock_location_not_found', line_no, 'location_id', '23503');
    end if;

    demands := '{}';
    line_short := false;
    -- A 기준상품 is its own only part; a 묶음상품 is split by its 구성표.
    for component in
      select
        product_row.id as product_id, product_row.code as code, product_row.name as name,
        product_row.unit as unit, product_row.storage_type as storage_type,
        line_quantity as quantity
      where product_row.product_type = 'base'
      union all
      select *
      from jsonb_to_recordset(
        case
          when product_row.product_type = 'bundle'
            then public.stock_bundle_components(line_product_id, line_quantity, null)
          else '[]'::jsonb
        end
      ) as item (
        product_id uuid, code text, name text, unit text, storage_type public.storage_type,
        quantity numeric
      )
    loop
      if not public.unit_allows_fraction(component.unit)
        and component.quantity <> trunc(component.quantity) then
        perform public.raise_stock_error(
          format('‘%s’은(는) %s 단위라 정수로만 출고할 수 있습니다. 묶음상품 수량을 정수로 입력해 주세요.', component.name, component.unit),
          'stock_quantity_not_whole', line_no, 'quantity', '22023'
        );
      end if;

      remaining := component.quantity;
      available_total := 0;
      taken_total := 0;
      allocations := '{}';
      for candidate in
        select
          balance.lot_id,
          balance.location_id,
          balance.quantity,
          lot.lot_no,
          lot.expiry_kind,
          lot.expiry_date,
          lot.received_date,
          lot.unit_cost_incl_vat,
          location.code as location_code,
          location.name as location_name,
          zone.id as zone_id,
          zone.code as zone_code,
          zone.name as zone_name,
          zone.storage_type as zone_storage_type,
          warehouse.id as warehouse_id,
          warehouse.code as warehouse_code,
          warehouse.name as warehouse_name
        from public.stock_balances as balance
        join public.stock_lots as lot on lot.id = balance.lot_id
        join public.storage_locations as location on location.id = balance.location_id
        join public.warehouse_zones as zone on zone.id = location.zone_id
        join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
        where balance.product_id = component.product_id
          and balance.quantity > 0
          and (filter_warehouse is null or warehouse.id = filter_warehouse)
          and (filter_zone is null or zone.id = filter_zone)
          and (filter_location is null or location.id = filter_location)
          and lot.received_date <= effective_date
          and (include_expired or lot.expiry_kind = 'none' or lot.expiry_date >= effective_date)
          and (only_lot_ids is null or lot.id = any (only_lot_ids))
        order by
          (lot.expiry_kind = 'none'),
          lot.expiry_date,
          lot.received_date,
          lot.created_at,
          lot.id,
          warehouse.code,
          zone.code,
          location.code,
          location.id
      loop
        candidate_key := candidate.lot_id::text || ':' || candidate.location_id::text;
        candidate_base := case
            when effective_date >= today then candidate.quantity
            else public.stock_available_from(candidate.lot_id, candidate.location_id, effective_date)
          end;
        candidate_consumed := coalesce((consumed ->> candidate_key)::numeric, 0);
        -- Stock here that other lines of this 전표 were given first.
        taken_total := taken_total + least(candidate_consumed, greatest(candidate_base, 0));
        candidate_available := candidate_base - candidate_consumed;
        if candidate_available <= 0 then
          continue;
        end if;
        available_total := available_total + candidate_available;
        if remaining > 0 then
          take := least(candidate_available, remaining);
          allocations := array_append(allocations, jsonb_build_object(
            'lot_id', candidate.lot_id,
            'lot_no', candidate.lot_no,
            'expiry_kind', candidate.expiry_kind,
            'expiry_date', candidate.expiry_date,
            'days_left', candidate.expiry_date - today,
            'received_date', candidate.received_date,
            'unit_cost_incl_vat', candidate.unit_cost_incl_vat,
            'location_id', candidate.location_id,
            'location_code', candidate.location_code,
            'location_name', candidate.location_name,
            'zone_id', candidate.zone_id,
            'zone_code', candidate.zone_code,
            'zone_name', candidate.zone_name,
            'zone_storage_type', candidate.zone_storage_type,
            'warehouse_id', candidate.warehouse_id,
            'warehouse_code', candidate.warehouse_code,
            'warehouse_name', candidate.warehouse_name,
            'available', candidate_available,
            'quantity', take
          ));
          consumed := jsonb_set(
            consumed,
            array[candidate_key],
            to_jsonb(coalesce((consumed ->> candidate_key)::numeric, 0) + take)
          );
          remaining := remaining - take;
        end if;
      end loop;

      expired_total := 0;
      if not include_expired then
        select coalesce(sum(balance.quantity), 0) into expired_total
        from public.stock_balances as balance
        join public.stock_lots as lot on lot.id = balance.lot_id
        join public.storage_locations as location on location.id = balance.location_id
        join public.warehouse_zones as zone on zone.id = location.zone_id
        where balance.product_id = component.product_id
          and balance.quantity > 0
          and (filter_warehouse is null or zone.warehouse_id = filter_warehouse)
          and (filter_zone is null or zone.id = filter_zone)
          and (filter_location is null or location.id = filter_location)
          and lot.expiry_kind <> 'none'
          and lot.expiry_date < effective_date;
      end if;

      demands := array_append(demands, jsonb_build_object(
        'product_id', component.product_id,
        'code', component.code,
        'name', component.name,
        'unit', component.unit,
        'storage_type', component.storage_type,
        'quantity', component.quantity,
        'allocated', component.quantity - remaining,
        'shortage', remaining,
        'available', available_total,
        'expired_excluded', expired_total,
        'taken_by_other_lines', taken_total,
        'allocations', to_jsonb(allocations)
      ));
      if remaining > 0 then
        line_short := true;
        all_ok := false;
      end if;
    end loop;

    result_lines := array_append(result_lines, jsonb_build_object(
      'line', line_no,
      'product_id', product_row.id,
      'product_code', product_row.code,
      'product_name', product_row.name,
      'product_type', product_row.product_type,
      'unit', product_row.unit,
      'quantity', line_quantity,
      'warehouse_id', filter_warehouse,
      'zone_id', filter_zone,
      'location_id', filter_location,
      'shortage', line_short,
      'demands', to_jsonb(demands)
    ));
  end loop;

  return jsonb_build_object(
    'doc_date', effective_date,
    'ok', all_ok,
    'lines', (
      select coalesce(jsonb_agg(planned.value order by (planned.value ->> 'line')::integer), '[]'::jsonb)
      from unnest(result_lines) as planned (value)
    )
  );
end;
$$;

comment on function public.stock_issue_plan(jsonb, date, boolean, uuid[]) is '출고 줄들의 FEFO 배정 계획 (기한 빠른 순 → 입고일 → 오래된 로트, 기한 없음은 마지막, 기한 경과 제외; 위치·구역·창고를 정한 줄부터 배정). plan_stock_issue와 issue_stock이 함께 씁니다.';

-- [배정 미리보기] of the 출고 screen: the plan issue_stock would carry out
-- now (see stock_issue_plan). Nothing is saved or locked.
create function public.plan_stock_issue(
  lines jsonb,
  plan_date date default null,
  include_expired boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.stock_issue_plan(lines, plan_date, include_expired, null)
$$;

comment on function public.plan_stock_issue(jsonb, date, boolean) is '출고 배정 미리보기: FEFO로 어느 로트·위치에서 얼마나 나갈지 (저장하지 않음). 부족하면 ok=false.';

-- FEFO plan of ONE product (the future 주문 module and the screens call
-- it): the plan line of stock_issue_plan for that product and quantity.
create function public.allocate_fefo(
  target_product_id uuid,
  target_quantity numeric,
  filter_warehouse_id uuid default null,
  filter_zone_id uuid default null,
  filter_location_id uuid default null,
  plan_date date default null,
  include_expired boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.stock_issue_plan(
    jsonb_build_array(jsonb_build_object(
      'product_id', target_product_id,
      'quantity', target_quantity,
      'warehouse_id', filter_warehouse_id,
      'zone_id', filter_zone_id,
      'location_id', filter_location_id
    )),
    plan_date,
    include_expired,
    null
  ) -> 'lines' -> 0
$$;

comment on function public.allocate_fefo(uuid, numeric, uuid, uuid, uuid, date, boolean) is '상품 하나의 FEFO 배정 미리보기 (기한 빠른 로트부터, 기한 경과 제외). 앞으로 주문 출고도 이 규칙을 씁니다.';

-- 보관온도 warnings of 이동 lines before saving: the product of the lot
-- needs another 보관온도 than the 구역 it moves to. lines: [{"lot_id",
-- "to_location_id"}, …]. Unknown ids are skipped (the save reports them).
-- Returns [{"line", "lot_id", "lot_no", "product_id", "product_code",
-- "product_name", "product_storage_type", "zone_storage_type",
-- "location_id", "location_label", "too_warm"}, …].
create function public.stock_transfer_warnings(lines jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line', item.ordinality,
        'lot_id', lot.id,
        'lot_no', lot.lot_no,
        'product_id', product.id,
        'product_code', product.code,
        'product_name', product.name,
        'product_storage_type', product.storage_type,
        'zone_storage_type', info.zone_storage_type,
        'location_id', info.location_id,
        'location_label', info.label,
        'too_warm', info.zone_storage_type < product.storage_type
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(lines) = 'array' then lines else '[]'::jsonb end
  ) with ordinality as item (value, ordinality)
  join public.stock_lots as lot
    on lot.id::text = item.value ->> 'lot_id'
  join public.products as product on product.id = lot.product_id
  cross join lateral public.stock_location_info(
    case
      when (item.value ->> 'to_location_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (item.value ->> 'to_location_id')::uuid
    end
  ) as info
  where info.zone_storage_type <> product.storage_type
$$;

comment on function public.stock_transfer_warnings(jsonb) is '이동 저장 전 경고: 받는 구역의 보관온도가 상품과 다른 줄 (too_warm = 상품에 필요한 온도보다 따뜻함).';

-- 실사 목록: the stock of a 창고 (or one 구역 / 위치) at the end of as_of
-- (default today): one line per (lot, location) with a quantity above 0.
-- At most 3,000 lines (otherwise choose a smaller scope).
-- Returns {"as_of", "lines": [{"lot_id", "location_id", "system_quantity",
-- product, lot, location …}]} sorted by 창고·구역·위치, 상품코드, 기한.
create function public.stock_count_sheet(
  filter_warehouse_id uuid,
  filter_zone_id uuid default null,
  filter_location_id uuid default null,
  as_of date default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  count_date date := coalesce(as_of, public.stock_today());
  result jsonb;
  line_count integer;
begin
  if filter_warehouse_id is null and filter_zone_id is null and filter_location_id is null then
    perform public.raise_stock_error('실사할 창고(또는 구역·위치)를 선택해 주세요.',
      'stock_count_scope_required', null, 'warehouse_id', '22023');
  end if;
  if count_date > public.stock_today() then
    perform public.raise_stock_error(
      format('실사 일자는 오늘(%s) 이후로 정할 수 없습니다.', public.stock_today()),
      'stock_doc_date_future', null, 'doc_date', '22023');
  end if;

  with pairs as (
    select movement.lot_id, movement.location_id, sum(movement.quantity_delta) as quantity
    from public.stock_movements as movement
    join public.storage_locations as location on location.id = movement.location_id
    join public.warehouse_zones as zone on zone.id = location.zone_id
    where movement.doc_date <= count_date
      and (filter_warehouse_id is null or zone.warehouse_id = filter_warehouse_id)
      and (filter_zone_id is null or zone.id = filter_zone_id)
      and (filter_location_id is null or location.id = filter_location_id)
    group by movement.lot_id, movement.location_id
    having sum(movement.quantity_delta) > 0
  ),
  sheet as (
    select
      pair.lot_id,
      pair.location_id,
      pair.quantity as system_quantity,
      lot.product_id,
      product.code as product_code,
      product.name as product_name,
      product.spec as product_spec,
      product.unit as product_unit,
      product.storage_type as product_storage_type,
      lot.lot_no,
      lot.expiry_kind,
      lot.expiry_date,
      lot.expiry_date - public.stock_today() as days_left,
      lot.received_date,
      lot.unit_cost_incl_vat,
      -- For the 차이 금액 of a lot without 입고 단가 (like lot_stock_items).
      product.purchase_price_incl_vat as product_purchase_price_incl_vat,
      location.code as location_code,
      location.name as location_name,
      zone.id as zone_id,
      zone.code as zone_code,
      zone.name as zone_name,
      zone.storage_type as zone_storage_type,
      warehouse.id as warehouse_id,
      warehouse.code as warehouse_code,
      warehouse.name as warehouse_name,
      warehouse.sort_order as warehouse_sort_order,
      zone.sort_order as zone_sort_order,
      location.sort_order as location_sort_order
    from pairs as pair
    join public.stock_lots as lot on lot.id = pair.lot_id
    join public.products as product on product.id = lot.product_id
    join public.storage_locations as location on location.id = pair.location_id
    join public.warehouse_zones as zone on zone.id = location.zone_id
    join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        to_jsonb(sheet) - 'warehouse_sort_order' - 'zone_sort_order' - 'location_sort_order'
        order by sheet.warehouse_sort_order, sheet.warehouse_code, sheet.zone_sort_order,
          sheet.zone_code, sheet.location_sort_order, sheet.location_code, sheet.product_code,
          sheet.expiry_date nulls last, sheet.lot_no
      ),
      '[]'::jsonb
    )
  into line_count, result
  from sheet;

  if line_count > 3000 then
    perform public.raise_stock_error(
      format('실사할 재고가 %s줄로 너무 많습니다. 구역이나 위치를 골라 3,000줄 이하로 나눠 주세요.', line_count),
      'stock_count_scope_too_large', null, 'warehouse_id', '22023');
  end if;
  return jsonb_build_object('as_of', count_date, 'lines', result);
end;
$$;

comment on function public.stock_count_sheet(uuid, uuid, uuid, date) is '실사 목록: 창고(구역·위치) 안의 그 날짜 마감 재고 (로트 × 위치, 최대 3,000줄).';

-- -----------------------------------------------------------------------------
-- 10. Reports
-- -----------------------------------------------------------------------------

-- 상품별 재고현황 for a period, one row per 기준상품 (filters below), in a
-- scope of locations (all, one 창고, one 구역 or one 위치):
--   opening_qty (이월) = stock at the end of the day before date_from;
--   receipt_qty (입고) and opening_stock_qty (기초재고) — net, a 취소
--   counts as a minus in the column of the 전표 it undoes;
--   issue_qty (출고) and disposal_qty (폐기) — quantities that went out;
--   adjust_in_qty / adjust_out_qty (실사조정 + / −);
--   transfer_in_qty / transfer_out_qty (이동 into / out of the scope; for
--   all locations they are equal);
--   closing_qty (기말) = opening + receipt + opening_stock − issue
--     + adjust_in − adjust_out − disposal + transfer_in − transfer_out;
--   closing_value_incl_vat / _excl_vat (재고금액 at the end of date_to) =
--     Σ (lot, location) round(quantity × the lot's 입고 단가, or the
--     product's 기본 매입가 when the lot has none → cost_estimated; neither
--     → cost_missing and that lot counts 0; empty (null) when no lot of the
--     product has any cost); 부가세 별도 by vat_excluded_amount;
--   closing_unit_cost_incl_vat (재고단가) = round(value ÷ the quantity of the
--     lots that have a cost) — the weighted average; empty when none has;
--   nearest_expiry_date / _kind: the earliest 기한 of the stock left.
-- Filters: search_text (상품코드·상품명·바코드), filter_category_id (and
-- every category below it) or only_uncategorized, filter_tax_type,
-- filter_storage_type, product_status ('active' | 'inactive' | 'all'),
-- only_with_stock (closing_qty ≠ 0).
-- Returns {"date_from", "date_to", "rows": [...] (by 상품코드), "totals"}.
create function public.stock_period_report(
  date_from date,
  date_to date,
  filter_warehouse_id uuid default null,
  filter_zone_id uuid default null,
  filter_location_id uuid default null,
  search_text text default null,
  filter_category_id uuid default null,
  only_uncategorized boolean default false,
  filter_tax_type text default null,
  filter_storage_type text default null,
  product_status text default 'all',
  only_with_stock boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  pattern text;
  result jsonb;
begin
  if date_from is null or date_to is null or date_from > date_to then
    perform public.raise_stock_error('조회기간을 확인해 주세요. 시작일이 종료일보다 늦습니다.',
      'stock_period_invalid', null, 'date_from', '22023');
  end if;
  if coalesce(product_status, 'all') not in ('active', 'inactive', 'all') then
    perform public.raise_stock_error('상품 사용여부 조건을 확인해 주세요.',
      'stock_period_invalid', null, 'product_status', '22023');
  end if;
  pattern := case
    when nullif(btrim(coalesce(search_text, '')), '') is null then null
    else '%' || replace(replace(replace(btrim(search_text), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  with scope_locations as (
    select location.id
    from public.storage_locations as location
    join public.warehouse_zones as zone on zone.id = location.zone_id
    where (filter_warehouse_id is null or zone.warehouse_id = filter_warehouse_id)
      and (filter_zone_id is null or zone.id = filter_zone_id)
      and (filter_location_id is null or location.id = filter_location_id)
  ),
  chosen_products as (
    select
      product.id,
      product.code,
      product.name,
      product.spec,
      product.unit,
      product.barcode,
      product.category_id,
      category.parent_id as category_parent_id,
      parent_category.parent_id as category_grandparent_id,
      product.storage_type,
      product.tax_type,
      product.is_active,
      product.purchase_price_incl_vat
    from public.products as product
    left join public.product_categories as category on category.id = product.category_id
    left join public.product_categories as parent_category on parent_category.id = category.parent_id
    where product.product_type = 'base'
      and (
        pattern is null
        or product.code ilike pattern
        or product.name ilike pattern
        or product.barcode ilike pattern
      )
      and (not coalesce(only_uncategorized, false) or product.category_id is null)
      and (
        coalesce(only_uncategorized, false)
        or filter_category_id is null
        or product.category_id = filter_category_id
        or category.parent_id = filter_category_id
        or parent_category.parent_id = filter_category_id
      )
      and (filter_tax_type is null or product.tax_type::text = filter_tax_type)
      and (filter_storage_type is null or product.storage_type::text = filter_storage_type)
      and (
        coalesce(product_status, 'all') = 'all'
        or (product_status = 'active' and product.is_active)
        or (product_status = 'inactive' and not product.is_active)
      )
  ),
  scoped as (
    select
      movement.product_id,
      movement.lot_id,
      movement.location_id,
      movement.doc_date,
      movement.movement_type,
      movement.quantity_delta as delta,
      case when movement.is_reversal then -movement.quantity_delta else movement.quantity_delta end
        as original_delta,
      movement.doc_date >= date_from as in_period
    from public.stock_movements as movement
    where movement.doc_date <= date_to
      and movement.product_id in (select chosen.id from chosen_products as chosen)
      and movement.location_id in (select scope_location.id from scope_locations as scope_location)
  ),
  quantities as (
    select
      scoped.product_id,
      coalesce(sum(scoped.delta) filter (where not scoped.in_period), 0) as opening_qty,
      coalesce(sum(scoped.delta) filter (where scoped.in_period and scoped.movement_type = 'receipt'), 0)
        as receipt_qty,
      coalesce(sum(scoped.delta) filter (where scoped.in_period and scoped.movement_type = 'opening'), 0)
        as opening_stock_qty,
      coalesce(sum(-scoped.delta) filter (where scoped.in_period and scoped.movement_type = 'issue'), 0)
        as issue_qty,
      coalesce(sum(-scoped.delta) filter (where scoped.in_period and scoped.movement_type = 'disposal'), 0)
        as disposal_qty,
      coalesce(sum(scoped.delta) filter (
        where scoped.in_period and scoped.movement_type = 'count' and scoped.original_delta > 0
      ), 0) as adjust_in_qty,
      coalesce(sum(-scoped.delta) filter (
        where scoped.in_period and scoped.movement_type = 'count' and scoped.original_delta < 0
      ), 0) as adjust_out_qty,
      coalesce(sum(scoped.delta) filter (
        where scoped.in_period and scoped.movement_type = 'transfer' and scoped.original_delta > 0
      ), 0) as transfer_in_qty,
      coalesce(sum(-scoped.delta) filter (
        where scoped.in_period and scoped.movement_type = 'transfer' and scoped.original_delta < 0
      ), 0) as transfer_out_qty,
      coalesce(sum(scoped.delta), 0) as closing_qty
    from scoped
    group by scoped.product_id
  ),
  pair_values as (
    select
      pair.product_id,
      pair.lot_id,
      pair.quantity,
      lot.expiry_kind,
      lot.expiry_date,
      lot.unit_cost_incl_vat,
      chosen.purchase_price_incl_vat,
      chosen.tax_type,
      coalesce(lot.unit_cost_incl_vat, chosen.purchase_price_incl_vat) as cost,
      round(pair.quantity * coalesce(lot.unit_cost_incl_vat, chosen.purchase_price_incl_vat))::bigint
        as value_incl_vat
    from (
      select scoped.product_id, scoped.lot_id, scoped.location_id, sum(scoped.delta) as quantity
      from scoped
      group by scoped.product_id, scoped.lot_id, scoped.location_id
      having sum(scoped.delta) <> 0
    ) as pair
    join public.stock_lots as lot on lot.id = pair.lot_id
    join chosen_products as chosen on chosen.id = pair.product_id
  ),
  product_values as (
    select
      pair_value.product_id,
      -- Empty (null) when no lot of the product has a cost at all.
      sum(pair_value.value_incl_vat) as value_incl_vat,
      sum(public.vat_excluded_amount(pair_value.value_incl_vat, pair_value.tax_type = 'taxable'))
        as value_excl_vat,
      sum(pair_value.quantity) filter (where pair_value.cost is not null) as priced_qty,
      bool_or(pair_value.unit_cost_incl_vat is null and pair_value.purchase_price_incl_vat is not null)
        as cost_estimated,
      bool_or(pair_value.unit_cost_incl_vat is null and pair_value.purchase_price_incl_vat is null)
        as cost_missing,
      count(distinct pair_value.lot_id)::integer as lot_count,
      min(pair_value.expiry_date) filter (where pair_value.quantity > 0) as nearest_expiry_date,
      (
        array_agg(pair_value.expiry_kind order by pair_value.expiry_date)
          filter (where pair_value.quantity > 0 and pair_value.expiry_date is not null)
      )[1] as nearest_expiry_kind
    from pair_values as pair_value
    group by pair_value.product_id
  ),
  report_rows as (
    select
      chosen.id as product_id,
      chosen.code,
      chosen.name,
      chosen.spec,
      chosen.unit,
      chosen.barcode,
      chosen.category_id,
      chosen.category_parent_id,
      chosen.category_grandparent_id,
      chosen.storage_type,
      chosen.tax_type,
      chosen.is_active,
      chosen.purchase_price_incl_vat,
      coalesce(product_quantity.opening_qty, 0) as opening_qty,
      coalesce(product_quantity.receipt_qty, 0) as receipt_qty,
      coalesce(product_quantity.opening_stock_qty, 0) as opening_stock_qty,
      coalesce(product_quantity.issue_qty, 0) as issue_qty,
      coalesce(product_quantity.adjust_in_qty, 0) as adjust_in_qty,
      coalesce(product_quantity.adjust_out_qty, 0) as adjust_out_qty,
      coalesce(product_quantity.disposal_qty, 0) as disposal_qty,
      coalesce(product_quantity.transfer_in_qty, 0) as transfer_in_qty,
      coalesce(product_quantity.transfer_out_qty, 0) as transfer_out_qty,
      coalesce(product_quantity.closing_qty, 0) as closing_qty,
      case
        when product_value.product_id is null then 0
        else product_value.value_incl_vat
      end as closing_value_incl_vat,
      case
        when product_value.product_id is null then 0
        else product_value.value_excl_vat
      end as closing_value_excl_vat,
      case
        when product_value.priced_qty > 0
          then round(product_value.value_incl_vat / product_value.priced_qty)::bigint
      end as closing_unit_cost_incl_vat,
      coalesce(product_value.cost_estimated, false) as cost_estimated,
      coalesce(product_value.cost_missing, false) as cost_missing,
      coalesce(product_value.lot_count, 0) as lot_count,
      product_value.nearest_expiry_date,
      product_value.nearest_expiry_kind
    from chosen_products as chosen
    left join quantities as product_quantity on product_quantity.product_id = chosen.id
    left join product_values as product_value on product_value.product_id = chosen.id
    where not coalesce(only_with_stock, false) or coalesce(product_quantity.closing_qty, 0) <> 0
  )
  select jsonb_build_object(
    'date_from', date_from,
    'date_to', date_to,
    'rows', coalesce(jsonb_agg(to_jsonb(report_row) order by report_row.code), '[]'::jsonb),
    'totals', jsonb_build_object(
      'product_count', count(*),
      'opening_qty', coalesce(sum(report_row.opening_qty), 0),
      'receipt_qty', coalesce(sum(report_row.receipt_qty), 0),
      'opening_stock_qty', coalesce(sum(report_row.opening_stock_qty), 0),
      'issue_qty', coalesce(sum(report_row.issue_qty), 0),
      'adjust_in_qty', coalesce(sum(report_row.adjust_in_qty), 0),
      'adjust_out_qty', coalesce(sum(report_row.adjust_out_qty), 0),
      'disposal_qty', coalesce(sum(report_row.disposal_qty), 0),
      'transfer_in_qty', coalesce(sum(report_row.transfer_in_qty), 0),
      'transfer_out_qty', coalesce(sum(report_row.transfer_out_qty), 0),
      'closing_qty', coalesce(sum(report_row.closing_qty), 0),
      'closing_value_incl_vat', coalesce(sum(report_row.closing_value_incl_vat), 0),
      'closing_value_excl_vat', coalesce(sum(report_row.closing_value_excl_vat), 0),
      'cost_estimated', coalesce(bool_or(report_row.cost_estimated), false),
      'cost_missing', coalesce(bool_or(report_row.cost_missing), false)
    )
  )
  into result
  from report_rows as report_row;
  return result;
end;
$$;

comment on function public.stock_period_report(date, date, uuid, uuid, uuid, text, uuid, boolean, text, text, text, boolean) is '상품별 재고현황 (기간): 이월, 입고, 기초재고, 출고, 조정(+/-), 폐기, 이동(입/출), 기말, 재고금액(부가세 포함/별도), 재고단가, 가장 빠른 기한. JSON {rows, totals}.';

-- 상품별 거래수불: the lines of one 기준상품 in a period and a scope of
-- locations, in order (date, then saving order), with the running balance
-- starting from the 이월 (stock at the end of the day before date_from).
-- Returns {"product": {…}, "date_from", "date_to", "opening_qty",
-- "in_qty", "out_qty" (every + / − line, 폐기·이동·조정 included),
-- "closing_qty", "summary" (the columns of stock_period_report: receipt_qty,
-- opening_stock_qty, issue_qty, disposal_qty, adjust_in/out_qty,
-- transfer_in/out_qty), "lines": [{"movement_id", "seq",
-- "doc_date", "document_id", "doc_no", "doc_type", "movement_type",
-- "is_reversal", "partner_code", "partner_name", "lot_id", "lot_no",
-- "expiry_kind", "expiry_date", location …, "in_qty", "out_qty",
-- "balance", "unit_cost_incl_vat", "reason", "memo", "bundle_code",
-- "bundle_name", "created_at"}, …]}.
create function public.product_stock_ledger(
  target_product_id uuid,
  date_from date,
  date_to date,
  filter_warehouse_id uuid default null,
  filter_zone_id uuid default null,
  filter_location_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  product_info jsonb;
  opening numeric;
  result jsonb;
begin
  if date_from is null or date_to is null or date_from > date_to then
    perform public.raise_stock_error('조회기간을 확인해 주세요. 시작일이 종료일보다 늦습니다.',
      'stock_period_invalid', null, 'date_from', '22023');
  end if;
  select jsonb_build_object(
    'id', product.id, 'code', product.code, 'name', product.name, 'spec', product.spec,
    'unit', product.unit, 'product_type', product.product_type,
    'storage_type', product.storage_type, 'tax_type', product.tax_type,
    'is_active', product.is_active
  )
  into product_info
  from public.products as product
  where product.id = target_product_id;
  if product_info is null then
    perform public.raise_stock_error('상품을 찾을 수 없습니다.', 'stock_product_not_found',
      null, 'product_id', '23503');
  end if;

  select coalesce(sum(movement.quantity_delta), 0) into opening
  from public.stock_movements as movement
  join public.storage_locations as location on location.id = movement.location_id
  join public.warehouse_zones as zone on zone.id = location.zone_id
  where movement.product_id = target_product_id
    and movement.doc_date < date_from
    and (filter_warehouse_id is null or zone.warehouse_id = filter_warehouse_id)
    and (filter_zone_id is null or zone.id = filter_zone_id)
    and (filter_location_id is null or location.id = filter_location_id);

  with period_lines as (
    select
      movement.id as movement_id,
      movement.seq,
      movement.doc_date,
      movement.document_id,
      document.doc_no,
      document.doc_type,
      movement.movement_type,
      movement.is_reversal,
      movement.line_no,
      partner.code as partner_code,
      partner.name as partner_name,
      movement.lot_id,
      lot.lot_no,
      lot.expiry_kind,
      lot.expiry_date,
      movement.location_id,
      location.code as location_code,
      location.name as location_name,
      zone.code as zone_code,
      zone.name as zone_name,
      warehouse.code as warehouse_code,
      warehouse.name as warehouse_name,
      greatest(movement.quantity_delta, 0) as in_qty,
      greatest(-movement.quantity_delta, 0) as out_qty,
      -- The line's quantity as the 전표 it undoes counted it (for summary).
      case when movement.is_reversal then -movement.quantity_delta else movement.quantity_delta end
        as original_delta,
      opening + sum(movement.quantity_delta) over (
        order by movement.doc_date, movement.seq
        rows between unbounded preceding and current row
      ) as balance,
      movement.unit_cost_incl_vat,
      movement.reason,
      coalesce(movement.memo, document.memo) as memo,
      bundle.code as bundle_code,
      bundle.name as bundle_name,
      movement.created_at
    from public.stock_movements as movement
    join public.stock_documents as document on document.id = movement.document_id
    left join public.partners as partner on partner.id = document.partner_id
    join public.stock_lots as lot on lot.id = movement.lot_id
    join public.storage_locations as location on location.id = movement.location_id
    join public.warehouse_zones as zone on zone.id = location.zone_id
    join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
    left join public.products as bundle on bundle.id = movement.bundle_id
    where movement.product_id = target_product_id
      and movement.doc_date between date_from and date_to
      and (filter_warehouse_id is null or zone.warehouse_id = filter_warehouse_id)
      and (filter_zone_id is null or zone.id = filter_zone_id)
      and (filter_location_id is null or location.id = filter_location_id)
  )
  select jsonb_build_object(
    'product', product_info,
    'date_from', date_from,
    'date_to', date_to,
    'opening_qty', opening,
    'in_qty', coalesce(sum(period_line.in_qty), 0),
    'out_qty', coalesce(sum(period_line.out_qty), 0),
    'closing_qty', opening + coalesce(sum(period_line.in_qty), 0) - coalesce(sum(period_line.out_qty), 0),
    -- The same columns as stock_period_report (상품별 재고현황), counted
    -- the same way: a 취소 lowers the column of the kind it undoes; 이동
    -- in / out of the scope (equal when no 창고·구역·위치 is chosen).
    'summary', jsonb_build_object(
      'receipt_qty', coalesce(sum(period_line.in_qty - period_line.out_qty)
        filter (where period_line.movement_type = 'receipt'), 0),
      'opening_stock_qty', coalesce(sum(period_line.in_qty - period_line.out_qty)
        filter (where period_line.movement_type = 'opening'), 0),
      'issue_qty', coalesce(sum(period_line.out_qty - period_line.in_qty)
        filter (where period_line.movement_type = 'issue'), 0),
      'disposal_qty', coalesce(sum(period_line.out_qty - period_line.in_qty)
        filter (where period_line.movement_type = 'disposal'), 0),
      'adjust_in_qty', coalesce(sum(period_line.in_qty - period_line.out_qty)
        filter (where period_line.movement_type = 'count' and period_line.original_delta > 0), 0),
      'adjust_out_qty', coalesce(sum(period_line.out_qty - period_line.in_qty)
        filter (where period_line.movement_type = 'count' and period_line.original_delta < 0), 0),
      'transfer_in_qty', coalesce(sum(period_line.in_qty - period_line.out_qty)
        filter (where period_line.movement_type = 'transfer' and period_line.original_delta > 0), 0),
      'transfer_out_qty', coalesce(sum(period_line.out_qty - period_line.in_qty)
        filter (where period_line.movement_type = 'transfer' and period_line.original_delta < 0), 0)
    ),
    'lines', coalesce(
      jsonb_agg(to_jsonb(period_line) - 'original_delta' order by period_line.doc_date, period_line.seq),
      '[]'::jsonb
    )
  )
  into result
  from period_lines as period_line;
  return result;
end;
$$;

comment on function public.product_stock_ledger(uuid, date, date, uuid, uuid, uuid) is '상품별 거래수불: 기간 안의 전표 줄(일자·저장 순서)과 이월부터의 잔량. JSON.';

-- The dashboard's stock cards: 기한 경과 / 기한 임박 (the setting) / 보관온도
-- 불일치 (rows, lots, products, value) and the stock on hand, plus the
-- latest 전표 (recent_limit, 1–50).
create function public.stock_dashboard(recent_limit integer default 10)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'today', public.stock_today(),
    'expiry_warning_days', (select settings.expiry_warning_days from public.app_settings as settings),
    'expired', (
      select jsonb_build_object(
        'row_count', count(*),
        'lot_count', count(distinct item.lot_id),
        'product_count', count(distinct item.product_id),
        'value_incl_vat', coalesce(sum(item.value_incl_vat), 0),
        'value_excl_vat', coalesce(sum(item.value_excl_vat), 0)
      )
      from public.lot_stock_items as item
      where item.expiry_status = 'expired'
    ),
    'imminent', (
      select jsonb_build_object(
        'row_count', count(*),
        'lot_count', count(distinct item.lot_id),
        'product_count', count(distinct item.product_id),
        'value_incl_vat', coalesce(sum(item.value_incl_vat), 0),
        'value_excl_vat', coalesce(sum(item.value_excl_vat), 0)
      )
      from public.lot_stock_items as item
      where item.expiry_status = 'imminent'
    ),
    'mismatch', (
      select jsonb_build_object(
        'row_count', count(*),
        'too_warm_count', count(*) filter (where item.storage_too_warm),
        'lot_count', count(distinct item.lot_id),
        'product_count', count(distinct item.product_id)
      )
      from public.lot_stock_items as item
      where item.storage_mismatch
    ),
    'stock', (
      select jsonb_build_object(
        'row_count', count(*),
        'lot_count', count(distinct item.lot_id),
        'product_count', count(distinct item.product_id),
        'value_incl_vat', coalesce(sum(item.value_incl_vat), 0),
        'value_excl_vat', coalesce(sum(item.value_excl_vat), 0),
        'cost_estimated', coalesce(bool_or(item.cost_estimated), false),
        'cost_missing', coalesce(bool_or(item.value_incl_vat is null), false)
      )
      from public.lot_stock_items as item
    ),
    'recent_documents', (
      select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at desc, recent.doc_no desc), '[]'::jsonb)
      from (
        select
          document.id, document.doc_no, document.doc_type, document.effective_type,
          document.doc_date, document.partner_name, document.first_product_name,
          document.product_count, document.line_count, document.reverses_doc_no,
          document.reversed_by_doc_no, document.created_at
        from public.stock_document_list_items as document
        order by document.created_at desc, document.doc_no desc
        limit greatest(least(coalesce(recent_limit, 10), 50), 1)
      ) as recent
    )
  )
$$;

comment on function public.stock_dashboard(integer) is '대시보드 재고 카드: 기한 경과·기한 임박·보관온도 불일치 재고(건수·로트·상품·금액), 전체 재고, 최근 전표. JSON.';

-- Checks that the stock tables agree with each other. Returns one row per
-- problem (none = everything is right):
-- - balance_mismatch: a (lot, location) whose stock_balances quantity is
--   not the sum of its lines (or one exists without the other);
-- - negative_balance / negative_history: stock below 0 now / at some date;
-- - movement_mismatch: a line whose product, 단가, 전표 date or 수불 구분
--   is not the one of its lot and 전표, or dated before the lot's 입고일;
-- - balance_product_mismatch: a balance whose product is not its lot's;
-- - lot_not_base: a lot of a 묶음상품;
-- - document_without_lines / lot_without_receipt_line: a 전표 without lines,
--   a lot without a line in the 전표 that created it;
-- - reversal_mismatch: a 취소 전표 that is not the exact opposite of its
--   original, or 취소 links that do not point to each other.
-- Run it in the SQL console (select * from public.stock_integrity_check();)
-- or from the tests; it changes nothing.
create function public.stock_integrity_check()
returns table (problem text, detail jsonb)
language sql
stable
set search_path = ''
as $$
  select 'balance_mismatch', jsonb_build_object(
    'lot_id', coalesce(balance.lot_id, totals.lot_id),
    'location_id', coalesce(balance.location_id, totals.location_id),
    'balance', balance.quantity,
    'movements', totals.quantity
  )
  from public.stock_balances as balance
  full join (
    select movement.lot_id, movement.location_id, sum(movement.quantity_delta) as quantity
    from public.stock_movements as movement
    group by movement.lot_id, movement.location_id
  ) as totals
    on totals.lot_id = balance.lot_id and totals.location_id = balance.location_id
  where balance.quantity is distinct from totals.quantity

  union all
  select 'negative_balance', jsonb_build_object(
    'lot_id', balance.lot_id, 'location_id', balance.location_id, 'quantity', balance.quantity
  )
  from public.stock_balances as balance
  where balance.quantity < 0

  union all
  select 'negative_history', jsonb_build_object(
    'lot_id', history.lot_id, 'location_id', history.location_id,
    'lowest', min(history.running)
  )
  from (
    select
      movement.lot_id,
      movement.location_id,
      sum(movement.quantity_delta) over (
        partition by movement.lot_id, movement.location_id
        order by movement.doc_date, movement.seq
        rows between unbounded preceding and current row
      ) as running
    from public.stock_movements as movement
  ) as history
  group by history.lot_id, history.location_id
  having min(history.running) < 0

  union all
  select 'movement_mismatch', jsonb_build_object('movement_id', movement.id, 'document_id', movement.document_id)
  from public.stock_movements as movement
  join public.stock_lots as lot on lot.id = movement.lot_id
  join public.stock_documents as document on document.id = movement.document_id
  left join public.stock_documents as original on original.id = document.reverses_id
  where movement.product_id <> lot.product_id
    or movement.unit_cost_incl_vat is distinct from lot.unit_cost_incl_vat
    or movement.doc_date <> document.doc_date
    or movement.doc_date < lot.received_date
    or movement.movement_type <> coalesce(original.doc_type, document.doc_type)
    or movement.is_reversal <> (document.doc_type = 'reversal')

  union all
  select 'balance_product_mismatch', jsonb_build_object('balance_id', balance.id)
  from public.stock_balances as balance
  join public.stock_lots as lot on lot.id = balance.lot_id
  where balance.product_id <> lot.product_id

  union all
  select 'lot_not_base', jsonb_build_object('lot_id', lot.id)
  from public.stock_lots as lot
  join public.products as product on product.id = lot.product_id
  where product.product_type <> 'base'

  union all
  select 'document_without_lines', jsonb_build_object('document_id', document.id, 'doc_no', document.doc_no)
  from public.stock_documents as document
  where not exists (
    select 1 from public.stock_movements as movement where movement.document_id = document.id
  )

  union all
  select 'lot_without_receipt_line', jsonb_build_object('lot_id', lot.id, 'lot_no', lot.lot_no)
  from public.stock_lots as lot
  where not exists (
    select 1 from public.stock_movements as movement
    where movement.lot_id = lot.id
      and movement.document_id = lot.created_document_id
      and movement.quantity_delta > 0
  )

  union all
  -- Every line of an undone 전표 has exactly one opposite line in its 취소
  -- 전표, and the 취소 전표 has no other lines.
  select 'reversal_mismatch', jsonb_build_object('document_id', document.id, 'doc_no', document.doc_no)
  from public.stock_documents as document
  join public.stock_documents as original on original.id = document.reverses_id
  where original.reversed_by_id is distinct from document.id
    or exists (
      select 1
      from public.stock_movements as original_line
      where original_line.document_id = original.id
        and not exists (
          select 1
          from public.stock_movements as reversal_line
          where reversal_line.document_id = document.id
            and reversal_line.reverses_movement_id = original_line.id
            and reversal_line.lot_id = original_line.lot_id
            and reversal_line.location_id = original_line.location_id
            and reversal_line.quantity_delta = -original_line.quantity_delta
        )
    )
    or exists (
      select 1
      from public.stock_movements as reversal_line
      left join public.stock_movements as original_line
        on original_line.id = reversal_line.reverses_movement_id
      where reversal_line.document_id = document.id
        and (original_line.id is null or original_line.document_id <> original.id)
    )

  union all
  select 'reversal_mismatch', jsonb_build_object('document_id', document.id, 'doc_no', document.doc_no)
  from public.stock_documents as document
  left join public.stock_documents as reversal on reversal.id = document.reversed_by_id
  where document.reversed_by_id is not null
    and reversal.reverses_id is distinct from document.id
$$;

comment on function public.stock_integrity_check() is '재고 기록 점검: 현재 재고 = 전표 줄 합계, 음수 재고 없음(지난 날짜 포함), 줄·로트·전표·취소가 서로 맞는지. 문제가 없으면 빈 결과.';

-- -----------------------------------------------------------------------------
-- 11. Save functions (SECURITY DEFINER, see the top of this file)
--
-- Arguments are JSON in DB column names:
--   header: {"doc_date" (empty = today), "partner_id", "memo",
--            "request_id" (optional: the same save sent twice is saved once)}
--   lines:  see each function.
-- Each returns {"document_id", "doc_no", "doc_date", "doc_type",
-- "warnings": [...], …} — or the same for an earlier save with the same
-- request_id ("already_saved": true).
-- -----------------------------------------------------------------------------

-- One new-stock line (입고 and 실사 추가 lines, 기초재고 rows): checks it,
-- splits a 묶음상품 into its 기준상품, creates one lot per 기준상품 and its
-- line. line: {"product_id", "quantity", "location_id", "expiry_kind"
-- ('use_by' | 'sell_by' | 'none'), "expiry_date" (empty: worked out from
-- 제조일자 + 유통기한 기준일수 when both are known), "manufactured_date",
-- "lot_no" (empty = automatic), "supplier_lot_no", "unit_cost_incl_vat"
-- (per unit of the line's product, 부가세 포함), "origin", "memo"}.
-- Returns {"lots": [...], "warnings": [보관온도 불일치 …]}.
create function public.stock_receive_line(
  target_document public.stock_documents,
  line jsonb,
  line_no integer,
  list text,
  movement_line_no integer,
  lot_received_date date,
  lot_supplier_id uuid,
  allow_bundle boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  line_product_id uuid;
  product_row record;
  line_quantity numeric;
  line_location_id uuid;
  zone_storage public.storage_type;
  expiry_kind_text text;
  line_expiry_kind public.expiry_kind;
  line_expiry_date date;
  line_manufactured_date date;
  line_lot_no text;
  line_supplier_lot_no text;
  line_unit_cost bigint;
  line_origin text;
  line_memo text;
  component record;
  component_expiry date;
  created_lot public.stock_lots;
  extra jsonb := jsonb_build_object('list', list);
  lots jsonb[] := '{}';
  warnings jsonb[] := '{}';
begin
  line_product_id := public.read_stock_uuid(line -> 'product_id', true, line_no, 'product_id', '상품', list);
  -- Lock the product (a 묶음상품 with its 기준상품) until the save ends:
  -- its 단위 must not change while its lots are being made (see
  -- check_product_unit_change). One statement, ordered by id.
  perform 1
  from public.products as product
  where product.id = line_product_id
    or product.id in (
      select item.component_id
      from public.product_bundle_items as item
      where item.bundle_id = line_product_id
    )
  order by product.id
  for share;
  select product.id, product.code, product.name, product.product_type, product.unit, product.is_active,
    product.storage_type, product.shelf_life_days
  into product_row
  from public.products as product
  where product.id = line_product_id;
  if not found then
    perform public.raise_stock_error('상품을 찾을 수 없습니다. 상품을 다시 선택해 주세요.',
      'stock_product_not_found', line_no, 'product_id', '23503', extra);
  end if;
  if not product_row.is_active then
    perform public.raise_stock_error(
      format('사용중지된 상품(%s %s)은 입고할 수 없습니다.', product_row.code, product_row.name),
      'stock_product_inactive', line_no, 'product_id', '23514', extra);
  end if;
  if product_row.product_type <> 'base' and not allow_bundle then
    perform public.raise_stock_error(
      format('‘%s’은(는) 묶음상품입니다. 재고는 기준상품으로 등록해 주세요.', product_row.name),
      'stock_product_not_base', line_no, 'product_id', '23514', extra);
  end if;

  line_quantity := public.read_stock_quantity(
    line -> 'quantity', not public.unit_allows_fraction(product_row.unit), false,
    line_no, 'quantity', '수량', list
  );
  line_location_id := public.read_stock_uuid(line -> 'location_id', true, line_no, 'location_id', '위치', list);
  zone_storage := public.check_stock_input_location(line_location_id, line_no, 'location_id', list);

  expiry_kind_text := nullif(btrim(coalesce(line ->> 'expiry_kind', '')), '');
  if expiry_kind_text is null then
    perform public.raise_stock_error('기한 종류(소비기한/유통기한/없음)를 선택해 주세요.',
      'stock_expiry_kind_invalid', line_no, 'expiry_kind', '22023', extra);
  end if;
  if expiry_kind_text not in ('use_by', 'sell_by', 'none') then
    perform public.raise_stock_error('기한 종류는 소비기한, 유통기한, 없음 중에서 골라 주세요.',
      'stock_expiry_kind_invalid', line_no, 'expiry_kind', '22023', extra);
  end if;
  line_expiry_kind := expiry_kind_text::public.expiry_kind;
  line_expiry_date := public.read_stock_date(line -> 'expiry_date', line_no, 'expiry_date', '기한일', list);
  if line_expiry_kind = 'none' and line_expiry_date is not null then
    perform public.raise_stock_error('기한 종류가 ‘없음’이면 기한일을 비워 주세요.',
      'stock_expiry_date_unexpected', line_no, 'expiry_date', '22023', extra);
  end if;
  line_manufactured_date := public.read_stock_date(line -> 'manufactured_date', line_no, 'manufactured_date', '제조일자', list);
  if line_manufactured_date > lot_received_date then
    perform public.raise_stock_error(
      format('제조일자는 입고일(%s)보다 늦을 수 없습니다.', lot_received_date),
      'stock_manufactured_after_receipt', line_no, 'manufactured_date', '22023', extra);
  end if;
  line_lot_no := public.read_stock_text(line -> 'lot_no', 40, line_no, 'lot_no', '로트번호', list);
  line_supplier_lot_no := public.read_stock_text(line -> 'supplier_lot_no', 40, line_no, 'supplier_lot_no', '공급처 로트번호', list);
  line_unit_cost := public.read_stock_amount(line -> 'unit_cost_incl_vat', line_no, 'unit_cost_incl_vat', '입고단가', list);
  line_origin := public.read_stock_text(line -> 'origin', 100, line_no, 'origin', '원산지', list);
  line_memo := public.read_stock_text(line -> 'memo', 500, line_no, 'memo', '메모', list);

  -- A 기준상품 is its own only part; a 묶음상품 is split by its 구성표.
  for component in
    select
      product_row.id as product_id, product_row.code as code, product_row.name as name,
      product_row.unit as unit, product_row.storage_type as storage_type,
      product_row.shelf_life_days as shelf_life_days, true as is_active,
      line_quantity as quantity, line_unit_cost as unit_cost_incl_vat, 'direct' as cost_rule
    where product_row.product_type = 'base'
    union all
    select *
    from jsonb_to_recordset(
      case
        when product_row.product_type = 'bundle'
          then public.stock_bundle_components(line_product_id, line_quantity, line_unit_cost)
        else '[]'::jsonb
      end
    ) as item (
      product_id uuid, code text, name text, unit text, storage_type public.storage_type,
      shelf_life_days integer, is_active boolean, quantity numeric, unit_cost_incl_vat bigint,
      cost_rule text
    )
  loop
    if not public.unit_allows_fraction(component.unit)
      and component.quantity <> trunc(component.quantity) then
      perform public.raise_stock_error(
        format('‘%s’은(는) %s 단위라 정수로만 입고할 수 있습니다. 묶음상품 수량을 정수로 입력해 주세요.', component.name, component.unit),
        'stock_quantity_not_whole', line_no, 'quantity', '22023', extra);
    end if;
    if component.quantity > 100000000 then
      perform public.raise_stock_error(
        format('‘%s’의 수량이 100,000,000을 넘습니다. 수량을 줄여 주세요.', component.name),
        'stock_quantity_too_large', line_no, 'quantity', '22023', extra);
    end if;

    component_expiry := line_expiry_date;
    if line_expiry_kind <> 'none' and component_expiry is null then
      component_expiry := public.stock_expiry_from_manufactured(line_manufactured_date, component.shelf_life_days);
      if component_expiry is null then
        perform public.raise_stock_error(
          format('‘%s’의 기한일을 입력해 주세요. (제조일자와 상품의 유통기한 기준일수가 있으면 자동으로 계산합니다.)', component.name),
          'stock_expiry_date_required', line_no, 'expiry_date', '22023', extra);
      end if;
    end if;
    if line_manufactured_date is not null and component_expiry < line_manufactured_date then
      perform public.raise_stock_error('기한일은 제조일자보다 빠를 수 없습니다.',
        'stock_expiry_before_manufactured', line_no, 'expiry_date', '22023', extra);
    end if;

    created_lot := public.create_stock_lot(
      component.product_id, line_lot_no, line_supplier_lot_no, line_expiry_kind, component_expiry,
      line_manufactured_date, lot_received_date, component.unit_cost_incl_vat, lot_supplier_id,
      line_origin, line_memo, target_document, line_no, list
    );
    insert into public.stock_movements (
      document_id, line_no, lot_id, location_id, quantity_delta, bundle_id, bundle_quantity,
      bundle_unit_cost_incl_vat, memo
    )
    values (
      target_document.id,
      movement_line_no,
      created_lot.id,
      line_location_id,
      component.quantity,
      case when product_row.product_type = 'bundle' then line_product_id end,
      case when product_row.product_type = 'bundle' then line_quantity end,
      -- The 단가 typed per 묶음상품 (the 전표's value uses it, exactly).
      case when product_row.product_type = 'bundle' then line_unit_cost end,
      line_memo
    );

    lots := array_append(lots, jsonb_build_object(
      'line', line_no,
      'lot_id', created_lot.id,
      'lot_no', created_lot.lot_no,
      'product_id', component.product_id,
      'product_code', component.code,
      'product_name', component.name,
      'unit', component.unit,
      'quantity', component.quantity,
      'expiry_kind', created_lot.expiry_kind,
      'expiry_date', created_lot.expiry_date,
      'unit_cost_incl_vat', created_lot.unit_cost_incl_vat,
      'cost_rule', component.cost_rule
    ));
    if component.storage_type <> zone_storage then
      warnings := array_append(warnings, jsonb_build_object(
        'type', 'storage_mismatch',
        'line', line_no,
        'list', list,
        'product_id', component.product_id,
        'product_code', component.code,
        'product_name', component.name,
        'product_storage_type', component.storage_type,
        'zone_storage_type', zone_storage,
        'location_id', line_location_id,
        'location_label', (select info.label from public.stock_location_info(line_location_id) as info),
        'too_warm', zone_storage < component.storage_type
      ));
    end if;
  end loop;

  return jsonb_build_object('lots', to_jsonb(lots), 'warnings', to_jsonb(warnings));
end;
$$;

comment on function public.stock_receive_line(public.stock_documents, jsonb, integer, text, integer, date, uuid, boolean) is '새 재고 줄 하나(입고·실사 추가·기초재고)를 확인하고 기준상품별 로트와 원장 줄을 만듭니다 (묶음상품은 구성 기준상품으로 나눔).';

-- The partner of a 전표: must exist and be 사용; for 입고 a 매입처 (or
-- 매출·매입).
create function public.check_stock_partner(target_partner_id uuid, supplier_only boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  partner_row record;
begin
  select partner.partner_type, partner.is_active, partner.name into partner_row
  from public.partners as partner
  where partner.id = target_partner_id
  for share;
  if not found then
    perform public.raise_stock_error('거래처를 찾을 수 없습니다. 거래처를 다시 선택해 주세요.',
      'stock_partner_not_found', null, 'partner_id', '23503');
  end if;
  if not partner_row.is_active then
    perform public.raise_stock_error(
      format('미사용 거래처(%s)는 새 전표에 고를 수 없습니다.', partner_row.name),
      'stock_partner_inactive', null, 'partner_id', '23514');
  end if;
  if supplier_only and partner_row.partner_type not in ('purchase', 'both') then
    perform public.raise_stock_error('입고의 거래처는 매입처(또는 매출·매입) 거래처만 고를 수 있습니다.',
      'stock_partner_not_supplier', null, 'partner_id', '23514');
  end if;
end;
$$;

comment on function public.check_stock_partner(uuid, boolean) is '전표의 거래처가 있고 사용 중인지 (입고는 매입처·매출매입만) 확인합니다.';

-- Checks the header object of a save.
create function public.check_stock_header(header jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if header is null or jsonb_typeof(header) <> 'object' then
    perform public.raise_stock_error(
      '전표 내용을 읽을 수 없습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.',
      'stock_header_invalid', null, null, '22023');
  end if;
end;
$$;

comment on function public.check_stock_header(jsonb) is '재고 저장 함수: 전표 머리(header)가 JSON 객체인지 확인합니다.';

-- 입고 등록.
-- header: {"doc_date", "partner_id" (매입처, optional), "memo", "request_id"}
-- lines: [{"product_id" (기준상품 or 묶음상품), "quantity", "location_id",
--          "expiry_kind", "expiry_date", "manufactured_date", "lot_no",
--          "supplier_lot_no", "unit_cost_incl_vat", "origin", "memo"}, …]
--   (see stock_receive_line). Each 기준상품 gets a new lot (입고일 = 전표
--   일자, 매입처 = the header's partner).
-- Returns {"document_id", "doc_no", "doc_date", "doc_type", "lots",
--          "warnings" (보관온도 불일치: saved anyway)}.
create function public.receive_stock(header jsonb, lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  receipt_date date;
  partner uuid;
  header_memo text;
  document public.stock_documents;
  entry record;
  line_result jsonb;
  lots jsonb[] := '{}';
  warnings jsonb[] := '{}';
begin
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;
  receipt_date := public.read_stock_doc_date(header -> 'doc_date');
  partner := public.read_stock_uuid(header -> 'partner_id', false, null, 'partner_id', '매입처');
  if partner is not null then
    perform public.check_stock_partner(partner, true);
  end if;
  header_memo := public.read_stock_text(header -> 'memo', 500, null, 'memo', '메모');
  perform public.check_stock_lines(lines, false);

  document := public.create_stock_document('receipt', receipt_date, partner, header_memo, null, header);
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    line_result := public.stock_receive_line(
      document, entry.value, entry.ordinality::integer, 'lines', entry.ordinality::integer,
      receipt_date, partner, true
    );
    lots := lots || array(select item.value from jsonb_array_elements(line_result -> 'lots') as item (value));
    warnings := warnings || array(select item.value from jsonb_array_elements(line_result -> 'warnings') as item (value));
  end loop;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'lots', to_jsonb(lots),
    'warnings', to_jsonb(warnings)
  );
end;
$$;

comment on function public.receive_stock(jsonb, jsonb) is '입고 등록: 줄마다 기준상품 로트를 만들어 위치에 넣습니다 (묶음상품은 구성 기준상품으로 나눔, 단가 부가세 포함). 보관온도 불일치는 warnings로 알립니다.';

-- 출고 등록 (manual 출고 now; later the 주문 module calls it too).
-- header: {"doc_date", "partner_id" (any 사용 거래처, optional), "memo",
--          "request_id"}
-- lines: [{"product_id" (기준상품 or 묶음상품), "quantity", "warehouse_id"?,
--          "zone_id"?, "location_id"? (only stock there), "memo"}, …]
-- The lots are chosen by FEFO (stock_issue_plan): the same plan
-- plan_stock_issue shows, computed again here after locking the lots.
-- Not enough stock → error stock_insufficient naming the product and the
-- quantity that can go out (nothing saved).
-- Returns {"document_id", "doc_no", "doc_date", "doc_type", "plan",
--          "warnings": []}.
create function public.issue_stock(header jsonb, lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  issue_date date;
  partner uuid;
  header_memo text;
  document public.stock_documents;
  entry record;
  product_ids uuid[] := '{}';
  line_product_id uuid;
  locked_lot_ids uuid[];
  plan jsonb;
  plan_line jsonb;
  demand jsonb;
  allocation jsonb;
  short_demand jsonb;
  short_notes text[];
  line_memos text[] := '{}';
  pair record;
begin
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;
  issue_date := public.read_stock_doc_date(header -> 'doc_date');
  partner := public.read_stock_uuid(header -> 'partner_id', false, null, 'partner_id', '거래처');
  if partner is not null then
    perform public.check_stock_partner(partner, false);
  end if;
  header_memo := public.read_stock_text(header -> 'memo', 500, null, 'memo', '메모');
  perform public.check_stock_lines(lines, false);

  -- The 기준상품 of every line (a 묶음상품's 구성) and the lines' memos.
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    line_product_id := public.read_stock_uuid(entry.value -> 'product_id', true, entry.ordinality::integer, 'product_id', '상품');
    product_ids := product_ids || line_product_id || array(
      select item.component_id from public.product_bundle_items as item where item.bundle_id = line_product_id
    );
    line_memos := line_memos || public.read_stock_text(entry.value -> 'memo', 500, entry.ordinality::integer, 'memo', '메모');
  end loop;

  -- Lock every lot of these products that has stock now (ordered by id),
  -- then plan with the quantities after the lock.
  select array_agg(distinct balance.lot_id) into locked_lot_ids
  from public.stock_balances as balance
  where balance.product_id = any (product_ids) and balance.quantity > 0;
  perform public.lock_stock_lots(coalesce(locked_lot_ids, '{}'));
  plan := public.stock_issue_plan(lines, issue_date, false, coalesce(locked_lot_ids, '{}'));

  if not (plan ->> 'ok')::boolean then
    for plan_line in select value from jsonb_array_elements(plan -> 'lines') loop
      short_demand := null;
      select value into short_demand
      from jsonb_array_elements(plan_line -> 'demands')
      where (value ->> 'shortage')::numeric > 0
      limit 1;
      if short_demand is not null then
        -- What the quantity that can go out leaves out: stock other lines
        -- of this 전표 were given first, and stock past its 기한.
        short_notes := array_remove(array[
          case
            when (short_demand ->> 'taken_by_other_lines')::numeric > 0 then
              format('같은 전표의 다른 줄에 먼저 배정한 %s %s',
                public.stock_quantity_text((short_demand ->> 'taken_by_other_lines')::numeric),
                short_demand ->> 'unit')
          end,
          case
            when (short_demand ->> 'expired_excluded')::numeric > 0 then
              format('기한이 지난 재고 %s %s',
                public.stock_quantity_text((short_demand ->> 'expired_excluded')::numeric),
                short_demand ->> 'unit')
          end
        ], null);
        perform public.raise_stock_error(
          format('‘%s’ 재고가 부족합니다. 필요 %s %s, 출고할 수 있는 수량 %s %s%s.',
            short_demand ->> 'name',
            public.stock_quantity_text((short_demand ->> 'quantity')::numeric), short_demand ->> 'unit',
            public.stock_quantity_text((short_demand ->> 'available')::numeric), short_demand ->> 'unit',
            case
              when cardinality(short_notes) > 0 then ' (' || array_to_string(short_notes, ', ') || ' 제외)'
              else ''
            end),
          'stock_insufficient', (plan_line ->> 'line')::integer, 'quantity', '23514',
          jsonb_build_object(
            'product_id', short_demand ->> 'product_id',
            'requested', (short_demand ->> 'quantity')::numeric,
            'available', (short_demand ->> 'available')::numeric,
            'expired_excluded', (short_demand ->> 'expired_excluded')::numeric,
            'taken_by_other_lines', (short_demand ->> 'taken_by_other_lines')::numeric
          )
        );
      end if;
    end loop;
  end if;

  document := public.create_stock_document('issue', issue_date, partner, header_memo, null, header);
  for plan_line in select value from jsonb_array_elements(plan -> 'lines') loop
    for demand in select value from jsonb_array_elements(plan_line -> 'demands') loop
      for allocation in select value from jsonb_array_elements(demand -> 'allocations') loop
        insert into public.stock_movements (
          document_id, line_no, lot_id, location_id, quantity_delta, bundle_id, bundle_quantity, memo
        )
        values (
          document.id,
          (plan_line ->> 'line')::integer,
          (allocation ->> 'lot_id')::uuid,
          (allocation ->> 'location_id')::uuid,
          -((allocation ->> 'quantity')::numeric),
          case when plan_line ->> 'product_type' = 'bundle' then (plan_line ->> 'product_id')::uuid end,
          case when plan_line ->> 'product_type' = 'bundle' then (plan_line ->> 'quantity')::numeric end,
          line_memos[(plan_line ->> 'line')::integer]
        );
      end loop;
    end loop;
  end loop;

  -- A back-dated 출고 must not leave a gap in any later day.
  if issue_date < public.stock_today() then
    for pair in
      select distinct movement.lot_id, movement.location_id, min(movement.line_no) as line_no
      from public.stock_movements as movement
      where movement.document_id = document.id
      group by movement.lot_id, movement.location_id
    loop
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no);
    end loop;
  end if;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'plan', plan,
    'warnings', '[]'::jsonb
  );
end;
$$;

comment on function public.issue_stock(jsonb, jsonb) is '출고 등록: FEFO(기한 빠른 로트부터, 기한 경과 제외)로 로트·위치를 골라 꺼냅니다. 재고가 부족하면 상품과 출고 가능 수량을 알리고 아무것도 저장하지 않습니다.';

-- 폐기 등록.
-- header: {"doc_date", "memo", "request_id"}
-- lines: [{"lot_id", "location_id", "quantity", "reason" ('expired' |
--          'damaged' | 'quality' | 'other'), "memo" (required for
--          'other')}, …]
create function public.dispose_stock(header jsonb, lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  disposal_date date;
  header_memo text;
  document public.stock_documents;
  entry record;
  lot_ids uuid[] := '{}';
  line_lot_id uuid;
  line_location_id uuid;
  lot_row record;
  line_quantity numeric;
  available numeric;
  reason_text text;
  line_memo text;
  pair record;
begin
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;
  disposal_date := public.read_stock_doc_date(header -> 'doc_date');
  header_memo := public.read_stock_text(header -> 'memo', 500, null, 'memo', '메모');
  perform public.check_stock_lines(lines, false);

  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    lot_ids := lot_ids || public.read_stock_uuid(entry.value -> 'lot_id', true, entry.ordinality::integer, 'lot_id', '로트');
  end loop;
  perform public.lock_stock_lots(lot_ids);

  document := public.create_stock_document('disposal', disposal_date, null, header_memo, null, header);
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    line_lot_id := (entry.value ->> 'lot_id')::uuid;
    select lot.id, lot.lot_no, lot.received_date, product.name, product.unit into lot_row
    from public.stock_lots as lot
    join public.products as product on product.id = lot.product_id
    where lot.id = line_lot_id;
    if not found then
      perform public.raise_stock_error('로트를 찾을 수 없습니다. 목록에서 다시 골라 주세요.',
        'stock_lot_not_found', entry.ordinality::integer, 'lot_id', '23503');
    end if;
    if disposal_date < lot_row.received_date then
      perform public.raise_stock_error(
        format('로트 %s는 %s에 입고되어 그 전 날짜로 폐기할 수 없습니다. 전표 일자를 확인해 주세요.', lot_row.lot_no, lot_row.received_date),
        'stock_date_before_receipt', entry.ordinality::integer, 'lot_id', '23514');
    end if;
    line_location_id := public.read_stock_uuid(entry.value -> 'location_id', true, entry.ordinality::integer, 'location_id', '위치');
    line_quantity := public.read_stock_quantity(
      entry.value -> 'quantity', not public.unit_allows_fraction(lot_row.unit), false,
      entry.ordinality::integer, 'quantity', '폐기 수량'
    );
    reason_text := nullif(btrim(coalesce(entry.value ->> 'reason', '')), '');
    if reason_text is null then
      perform public.raise_stock_error('폐기 사유를 골라 주세요.', 'stock_reason_required',
        entry.ordinality::integer, 'reason', '22023');
    end if;
    if reason_text not in ('expired', 'damaged', 'quality', 'other') then
      perform public.raise_stock_error('폐기 사유는 기한 경과, 파손, 품질 불량, 기타 중에서 골라 주세요.',
        'stock_reason_invalid', entry.ordinality::integer, 'reason', '22023');
    end if;
    line_memo := public.read_stock_text(entry.value -> 'memo', 500, entry.ordinality::integer, 'memo', '메모');
    if reason_text = 'other' and line_memo is null then
      perform public.raise_stock_error('폐기 사유가 ‘기타’이면 메모에 사유를 적어 주세요.',
        'stock_reason_memo_required', entry.ordinality::integer, 'memo', '22023');
    end if;

    -- Earlier lines of this 전표 are saved already, so the quantity read
    -- here is what is left after them.
    available := case
        when disposal_date >= public.stock_today() then coalesce((
          select balance.quantity from public.stock_balances as balance
          where balance.lot_id = line_lot_id and balance.location_id = line_location_id
        ), 0)
        else public.stock_available_from(line_lot_id, line_location_id, disposal_date)
      end;
    if line_quantity > available then
      perform public.raise_stock_error(
        format('폐기할 수량이 남은 재고보다 많습니다: %s 로트 %s, %s (남은 수량 %s %s).',
          lot_row.name, lot_row.lot_no,
          coalesce((select info.label from public.stock_location_info(line_location_id) as info), '-'),
          public.stock_quantity_text(greatest(available, 0)), lot_row.unit),
        'stock_insufficient', entry.ordinality::integer, 'quantity', '23514',
        jsonb_build_object('available', greatest(available, 0), 'requested', line_quantity));
    end if;
    insert into public.stock_movements (
      document_id, line_no, lot_id, location_id, quantity_delta, reason, memo
    )
    values (
      document.id, entry.ordinality::integer, line_lot_id, line_location_id, -line_quantity,
      reason_text::public.disposal_reason, line_memo
    );
  end loop;

  if disposal_date < public.stock_today() then
    for pair in
      select movement.lot_id, movement.location_id, min(movement.line_no) as line_no
      from public.stock_movements as movement
      where movement.document_id = document.id
      group by movement.lot_id, movement.location_id
    loop
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no);
    end loop;
  end if;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'warnings', '[]'::jsonb
  );
end;
$$;

comment on function public.dispose_stock(jsonb, jsonb) is '폐기 등록: 고른 로트 × 위치에서 수량을 빼고 사유(기한 경과/파손/품질 불량/기타+메모)를 남깁니다. 남은 재고보다 많이 뺄 수 없습니다.';

-- 재고처간 이동 등록.
-- header: {"doc_date", "memo", "request_id"}
-- lines: [{"lot_id", "from_location_id", "to_location_id", "quantity",
--          "memo"}, …] — the 위치 it goes to must be 사용 (with its 구역 and
--          창고). Each line is two ledger lines (− from, + to).
-- A 구역 with another 보관온도 than the product is allowed but listed in
-- "warnings" (the screen shows stock_transfer_warnings before saving).
create function public.transfer_stock(header jsonb, lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  transfer_date date;
  header_memo text;
  document public.stock_documents;
  entry record;
  lot_ids uuid[] := '{}';
  line_no integer;
  line_lot_id uuid;
  from_location uuid;
  to_location uuid;
  lot_row record;
  line_quantity numeric;
  available numeric;
  line_memo text;
  zone_storage public.storage_type;
  pair record;
  warnings jsonb[] := '{}';
begin
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;
  transfer_date := public.read_stock_doc_date(header -> 'doc_date');
  header_memo := public.read_stock_text(header -> 'memo', 500, null, 'memo', '메모');
  perform public.check_stock_lines(lines, false);

  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    lot_ids := lot_ids || public.read_stock_uuid(entry.value -> 'lot_id', true, entry.ordinality::integer, 'lot_id', '로트');
  end loop;
  perform public.lock_stock_lots(lot_ids);

  document := public.create_stock_document('transfer', transfer_date, null, header_memo, null, header);
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    line_no := entry.ordinality::integer;
    line_lot_id := (entry.value ->> 'lot_id')::uuid;
    select lot.id, lot.lot_no, lot.received_date, product.id as product_id, product.code,
      product.name, product.unit, product.storage_type
    into lot_row
    from public.stock_lots as lot
    join public.products as product on product.id = lot.product_id
    where lot.id = line_lot_id;
    if not found then
      perform public.raise_stock_error('로트를 찾을 수 없습니다. 목록에서 다시 골라 주세요.',
        'stock_lot_not_found', line_no, 'lot_id', '23503');
    end if;
    if transfer_date < lot_row.received_date then
      perform public.raise_stock_error(
        format('로트 %s는 %s에 입고되어 그 전 날짜로 이동할 수 없습니다. 전표 일자를 확인해 주세요.', lot_row.lot_no, lot_row.received_date),
        'stock_date_before_receipt', line_no, 'lot_id', '23514');
    end if;
    from_location := public.read_stock_uuid(entry.value -> 'from_location_id', true, line_no, 'from_location_id', '보내는 위치');
    to_location := public.read_stock_uuid(entry.value -> 'to_location_id', true, line_no, 'to_location_id', '받는 위치');
    if from_location = to_location then
      perform public.raise_stock_error('보내는 위치와 받는 위치가 같습니다. 받는 위치를 다시 골라 주세요.',
        'stock_location_same', line_no, 'to_location_id', '22023');
    end if;
    zone_storage := public.check_stock_input_location(to_location, line_no, 'to_location_id');
    line_quantity := public.read_stock_quantity(
      entry.value -> 'quantity', not public.unit_allows_fraction(lot_row.unit), false,
      line_no, 'quantity', '이동 수량'
    );
    line_memo := public.read_stock_text(entry.value -> 'memo', 500, line_no, 'memo', '메모');

    -- Earlier lines of this 전표 are saved already (see dispose_stock).
    available := case
        when transfer_date >= public.stock_today() then coalesce((
          select balance.quantity from public.stock_balances as balance
          where balance.lot_id = line_lot_id and balance.location_id = from_location
        ), 0)
        else public.stock_available_from(line_lot_id, from_location, transfer_date)
      end;
    if line_quantity > available then
      perform public.raise_stock_error(
        format('이동할 수량이 남은 재고보다 많습니다: %s 로트 %s, %s (남은 수량 %s %s).',
          lot_row.name, lot_row.lot_no,
          coalesce((select info.label from public.stock_location_info(from_location) as info), '-'),
          public.stock_quantity_text(greatest(available, 0)), lot_row.unit),
        'stock_insufficient', line_no, 'quantity', '23514',
        jsonb_build_object('available', greatest(available, 0), 'requested', line_quantity));
    end if;
    insert into public.stock_movements (document_id, line_no, lot_id, location_id, quantity_delta, memo)
    values (document.id, line_no, line_lot_id, from_location, -line_quantity, line_memo);
    insert into public.stock_movements (document_id, line_no, lot_id, location_id, quantity_delta, memo)
    values (document.id, line_no, line_lot_id, to_location, line_quantity, line_memo);

    if zone_storage <> lot_row.storage_type then
      warnings := array_append(warnings, jsonb_build_object(
        'type', 'storage_mismatch',
        'line', line_no,
        'lot_id', line_lot_id,
        'lot_no', lot_row.lot_no,
        'product_id', lot_row.product_id,
        'product_code', lot_row.code,
        'product_name', lot_row.name,
        'product_storage_type', lot_row.storage_type,
        'zone_storage_type', zone_storage,
        'location_id', to_location,
        'location_label', (select info.label from public.stock_location_info(to_location) as info),
        'too_warm', zone_storage < lot_row.storage_type
      ));
    end if;
  end loop;

  if transfer_date < public.stock_today() then
    for pair in
      select movement.lot_id, movement.location_id, min(movement.line_no) as line_no
      from public.stock_movements as movement
      where movement.document_id = document.id and movement.quantity_delta < 0
      group by movement.lot_id, movement.location_id
    loop
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no);
    end loop;
  end if;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'warnings', to_jsonb(warnings)
  );
end;
$$;

comment on function public.transfer_stock(jsonb, jsonb) is '재고처간 이동: 로트를 한 위치에서 다른 위치로 옮깁니다 (받는 위치는 사용 중이어야 함). 보관온도가 다른 구역이면 warnings로 알립니다.';

-- 실사재고조정 (stock count).
-- header: {"doc_date" (the count date), "memo" (사유), "request_id"}
-- lines: [{"lot_id", "location_id", "system_quantity" (the quantity the
--          screen showed for the end of doc_date), "counted_quantity"
--          (0 or more), "memo"}, …]
-- new_lots: stock found that has no lot yet: [{"product_id" (기준상품),
--          "location_id", "quantity", "expiry_kind", "expiry_date",
--          "manufactured_date", "lot_no", "supplier_lot_no",
--          "unit_cost_incl_vat", "origin", "memo"}, …] (입고일 = doc_date).
-- Only differences are saved (counted − system as a + or − line). When the
-- stock changed after the screen read it (system_quantity is not the
-- quantity now), nothing is saved (stock_count_changed: read the 실사
-- 목록 again). No difference at all → stock_count_no_difference. A line
-- that puts stock where its lot had none that day needs a 사용 위치 (like
-- 입고; stock_location_inactive).
-- Returns {"document_id", "doc_no", "doc_date", "doc_type", "increased",
--          "decreased", "unchanged", "lots" (new lots), "warnings"}.
create function public.apply_stock_count(
  header jsonb,
  lines jsonb,
  new_lots jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  count_date date;
  header_memo text;
  document public.stock_documents;
  entry record;
  lot_ids uuid[] := '{}';
  line_no integer;
  line_lot_id uuid;
  line_location_id uuid;
  lot_row record;
  current_quantity numeric;
  system_quantity numeric;
  counted_quantity numeric;
  line_memo text;
  seen text[] := '{}';
  pair_key text;
  increased integer := 0;
  decreased integer := 0;
  unchanged integer := 0;
  line_count integer;
  line_result jsonb;
  lots jsonb[] := '{}';
  warnings jsonb[] := '{}';
  pair record;
begin
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;
  count_date := public.read_stock_doc_date(header -> 'doc_date');
  header_memo := public.read_stock_text(header -> 'memo', 500, null, 'memo', '사유');
  new_lots := coalesce(new_lots, '[]'::jsonb);
  perform public.check_stock_lines(lines, true, 'lines');
  perform public.check_stock_lines(new_lots, true, 'new_lots');
  if jsonb_array_length(lines) + jsonb_array_length(new_lots) = 0 then
    perform public.raise_stock_error('실사한 줄이 없습니다.', 'stock_lines_empty', null, 'lines', '22023');
  end if;
  if jsonb_array_length(lines) + jsonb_array_length(new_lots) > 3000 then
    perform public.raise_stock_error('실사 전표 하나에 3,000줄까지 넣을 수 있습니다. 나눠서 등록해 주세요.',
      'stock_too_many_lines', null, 'lines', '22023');
  end if;
  line_count := jsonb_array_length(lines);

  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    lot_ids := lot_ids || public.read_stock_uuid(entry.value -> 'lot_id', true, entry.ordinality::integer, 'lot_id', '로트', 'lines');
  end loop;
  perform public.lock_stock_lots(lot_ids);

  document := public.create_stock_document('count', count_date, null, header_memo, null, header);
  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(lines) with ordinality as item (value, ordinality)
  loop
    line_no := entry.ordinality::integer;
    line_lot_id := (entry.value ->> 'lot_id')::uuid;
    select lot.id, lot.lot_no, lot.received_date, product.name, product.unit into lot_row
    from public.stock_lots as lot
    join public.products as product on product.id = lot.product_id
    where lot.id = line_lot_id;
    if not found then
      perform public.raise_stock_error('로트를 찾을 수 없습니다. 실사 목록을 다시 불러와 주세요.',
        'stock_lot_not_found', line_no, 'lot_id', '23503', jsonb_build_object('list', 'lines'));
    end if;
    line_location_id := public.read_stock_uuid(entry.value -> 'location_id', true, line_no, 'location_id', '위치', 'lines');
    if not exists (select 1 from public.storage_locations as location where location.id = line_location_id) then
      perform public.raise_stock_error('위치를 찾을 수 없습니다. 실사 목록을 다시 불러와 주세요.',
        'stock_location_not_found', line_no, 'location_id', '23503', jsonb_build_object('list', 'lines'));
    end if;
    pair_key := line_lot_id::text || ':' || line_location_id::text;
    if pair_key = any (seen) then
      perform public.raise_stock_error(
        format('같은 로트(%s)·위치가 두 번 들어 있습니다. 한 줄로 합쳐 주세요.', lot_row.lot_no),
        'stock_line_duplicate', line_no, 'lot_id', '22023', jsonb_build_object('list', 'lines'));
    end if;
    seen := seen || pair_key;

    system_quantity := public.read_stock_quantity(
      entry.value -> 'system_quantity', false, true, line_no, 'system_quantity', '전산 수량', 'lines'
    );
    counted_quantity := public.read_stock_quantity(
      entry.value -> 'counted_quantity', not public.unit_allows_fraction(lot_row.unit), true,
      line_no, 'counted_quantity', '실사 수량', 'lines'
    );
    line_memo := public.read_stock_text(entry.value -> 'memo', 500, line_no, 'memo', '메모', 'lines');
    if count_date < lot_row.received_date then
      perform public.raise_stock_error(
        format('로트 %s는 %s에 입고되어 그 전 날짜로 실사할 수 없습니다.', lot_row.lot_no, lot_row.received_date),
        'stock_date_before_receipt', line_no, 'lot_id', '23514', jsonb_build_object('list', 'lines'));
    end if;

    current_quantity := public.stock_balance_as_of(line_lot_id, line_location_id, count_date);
    if current_quantity <> system_quantity then
      perform public.raise_stock_error(
        format('실사 목록을 불러온 뒤에 %s 로트 %s의 재고가 바뀌었습니다 (불러올 때 %s → 지금 %s %s). 실사 목록을 다시 불러와 주세요.',
          lot_row.name, lot_row.lot_no,
          public.stock_quantity_text(system_quantity), public.stock_quantity_text(current_quantity), lot_row.unit),
        'stock_count_changed', line_no, 'system_quantity', '23514',
        jsonb_build_object('list', 'lines', 'current_quantity', current_quantity));
    end if;

    -- Stock appearing where the lot had none that day is new stock at that
    -- 위치: like 입고, only into a 위치 whose 위치, 구역 and 창고 are 사용.
    -- (The 실사 목록 lists only lots with stock; found stock without a lot
    -- there goes to new_lots, which checks the same.)
    if current_quantity = 0 and counted_quantity > 0 then
      perform public.check_stock_input_location(line_location_id, line_no, 'location_id', 'lines');
    end if;

    -- A back-dated decrease must leave enough for the lines dated after it.
    if count_date < public.stock_today()
      and counted_quantity < current_quantity
      and current_quantity - counted_quantity
        > public.stock_available_from(line_lot_id, line_location_id, count_date) then
      perform public.raise_stock_error(
        format('%s 이후에 이 로트(%s %s)에서 나간 재고가 있어, 그 날짜로 %s %s까지 줄일 수 없습니다. 오늘 날짜로 실사해 주세요.',
          count_date, lot_row.name, lot_row.lot_no,
          public.stock_quantity_text(counted_quantity), lot_row.unit),
        'stock_history_negative', line_no, 'counted_quantity', '23514',
        jsonb_build_object('list', 'lines'));
    end if;

    if counted_quantity = current_quantity then
      unchanged := unchanged + 1;
    else
      insert into public.stock_movements (document_id, line_no, lot_id, location_id, quantity_delta, memo)
      values (document.id, line_no, line_lot_id, line_location_id, counted_quantity - current_quantity, line_memo);
      if counted_quantity > current_quantity then
        increased := increased + 1;
      else
        decreased := decreased + 1;
      end if;
    end if;
  end loop;

  for entry in
    select item.value, item.ordinality
    from jsonb_array_elements(new_lots) with ordinality as item (value, ordinality)
  loop
    line_result := public.stock_receive_line(
      document, entry.value, entry.ordinality::integer, 'new_lots',
      line_count + entry.ordinality::integer, count_date, null, false
    );
    lots := lots || array(select item.value from jsonb_array_elements(line_result -> 'lots') as item (value));
    warnings := warnings || array(select item.value from jsonb_array_elements(line_result -> 'warnings') as item (value));
    increased := increased + 1;
  end loop;

  if increased + decreased = 0 then
    perform public.raise_stock_error('실사 수량이 전산 수량과 모두 같아 조정할 내용이 없습니다.',
      'stock_count_no_difference', null, 'lines', '23514');
  end if;

  if count_date < public.stock_today() then
    for pair in
      select movement.lot_id, movement.location_id, min(movement.line_no) as line_no
      from public.stock_movements as movement
      where movement.document_id = document.id and movement.quantity_delta < 0
      group by movement.lot_id, movement.location_id
    loop
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no, 'lines');
    end loop;
  end if;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'increased', increased,
    'decreased', decreased,
    'unchanged', unchanged,
    'lots', to_jsonb(lots),
    'warnings', to_jsonb(warnings)
  );
end;
$$;

comment on function public.apply_stock_count(jsonb, jsonb, jsonb) is '실사재고조정: 실사 수량과 전산 수량의 차이만 +/- 조정하고, 새로 발견한 재고는 새 로트로 넣습니다. 불러온 뒤 재고가 바뀌었으면 저장하지 않습니다.';

-- 취소 (undo a 전표).
-- target_document_id: the 전표 to undo. header: {"doc_date" (empty =
-- today; not before the original 전표 date), "memo" (empty = "<전표번호>
-- 취소"), "request_id"}.
-- Creates a 취소 전표 with the opposite of every line and marks both. Only
-- when the stock it takes back is still there (e.g. a 입고 whose stock was
-- partly issued cannot be undone: undo the 출고 first). A 취소 전표 and an
-- already undone 전표 cannot be undone.
create function public.reverse_stock_document(
  target_document_id uuid,
  header jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  original public.stock_documents;
  reversal_date date;
  header_memo text;
  document public.stock_documents;
  pair record;
  available numeric;
  lot_info record;
begin
  header := coalesce(header, '{}'::jsonb);
  perform public.check_stock_header(header);
  existing := public.find_stock_request(header);
  if existing is not null then
    return existing;
  end if;

  select * into original
  from public.stock_documents as document_row
  where document_row.id = target_document_id
  for update;
  if not found then
    perform public.raise_stock_error('전표를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.',
      'stock_document_not_found', null, 'document_id', '23503');
  end if;
  if original.doc_type = 'reversal' then
    perform public.raise_stock_error('취소 전표는 다시 취소할 수 없습니다. 필요하면 원래 내용으로 새 전표를 등록해 주세요.',
      'stock_reversal_of_reversal', null, 'document_id', '23514');
  end if;
  if original.reversed_by_id is not null then
    perform public.raise_stock_error(
      format('이미 취소된 전표입니다 (%s).',
        (select reversal.doc_no from public.stock_documents as reversal where reversal.id = original.reversed_by_id)),
      'stock_document_already_reversed', null, 'document_id', '23514');
  end if;

  reversal_date := public.read_stock_doc_date(header -> 'doc_date');
  if reversal_date < original.doc_date then
    perform public.raise_stock_error(
      format('취소 일자는 원래 전표 일자(%s)보다 빠를 수 없습니다.', original.doc_date),
      'stock_reversal_date_invalid', null, 'doc_date', '22023');
  end if;
  header_memo := coalesce(
    public.read_stock_text(header -> 'memo', 500, null, 'memo', '메모'),
    original.doc_no || ' 취소'
  );

  perform public.lock_stock_lots(array(
    select distinct movement.lot_id from public.stock_movements as movement
    where movement.document_id = original.id
  ));

  -- Every (lot, location) the 취소 takes stock from must still have it.
  for pair in
    select movement.lot_id, movement.location_id, sum(movement.quantity_delta) as quantity,
      min(movement.line_no) as line_no
    from public.stock_movements as movement
    where movement.document_id = original.id
    group by movement.lot_id, movement.location_id
    having sum(movement.quantity_delta) > 0
  loop
    available := case
      when reversal_date >= public.stock_today() then coalesce((
        select balance.quantity from public.stock_balances as balance
        where balance.lot_id = pair.lot_id and balance.location_id = pair.location_id
      ), 0)
      else public.stock_available_from(pair.lot_id, pair.location_id, reversal_date)
    end;
    if available < pair.quantity then
      select product.name, product.unit, lot.lot_no into lot_info
      from public.stock_lots as lot
      join public.products as product on product.id = lot.product_id
      where lot.id = pair.lot_id;
      -- Enough stock today, but not on every day since the 취소 date.
      if reversal_date < public.stock_today()
        and coalesce((
          select balance.quantity from public.stock_balances as balance
          where balance.lot_id = pair.lot_id and balance.location_id = pair.location_id
        ), 0) >= pair.quantity then
        perform public.raise_stock_error(
          format('%s 이후에 이 로트(%s %s)에서 나간 재고가 있어 그 날짜로는 취소할 수 없습니다. 취소 일자를 오늘로 해 주세요.',
            reversal_date, lot_info.name, lot_info.lot_no),
          'stock_history_negative', pair.line_no, 'doc_date', '23514',
          jsonb_build_object('lot_id', pair.lot_id, 'location_id', pair.location_id));
      end if;
      perform public.raise_stock_error(
        format('이미 출고·이동·폐기된 재고가 있어 취소할 수 없습니다: %s 로트 %s, %s (취소에 필요한 수량 %s %s, 남은 수량 %s %s). 그 전표들을 먼저 취소해 주세요.',
          lot_info.name, lot_info.lot_no,
          coalesce((select info.label from public.stock_location_info(pair.location_id) as info), '-'),
          public.stock_quantity_text(pair.quantity), lot_info.unit,
          public.stock_quantity_text(greatest(available, 0)), lot_info.unit),
        'stock_reversal_insufficient', pair.line_no, 'quantity', '23514',
        jsonb_build_object('lot_id', pair.lot_id, 'location_id', pair.location_id,
          'needed', pair.quantity, 'available', greatest(available, 0)));
    end if;
  end loop;

  document := public.create_stock_document('reversal', reversal_date, original.partner_id, header_memo, original.id, header);
  -- The lines that put stock back (the original's − lines) go first, then
  -- the lines that take stock away, each in the original order. Every line
  -- changes the balance at once, and the check above only looked at the
  -- net per (lot, location): an 이동 전표 "A→B 5, B→C 3" whose B now holds
  -- only the 2 its 취소 needs would otherwise go below 0 at B for a
  -- moment (−5 at B before +3 at B). seq follows this order, so a
  -- back-dated 취소's history check never sees such a moment either.
  insert into public.stock_movements (
    document_id, line_no, lot_id, location_id, quantity_delta, reason, memo,
    bundle_id, bundle_quantity, bundle_unit_cost_incl_vat, reverses_movement_id
  )
  select
    document.id, movement.line_no, movement.lot_id, movement.location_id, -movement.quantity_delta,
    movement.reason, movement.memo, movement.bundle_id, movement.bundle_quantity,
    movement.bundle_unit_cost_incl_vat, movement.id
  from public.stock_movements as movement
  where movement.document_id = original.id
  order by movement.quantity_delta > 0, movement.seq;

  if reversal_date < public.stock_today() then
    for pair in
      select movement.lot_id, movement.location_id, min(movement.line_no) as line_no
      from public.stock_movements as movement
      where movement.document_id = document.id and movement.quantity_delta < 0
      group by movement.lot_id, movement.location_id
    loop
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no);
    end loop;
  end if;

  update public.stock_documents
  set reversed_by_id = document.id
  where id = original.id;

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'reversed_document_id', original.id,
    'reversed_doc_no', original.doc_no,
    'warnings', '[]'::jsonb
  );
end;
$$;

comment on function public.reverse_stock_document(uuid, jsonb) is '전표 취소: 모든 줄의 반대 수량으로 취소 전표를 만들고 두 전표를 서로 연결합니다. 되돌릴 재고가 이미 나갔으면 취소할 수 없습니다.';

-- -----------------------------------------------------------------------------
-- 12. 기초재고 일괄등록 (자료일괄등록, /imports/opening-stock)
-- -----------------------------------------------------------------------------

-- Look-ups for the 미리보기 (one request, ONE JSON object):
-- {"products": [{"id", "code", "name", "product_type", "is_active",
--   "unit", "storage_type", "shelf_life_days"}] (상품코드 ignoring case),
--  "suppliers": [{"id", "code", "name", "partner_type", "is_active"}]
--   (거래처코드 ignoring case),
--  "lots": [{"product_code", "lot_no"}] (로트번호 already used by those
--   products, ignoring case),
--  "opening_lots": [{"product_code", "warehouse_code", "zone_code",
--   "location_code", "quantity", "expiry_date", "received_date", "doc_no"}]
--   (기초재고 already registered for those products and not undone: the
--   미리보기 warns about a file uploaded twice),
--  "warehouses": [{"id", "code", "name", "is_active", "zones": [{"id",
--   "code", "name", "storage_type", "is_active", "locations": [{"id",
--   "code", "name", "is_default", "is_active"}]}]}] (all of them)}.
create function public.import_find_opening_stock_refs(
  product_codes text[],
  supplier_codes text[],
  lot_nos text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', product.id, 'code', product.code, 'name', product.name,
        'product_type', product.product_type, 'is_active', product.is_active,
        'unit', product.unit, 'storage_type', product.storage_type,
        'shelf_life_days', product.shelf_life_days
      ) order by product.code), '[]'::jsonb)
      from public.products as product
      where lower(product.code) = any (
        array(select lower(wanted.value) from unnest(coalesce(product_codes, '{}')) as wanted (value))
      )
    ),
    'suppliers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', partner.id, 'code', partner.code, 'name', partner.name,
        'partner_type', partner.partner_type, 'is_active', partner.is_active
      ) order by partner.code), '[]'::jsonb)
      from public.partners as partner
      where lower(partner.code) = any (
        array(select lower(wanted.value) from unnest(coalesce(supplier_codes, '{}')) as wanted (value))
      )
    ),
    'lots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_code', product.code, 'lot_no', lot.lot_no
      ) order by product.code, lot.lot_no), '[]'::jsonb)
      from public.stock_lots as lot
      join public.products as product on product.id = lot.product_id
      where lower(product.code) = any (
          array(select lower(wanted.value) from unnest(coalesce(product_codes, '{}')) as wanted (value))
        )
        and lower(lot.lot_no) = any (
          array(select lower(wanted.value) from unnest(coalesce(lot_nos, '{}')) as wanted (value))
        )
    ),
    'opening_lots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_code', product.code,
        'warehouse_code', warehouse.code,
        'zone_code', zone.code,
        'location_code', location.code,
        'quantity', movement.quantity_delta,
        'expiry_date', lot.expiry_date,
        'received_date', lot.received_date,
        'doc_no', document.doc_no
      ) order by product.code, document.doc_no), '[]'::jsonb)
      from public.stock_movements as movement
      join public.stock_documents as document on document.id = movement.document_id
      join public.stock_lots as lot on lot.id = movement.lot_id
      join public.products as product on product.id = movement.product_id
      join public.storage_locations as location on location.id = movement.location_id
      join public.warehouse_zones as zone on zone.id = location.zone_id
      join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
      where document.doc_type = 'opening'
        and document.reversed_by_id is null
        and lower(product.code) = any (
          array(select lower(wanted.value) from unnest(coalesce(product_codes, '{}')) as wanted (value))
        )
    ),
    'warehouses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', warehouse.id, 'code', warehouse.code, 'name', warehouse.name,
        'is_active', warehouse.is_active,
        'zones', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', zone.id, 'code', zone.code, 'name', zone.name,
            'storage_type', zone.storage_type, 'is_active', zone.is_active,
            'locations', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', location.id, 'code', location.code, 'name', location.name,
                'is_default', location.is_default, 'is_active', location.is_active
              ) order by location.sort_order, location.code), '[]'::jsonb)
              from public.storage_locations as location
              where location.zone_id = zone.id
            )
          ) order by zone.sort_order, zone.code), '[]'::jsonb)
          from public.warehouse_zones as zone
          where zone.warehouse_id = warehouse.id
        )
      ) order by warehouse.sort_order, warehouse.code), '[]'::jsonb)
      from public.warehouses as warehouse
    )
  )
$$;

comment on function public.import_find_opening_stock_refs(text[], text[], text[]) is '기초재고 일괄등록 미리보기: 파일의 상품코드·매입처코드·로트번호, 이미 등록된 기초재고, 모든 창고·구역·위치를 한 번에 돌려줍니다 (JSON).';

-- 기초재고 일괄등록: the stock on hand when the company starts using the
-- ERP. One 기초재고 전표 (doc_type 'opening', date opening_date, default
-- today) with one new lot per row. All or nothing: the first row that
-- fails undoes everything and is reported with its Excel row (hint
-- import_row_invalid, detail {sheet, excel_row, field (column key of
-- src/lib/imports/opening-stock.ts), rule, reason, state}).
-- rows: [{"excel_row", "product_code" (기준상품), "quantity",
--         "warehouse_code", "zone_code", "location_code" (empty = the
--         구역's 기본 위치), "expiry_kind" ('use_by' | 'sell_by' | 'none'),
--         "expiry_date", "manufactured_date", "received_date" (empty = the
--         전표 date; the lot's 입고일), "lot_no", "unit_cost_incl_vat",
--         "supplier_code", "memo"}, …] — at most 3,000.
-- request_id (optional, one per uploaded file): the same commit sent again
-- (e.g. a retry after the answer was lost) saves nothing new and returns
-- the 전표 it already made, with "already_saved": true (find_stock_request).
-- Returns {"inserted" (rows), "document_id", "doc_no", "doc_date",
--          "codes" (the lots' 로트번호 in file order), "already_saved"?}.
create function public.import_opening_stock(
  rows jsonb,
  opening_date date default null,
  request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_rows constant integer := 3000;
  document_date date;
  document public.stock_documents;
  entry record;
  row_value jsonb;
  current_row integer;
  current_field text;
  product_row record;
  warehouse_row record;
  zone_row record;
  location_uuid uuid;
  supplier_row record;
  supplier_uuid uuid;
  received date;
  line_result jsonb;
  lot_codes text[] := '{}';
  row_count integer := 0;
  error_state text;
  error_message text;
  error_hint text;
  error_constraint text;
  error_detail text;
  detail_field text;
  request_header jsonb := jsonb_build_object('request_id', import_opening_stock.request_id);
  existing jsonb;
begin
  -- Saved before with the same request: that 전표, nothing new.
  existing := public.find_stock_request(request_header);
  if existing is not null then
    return existing || jsonb_build_object(
      'inserted', (
        select count(*)
        from public.stock_movements as movement
        where movement.document_id = (existing ->> 'document_id')::uuid
      ),
      'codes', (
        select coalesce(jsonb_agg(lot.lot_no order by movement.seq), '[]'::jsonb)
        from public.stock_movements as movement
        join public.stock_lots as lot on lot.id = movement.lot_id
        where movement.document_id = (existing ->> 'document_id')::uuid
      )
    );
  end if;

  perform public.import_check_rows(rows, max_rows);
  if jsonb_array_length(rows) = 0 then
    raise exception '등록할 행이 없습니다.'
      using errcode = 'invalid_parameter_value', hint = 'import_rows_empty';
  end if;
  document_date := public.read_stock_doc_date(to_jsonb(opening_date));

  begin
    document := public.create_stock_document(
      'opening', document_date, null,
      format('기초재고 일괄등록 (%s행)', jsonb_array_length(rows)), null, request_header
    );

    for entry in select value from jsonb_array_elements(rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;

      current_field := 'productCode';
      select product.id, product.code, product.name, product.product_type, product.is_active
      into product_row
      from public.products as product
      where lower(product.code) = lower(row_value ->> 'product_code');
      if not found then
        raise exception '상품코드 ‘%’을(를) 찾을 수 없습니다.', coalesce(row_value ->> 'product_code', '')
          using errcode = 'foreign_key_violation', hint = 'stock_product_not_found';
      end if;
      if product_row.product_type <> 'base' then
        raise exception '‘%’은(는) 묶음상품입니다. 기초재고는 기준상품코드로 적어 주세요.', product_row.name
          using errcode = 'check_violation', hint = 'stock_product_not_base';
      end if;

      current_field := 'warehouseCode';
      select warehouse.id, warehouse.code into warehouse_row
      from public.warehouses as warehouse
      where lower(warehouse.code) = lower(row_value ->> 'warehouse_code');
      if not found then
        raise exception '창고코드 ‘%’을(를) 찾을 수 없습니다. 창고·로케이션 설정에서 먼저 만들어 주세요.', coalesce(row_value ->> 'warehouse_code', '')
          using errcode = 'foreign_key_violation', hint = 'stock_location_not_found';
      end if;
      current_field := 'zoneCode';
      select zone.id, zone.code into zone_row
      from public.warehouse_zones as zone
      where zone.warehouse_id = warehouse_row.id
        and lower(zone.code) = lower(row_value ->> 'zone_code');
      if not found then
        raise exception '창고 ‘%’에 구역코드 ‘%’이(가) 없습니다.', warehouse_row.code, coalesce(row_value ->> 'zone_code', '')
          using errcode = 'foreign_key_violation', hint = 'stock_location_not_found';
      end if;
      current_field := 'locationCode';
      if nullif(btrim(coalesce(row_value ->> 'location_code', '')), '') is null then
        select location.id into location_uuid
        from public.storage_locations as location
        where location.zone_id = zone_row.id and location.is_default;
      else
        select location.id into location_uuid
        from public.storage_locations as location
        where location.zone_id = zone_row.id
          and lower(location.code) = lower(row_value ->> 'location_code');
        if not found then
          raise exception '구역 ‘%’에 선반코드 ‘%’이(가) 없습니다.', zone_row.code, row_value ->> 'location_code'
            using errcode = 'foreign_key_violation', hint = 'stock_location_not_found';
        end if;
      end if;

      current_field := 'supplierCode';
      supplier_uuid := null;
      if nullif(btrim(coalesce(row_value ->> 'supplier_code', '')), '') is not null then
        select partner.id, partner.name, partner.partner_type, partner.is_active into supplier_row
        from public.partners as partner
        where lower(partner.code) = lower(row_value ->> 'supplier_code');
        if not found then
          raise exception '매입처코드 ‘%’을(를) 찾을 수 없습니다.', row_value ->> 'supplier_code'
            using errcode = 'foreign_key_violation', hint = 'stock_partner_not_found';
        end if;
        if supplier_row.partner_type not in ('purchase', 'both') then
          raise exception '‘%’은(는) 매입처가 아닙니다 (매입처 또는 매출·매입 거래처만).', supplier_row.name
            using errcode = 'check_violation', hint = 'stock_partner_not_supplier';
        end if;
        if not supplier_row.is_active then
          raise exception '미사용 거래처(%)는 매입처로 고를 수 없습니다.', supplier_row.name
            using errcode = 'check_violation', hint = 'stock_partner_inactive';
        end if;
        supplier_uuid := supplier_row.id;
      end if;

      current_field := 'receivedDate';
      received := coalesce(
        public.read_stock_date(row_value -> 'received_date', null, 'received_date', '입고일'),
        document_date
      );
      if received > document_date then
        raise exception '입고일(%)은 기초재고 등록일(%)보다 늦을 수 없습니다.', received, document_date
          using errcode = 'check_violation', hint = 'stock_received_after_opening';
      end if;

      current_field := null;
      line_result := public.stock_receive_line(
        document,
        jsonb_build_object(
          'product_id', product_row.id,
          'quantity', row_value -> 'quantity',
          'location_id', location_uuid,
          'expiry_kind', row_value -> 'expiry_kind',
          'expiry_date', row_value -> 'expiry_date',
          'manufactured_date', row_value -> 'manufactured_date',
          'lot_no', row_value -> 'lot_no',
          'unit_cost_incl_vat', row_value -> 'unit_cost_incl_vat',
          'memo', row_value -> 'memo'
        ),
        current_row, 'rows', current_row, received, supplier_uuid, false
      );
      lot_codes := lot_codes || (line_result -> 'lots' -> 0 ->> 'lot_no');
      row_count := row_count + 1;
    end loop;
  exception when others then
    get stacked diagnostics
      error_state = returned_sqlstate,
      error_message = message_text,
      error_hint = pg_exception_hint,
      error_constraint = constraint_name,
      error_detail = pg_exception_detail;
    if error_state in ('40001', '40P01', '55P03') then
      raise;
    end if;
    -- Errors of stock_receive_line name the JSON key in their detail.
    begin
      detail_field := (error_detail::jsonb) ->> 'field';
    exception when others then
      detail_field := null;
    end;
    current_field := coalesce(
      case detail_field
        when 'product_id' then 'productCode'
        when 'quantity' then 'quantity'
        when 'location_id' then 'locationCode'
        when 'expiry_kind' then 'expiryKind'
        when 'expiry_date' then 'expiryDate'
        when 'manufactured_date' then 'manufacturedDate'
        when 'received_date' then 'receivedDate'
        when 'lot_no' then 'lotNo'
        when 'unit_cost_incl_vat' then 'unitCost'
        when 'memo' then 'memo'
      end,
      case when error_constraint = 'stock_lots_product_lot_no_key' then 'lotNo' end,
      current_field
    );
    if error_constraint = 'stock_lots_product_lot_no_key' then
      error_message := '이 상품에 같은 로트번호가 이미 있습니다.';
      error_hint := 'stock_lot_no_duplicate';
    end if;
    perform public.import_raise_row_error(
      'main', current_row, current_field,
      error_state, error_message, error_hint, error_constraint
    );
  end;

  return jsonb_build_object(
    'inserted', row_count,
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'codes', to_jsonb(lot_codes)
  );
end;
$$;

comment on function public.import_opening_stock(jsonb, date, uuid) is '기초재고 일괄등록: 엑셀 행마다 기준상품 로트를 만들어 기초재고 전표 하나로 넣습니다. 모두 저장되거나 하나도 저장되지 않으며, 실패한 엑셀 행을 알립니다. 같은 저장 요청(request_id)이 다시 오면 새로 저장하지 않고 그 전표를 돌려줍니다.';

-- -----------------------------------------------------------------------------
-- 13. Function privileges
-- Supabase gives new functions to everyone by default: revoke first.
-- - Called by the app (signed-in employees) and the service role: the save
--   functions, the read functions and the helpers that views and read
--   functions use.
-- - Only used inside the save functions (which run as the owner): no
--   EXECUTE for employees.
-- -----------------------------------------------------------------------------

revoke all on function public.stock_today() from public, anon, authenticated;
revoke all on function public.unit_allows_fraction(text) from public, anon, authenticated;
revoke all on function public.is_stock_place_code(text, integer) from public, anon, authenticated;
revoke all on function public.stock_number_text(integer) from public, anon, authenticated;
revoke all on function public.stock_quantity_text(numeric) from public, anon, authenticated;
revoke all on function public.raise_stock_error(text, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.read_stock_uuid(jsonb, boolean, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.read_stock_quantity(jsonb, boolean, boolean, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.read_stock_amount(jsonb, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.read_stock_date(jsonb, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.read_stock_text(jsonb, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.read_stock_doc_date(jsonb) from public, anon, authenticated;
revoke all on function public.check_stock_lines(jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.stock_expiry_from_manufactured(date, integer) from public, anon, authenticated;
revoke all on function public.create_default_storage_location() from public, anon, authenticated;
revoke all on function public.protect_stock_place() from public, anon, authenticated;
revoke all on function public.refuse_stock_ledger_change() from public, anon, authenticated;
revoke all on function public.prepare_stock_document() from public, anon, authenticated;
revoke all on function public.check_stock_document_has_movements() from public, anon, authenticated;
revoke all on function public.prepare_stock_lot() from public, anon, authenticated;
revoke all on function public.prepare_stock_movement() from public, anon, authenticated;
revoke all on function public.apply_stock_movement() from public, anon, authenticated;
revoke all on function public.protect_stock_balance() from public, anon, authenticated;
revoke all on function public.check_product_unit_change() from public, anon, authenticated;
revoke all on function public.next_stock_number(text) from public, anon, authenticated;
revoke all on function public.find_stock_request(jsonb) from public, anon, authenticated;
revoke all on function public.create_stock_document(public.stock_document_type, date, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_stock_lot(uuid, text, text, public.expiry_kind, date, date, date, bigint, uuid, text, text, public.stock_documents, integer, text) from public, anon, authenticated;
revoke all on function public.lock_stock_lots(uuid[]) from public, anon, authenticated;
revoke all on function public.stock_location_info(uuid) from public, anon, authenticated;
revoke all on function public.check_stock_input_location(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.stock_balance_as_of(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.stock_available_from(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.check_stock_pair_history(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.stock_bundle_components(uuid, numeric, bigint) from public, anon, authenticated;
revoke all on function public.stock_issue_plan(jsonb, date, boolean, uuid[]) from public, anon, authenticated;
revoke all on function public.plan_stock_issue(jsonb, date, boolean) from public, anon, authenticated;
revoke all on function public.allocate_fefo(uuid, numeric, uuid, uuid, uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.stock_transfer_warnings(jsonb) from public, anon, authenticated;
revoke all on function public.stock_count_sheet(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.stock_period_report(date, date, uuid, uuid, uuid, text, uuid, boolean, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.product_stock_ledger(uuid, date, date, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.stock_dashboard(integer) from public, anon, authenticated;
revoke all on function public.stock_integrity_check() from public, anon, authenticated;
revoke all on function public.stock_receive_line(public.stock_documents, jsonb, integer, text, integer, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.check_stock_partner(uuid, boolean) from public, anon, authenticated;
revoke all on function public.check_stock_header(jsonb) from public, anon, authenticated;
revoke all on function public.receive_stock(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.issue_stock(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dispose_stock(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.transfer_stock(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_stock_count(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reverse_stock_document(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.import_find_opening_stock_refs(text[], text[], text[]) from public, anon, authenticated;
revoke all on function public.import_opening_stock(jsonb, date, uuid) from public, anon, authenticated;

-- Used by table checks, views and read functions running as the employee.
grant execute on function public.stock_today() to authenticated, service_role;
grant execute on function public.unit_allows_fraction(text) to authenticated, service_role;
grant execute on function public.is_stock_place_code(text, integer) to authenticated, service_role;
grant execute on function public.stock_number_text(integer) to authenticated, service_role;
grant execute on function public.stock_quantity_text(numeric) to authenticated, service_role;
grant execute on function public.raise_stock_error(text, text, integer, text, text, jsonb) to authenticated, service_role;
grant execute on function public.read_stock_uuid(jsonb, boolean, integer, text, text, text) to authenticated, service_role;
grant execute on function public.read_stock_quantity(jsonb, boolean, boolean, integer, text, text, text) to authenticated, service_role;
grant execute on function public.check_stock_lines(jsonb, boolean, text) to authenticated, service_role;
grant execute on function public.stock_expiry_from_manufactured(date, integer) to authenticated, service_role;
grant execute on function public.stock_location_info(uuid) to authenticated, service_role;
grant execute on function public.stock_balance_as_of(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.stock_available_from(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.stock_bundle_components(uuid, numeric, bigint) to authenticated, service_role;
grant execute on function public.stock_issue_plan(jsonb, date, boolean, uuid[]) to authenticated, service_role;
grant execute on function public.plan_stock_issue(jsonb, date, boolean) to authenticated, service_role;
grant execute on function public.allocate_fefo(uuid, numeric, uuid, uuid, uuid, date, boolean) to authenticated, service_role;
grant execute on function public.stock_transfer_warnings(jsonb) to authenticated, service_role;
grant execute on function public.stock_count_sheet(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function public.stock_period_report(date, date, uuid, uuid, uuid, text, uuid, boolean, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.product_stock_ledger(uuid, date, date, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.stock_dashboard(integer) to authenticated, service_role;
grant execute on function public.stock_integrity_check() to authenticated, service_role;
grant execute on function public.import_find_opening_stock_refs(text[], text[], text[]) to authenticated, service_role;

-- The save functions (SECURITY DEFINER): signed-in employees only.
grant execute on function public.receive_stock(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.issue_stock(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.dispose_stock(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.transfer_stock(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.apply_stock_count(jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.reverse_stock_document(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_opening_stock(jsonb, date, uuid) to authenticated, service_role;

-- Tell the API (PostgREST) to read the new tables, views and functions.
notify pgrst, 'reload schema';
