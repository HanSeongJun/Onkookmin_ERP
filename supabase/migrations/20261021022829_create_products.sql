-- =============================================================================
-- 상품관리: 상품 분류(product_categories) and 상품(products)
--
-- Rules implemented here (the app's zod schemas check the same rules first,
-- so users normally see a friendly field error before the database does):
-- - 분류 has at most three levels: 대분류 (parent_id is null) → 중분류
--   (parent_id = a 대분류) → 소분류 (parent_id = a 중분류).
-- - No categories are created here: the owner adds all of them in the app.
-- - A product belongs to exactly one category, at any level (대·중·소분류).
-- - 상품코드 is typed by the user and is unique ignoring upper/lower case.
-- - Products are never deleted; they are switched off with is_active = false.
-- - Every signed-in employee may read, add and change data (single company).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.storage_type as enum ('room', 'chilled', 'frozen');
comment on type public.storage_type is '보관온도: room=상온, chilled=냉장(0~10℃), frozen=냉동(-18℃ 이하)';

create type public.tax_type as enum ('taxable', 'exempt');
comment on type public.tax_type is '과세구분: taxable=과세(부가세 10%), exempt=면세';

-- -----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at current
-- (every table has created_at; it keeps its original value on update)
-- -----------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is '행이 수정될 때 updated_at을 현재 시각으로 바꾸고, created_at은 처음 값을 유지합니다.';

-- -----------------------------------------------------------------------------
-- product_categories: 상품 분류 (대분류 → 중분류 → 소분류)
-- -----------------------------------------------------------------------------

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.product_categories (id) on delete restrict,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Name: no leading/trailing whitespace (spaces, tabs, line breaks),
  -- 1–30 characters, Unicode NFC form (pasted, decomposed Hangul such as
  -- macOS file names is turned into NFC by the app first), so that names
  -- that look the same also count as the same for the unique rule below.
  constraint product_categories_name_check
    check (
      name !~ '^\s' and name !~ '\s$' and char_length(name) between 1 and 30
      and name is nfc normalized
    ),
  -- A category cannot be its own parent.
  constraint product_categories_parent_not_self_check
    check (parent_id is null or parent_id <> id),
  -- No two categories with the same name under the same parent
  -- (NULLS NOT DISTINCT: also no two 대분류 with the same name).
  constraint product_categories_parent_id_name_key
    unique nulls not distinct (parent_id, name)
);

create index product_categories_parent_id_idx
  on public.product_categories (parent_id);

comment on table public.product_categories is '상품 분류. 대분류(상위 분류 없음) → 중분류(대분류 아래) → 소분류(중분류 아래), 최대 3단계입니다.';
comment on column public.product_categories.id is '분류 고유 ID (자동 생성)';
comment on column public.product_categories.name is '분류 이름 (같은 상위 분류 안에서 중복 불가, 1~30자)';
comment on column public.product_categories.parent_id is '상위 분류 ID. 비어 있으면 대분류, 대분류를 가리키면 중분류, 중분류를 가리키면 소분류';
comment on column public.product_categories.sort_order is '화면에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.product_categories.is_active is '사용 여부. 중지하면 이 분류와 그 아래 분류를 상품에 새로 고를 수 없습니다';
comment on column public.product_categories.created_at is '등록 일시';
comment on column public.product_categories.updated_at is '마지막 수정 일시';

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

-- Keeps the tree at most three levels deep (대분류 → 중분류 → 소분류) and
-- without loops. Runs when a category is added and when its parent changes:
-- 1. Walk up from the new parent to its 대분류. The number of steps is the
--    parent's level (1 = 대분류, 2 = 중분류, 3 = 소분류). Meeting the category
--    itself on the way means it would go under itself or under one of its own
--    sub-categories. A parent that does not exist (yet) is refused right
--    away, so the order of the rows in one multi-row insert cannot matter.
-- 2. Count the levels below the category (0 = none, 1 = children,
--    2 = grandchildren): on a move they move along with it. (A new category
--    normally has none; counting anyway keeps the rule simple and safe.)
-- 3. parent's level + 1 + levels below must be 3 or less.
--
-- Every category on the way up is read with a lock (FOR SHARE), and moving a
-- category locks its own row. So adding (or moving in) a category somewhere
-- below X and moving X cannot happen at the same moment: the second save
-- waits for the first one and then checks again with the new values. Two
-- saves at once therefore cannot create a fourth level. (This relies on
-- Postgres' default isolation level READ COMMITTED, which the app uses.)
create function public.check_product_category_parent()
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
        using errcode = 'check_violation';
    end if;

    select parent_id into next_ancestor_id
    from public.product_categories
    where id = ancestor_id
    for share;

    -- A missing parent is refused here, not only by the foreign key at the
    -- end of the statement: otherwise one insert of several rows, listing a
    -- child before its parent, would skip this depth check.
    if not found then
      raise exception '상위 분류를 찾을 수 없습니다.'
        using errcode = 'foreign_key_violation';
    end if;

    parent_depth := parent_depth + 1;
    -- The tree is never deeper than 3; this only guards against a broken loop.
    exit when parent_depth > max_depth;
    ancestor_id := next_ancestor_id;
  end loop;

  -- 2. Count the levels below this category.
  with recursive descendants (id, level) as (
    select child.id, 1
    from public.product_categories as child
    where child.parent_id = new.id
    union all
    select child.id, descendants.level + 1
    from public.product_categories as child
    join descendants on child.parent_id = descendants.id
    where descendants.level < max_depth
  )
  select coalesce(max(descendants.level), 0) into levels_below
  from descendants;

  -- 3. After the save, no category may be deeper than level 3.
  if parent_depth + 1 + levels_below > max_depth then
    if tg_op = 'INSERT' then
      raise exception '소분류 아래에는 분류를 만들 수 없습니다. 분류는 대분류 → 중분류 → 소분류 3단계까지입니다.'
        using errcode = 'check_violation';
    end if;
    raise exception '이 분류를 그곳으로 옮기면 아래에 있는 분류까지 합쳐 4단계 이상이 됩니다. 분류는 대분류 → 중분류 → 소분류 3단계까지입니다.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.check_product_category_parent() is '분류가 대분류 → 중분류 → 소분류 3단계를 넘지 않고, 자기 자신이나 자기 아래 분류 밑으로 옮겨지지 않도록 확인합니다.';

create trigger product_categories_check_parent
  before insert or update of parent_id on public.product_categories
  for each row execute function public.check_product_category_parent();

-- -----------------------------------------------------------------------------
-- products: 상품
-- -----------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  spec text,
  unit text not null,
  storage_type public.storage_type not null,
  tax_type public.tax_type not null,
  purchase_price bigint,
  sale_price bigint,
  origin text,
  manufacturer text,
  shelf_life_days integer,
  barcode text,
  allergens text[] not null default '{}',
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),

  -- 상품코드: 1–30 letters, digits, ".", "_" or "-" (no spaces).
  constraint products_code_check
    check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  -- Required text: no leading/trailing whitespace (spaces, tabs, line
  -- breaks), not empty. Line breaks inside the text are allowed (e.g. 비고).
  constraint products_name_check
    check (name !~ '^\s' and name !~ '\s$' and char_length(name) between 1 and 100),
  constraint products_unit_check
    check (unit !~ '^\s' and unit !~ '\s$' and char_length(unit) between 1 and 10),
  -- Optional text: null when empty, otherwise trimmed and not too long.
  constraint products_spec_check
    check (spec is null or (spec !~ '^\s' and spec !~ '\s$' and char_length(spec) between 1 and 100)),
  constraint products_origin_check
    check (origin is null or (origin !~ '^\s' and origin !~ '\s$' and char_length(origin) between 1 and 100)),
  constraint products_manufacturer_check
    check (manufacturer is null or (manufacturer !~ '^\s' and manufacturer !~ '\s$' and char_length(manufacturer) between 1 and 100)),
  constraint products_note_check
    check (note is null or (note !~ '^\s' and note !~ '\s$' and char_length(note) between 1 and 1000)),
  -- Prices: whole won, never negative.
  constraint products_purchase_price_check
    check (purchase_price is null or purchase_price >= 0),
  constraint products_sale_price_check
    check (sale_price is null or sale_price >= 0),
  -- 유통기한 기준일수: 1 day to 10 years.
  constraint products_shelf_life_days_check
    check (shelf_life_days is null or shelf_life_days between 1 and 3650),
  -- 바코드: 8–14 digits (EAN-8, UPC-A, EAN-13, GTIN-14).
  constraint products_barcode_check
    check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  -- 알레르기 유발물질: only the keys from src/lib/products/constants.ts (ALLERGENS).
  -- Source: 식품 등의 표시·광고에 관한 법률 시행규칙 [별표 2] (개정 2024. 12. 30.).
  constraint products_allergens_check
    check (
      allergens <@ array[
        'egg', 'milk', 'buckwheat', 'peanut', 'soybean', 'wheat', 'mackerel',
        'crab', 'shrimp', 'pork', 'peach', 'tomato', 'sulfites', 'walnut',
        'chicken', 'beef', 'squid', 'shellfish', 'pine_nut'
      ]::text[]
    )
);

-- 상품코드 is unique ignoring case: "a001" and "A001" are the same code.
create unique index products_code_lower_key on public.products (lower(code));
-- 바코드 is unique when it is filled in.
create unique index products_barcode_key on public.products (barcode)
  where barcode is not null;
create index products_category_id_idx on public.products (category_id);
create index products_is_active_idx on public.products (is_active);

comment on table public.products is '상품 마스터. 삭제하지 않고 사용 여부(is_active)로 관리합니다.';
comment on column public.products.id is '상품 고유 ID (자동 생성)';
comment on column public.products.code is '상품코드 (직접 입력, 영문·숫자·.-_ 1~30자, 대소문자 구분 없이 중복 불가)';
comment on column public.products.name is '상품명 (1~100자)';
comment on column public.products.category_id is '분류 ID (대분류·중분류·소분류 중 하나)';
comment on column public.products.spec is '규격 (예: 1kg, 500g×20입)';
comment on column public.products.unit is '단위 (예: kg, 박스, 개). 상품마다 한 가지 단위';
comment on column public.products.storage_type is '보관온도 (상온/냉장/냉동)';
comment on column public.products.tax_type is '과세구분 (과세/면세)';
comment on column public.products.purchase_price is '기본 매입가 (원, 부가세 별도 공급가)';
comment on column public.products.sale_price is '기본 판매가 (원, 부가세 별도 공급가)';
comment on column public.products.origin is '원산지 (예: 국산, 국산(전남 무안), 호주산)';
comment on column public.products.manufacturer is '제조사 또는 브랜드';
comment on column public.products.shelf_life_days is '유통기한 기준일수 (제조일로부터 N일, 1~3650)';
comment on column public.products.barcode is '바코드 (숫자 8~14자리, 입력한 경우 중복 불가)';
comment on column public.products.allergens is '알레르기 유발물질 목록 (식품 등의 표시기준, 영문 키로 저장: egg, milk ...)';
comment on column public.products.is_active is '사용 여부 (false면 사용 중지된 상품)';
comment on column public.products.note is '비고';
comment on column public.products.created_at is '등록 일시';
comment on column public.products.updated_at is '마지막 수정 일시';
comment on column public.products.created_by is '등록한 직원 (auth.users의 ID)';
comment on column public.products.updated_by is '마지막으로 수정한 직원 (auth.users의 ID)';

-- Fills in who/when automatically, so the app (or a user) cannot fake it:
-- - on insert: created_at/updated_at = now, created_by and updated_by = the
--   signed-in employee;
-- - on update: updated_at = now, updated_by = the signed-in employee,
--   id and created_at/created_by keep their original values.
-- auth.uid() is null when SQL is run by an admin (seed, dashboard).
create function public.set_product_audit_fields()
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

comment on function public.set_product_audit_fields() is '상품의 등록자·수정자·수정 일시를 자동으로 채웁니다.';

create trigger products_set_audit_fields
  before insert or update on public.products
  for each row execute function public.set_product_audit_fields();

-- -----------------------------------------------------------------------------
-- Row Level Security and table privileges
-- Every signed-in employee (role "authenticated") works with all rows.
-- Visitors who are not signed in (role "anon") get nothing.
-- -----------------------------------------------------------------------------

alter table public.product_categories enable row level security;
alter table public.products enable row level security;

create policy "Employees can read product categories"
  on public.product_categories for select to authenticated
  using (true);
create policy "Employees can add product categories"
  on public.product_categories for insert to authenticated
  with check (true);
create policy "Employees can change product categories"
  on public.product_categories for update to authenticated
  using (true) with check (true);
-- A category that still has products or sub-categories (중분류/소분류)
-- cannot be deleted: the foreign keys (on delete restrict) stop it.
create policy "Employees can delete product categories"
  on public.product_categories for delete to authenticated
  using (true);

create policy "Employees can read products"
  on public.products for select to authenticated
  using (true);
create policy "Employees can add products"
  on public.products for insert to authenticated
  with check (true);
create policy "Employees can change products"
  on public.products for update to authenticated
  using (true) with check (true);
-- No delete policy for products: products are switched off, never deleted.

-- Explicit privileges (newer Supabase projects do not expose new tables to the
-- API automatically). Products get no DELETE privilege at all.
revoke all on table public.product_categories from anon, authenticated;
revoke all on table public.products from anon, authenticated;
grant select, insert, delete on table public.product_categories to authenticated;
-- Only these category columns can be changed through the API: id and
-- created_at never change (a changed id could move a whole branch without
-- the 3-level check). A column the app must edit later has to be added here.
grant update (name, parent_id, sort_order, is_active)
  on table public.product_categories to authenticated;
grant select, insert, update on table public.products to authenticated;
grant all on table public.product_categories to service_role;
grant all on table public.products to service_role;

-- -----------------------------------------------------------------------------
-- product_list_items: products with the two categories above their own
-- (for the product list's category filter)
--
-- Filtering by a 대분류 must include the products of all its 중분류 and
-- 소분류. With these two extra columns the list asks for
-- "category_id = X or category_parent_id = X or category_grandparent_id = X",
-- a short request however many categories there are.
-- security_invoker: the view uses the permissions (RLS) of the employee
-- asking, exactly like the products table.
-- -----------------------------------------------------------------------------

create view public.product_list_items
with (security_invoker = true)
as
select
  product.*,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id
from public.products as product
join public.product_categories as category
  on category.id = product.category_id
left join public.product_categories as parent_category
  on parent_category.id = category.parent_id;

comment on view public.product_list_items is '상품 목록용: 상품과 그 분류의 상위 분류 ID(중분류·대분류). 분류 필터에 사용합니다.';
comment on column public.product_list_items.category_parent_id is '상품 분류의 상위 분류 ID (없으면 비어 있음)';
comment on column public.product_list_items.category_grandparent_id is '상품 분류의 상위의 상위 분류 ID (없으면 비어 있음)';

revoke all on table public.product_list_items from anon, authenticated;
grant select on table public.product_list_items to authenticated;
grant select on table public.product_list_items to service_role;
