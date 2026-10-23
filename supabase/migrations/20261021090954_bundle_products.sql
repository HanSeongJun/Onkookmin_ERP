-- =============================================================================
-- 상품관리 update: 기준상품(개입) and 묶음상품 (bundles); 박스입수량 removed
--
-- Runs after 20261021022829_create_products.sql and
-- 20261021055933_products_optional_category_box_quantity.sql, which are both
-- already applied to the real (hosted) database. Those files are never
-- edited; this file changes the schema on top of them and keeps every
-- existing product.
--
-- The owner's rules (decided 2026-10-21):
-- - Our ERP always counts single units ("개입"). Every product is one of two
--   types:
--   * 기준상품 (base): one single unit, e.g. "스팸 클래식 1.81kg" (one can).
--     It is the top-level code and holds all the food information
--     (보관온도, 과세구분, 원산지, 제조사, 유통기한 기준일수, 알레르기).
--   * 묶음상품 (bundle): a list of 기준상품 × quantity (구성표), e.g.
--     "[묶음] 스팸 클래식 1.81kg X 6개입" = 스팸 × 6, or a mixed set
--     "스팸 × 2 + 참치 × 3". Only 기준상품 can be inside a 묶음상품 (no bundle
--     inside a bundle), and one 기준상품 appears at most once per bundle.
-- - A 묶음상품 has its own code, name, 규격, 단위, prices, 바코드, 사용 여부,
--   비고 and 분류, but NO food information of its own: that is always worked
--   out from its 기준상품 (see the view product_list_items below).
-- - The type is chosen when the product is registered and never changes.
-- - Switching a 기준상품 off (사용중지) also switches off every 묶음상품 that
--   contains it. Switching the 기준상품 on again does not switch them on.
-- - A 묶음상품 can only be 사용 while all its 기준상품 are 사용.
-- - 박스입수량 (box_quantity) is removed: 묶음상품 replace it.
-- - Stock (later modules) is kept only on 기준상품; a 묶음상품 quantity is
--   converted through its 구성표.
--
-- What this file does, in this order (each step needs the ones before it):
--  1. New type product_type and column products.product_type. Every existing
--     product becomes a 기준상품.
--  2. 보관온도/과세구분 may be empty, but only for 묶음상품: a check keeps the
--     food fields filled for 기준상품 and empty for 묶음상품.
--  3. A product's type can never change (trigger).
--  4. The view product_list_items is dropped (it still lists box_quantity),
--     then the column box_quantity and its check are dropped.
--  5. New table product_bundle_items (구성표) with its checks, triggers,
--     Row Level Security and privileges.
--  6. A 묶음상품 can only be switched on when all its 기준상품 are on
--     (trigger).
--  7. The view product_list_items is created again (it needs the new table):
--     without box_quantity, with the product type, a 구성 summary and the
--     "effective" food information (a 기준상품's own values, or a 묶음상품's
--     values worked out from its 기준상품).
--  8. Two functions that save a 묶음상품 together with its 구성표 in one go:
--     create_bundle_product and update_bundle_product.
--  9. Switching a 기준상품 off switches off its 묶음상품 (trigger).
-- 10. A 묶음상품 always has at least one 기준상품: checked when the
--     transaction is committed (triggers), so writes that bypass the
--     functions of step 8 are refused too.
-- 11. The API (PostgREST) is told to reload.
--
-- Messages a user may see are in Korean. Each one also carries a short
-- English key in HINT (e.g. 'bundle_component_inactive'); the app reads the
-- key to show the message at the right place. The keys are listed in
-- PRODUCT_DB_RULES in src/lib/products/constants.ts: change both together.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 상품유형 (product_type): 기준상품 or 묶음상품
-- -----------------------------------------------------------------------------

create type public.product_type as enum ('base', 'bundle');

comment on type public.product_type is '상품유형: base=기준상품(개입, 낱개 1개 단위의 최상위 상품), bundle=묶음상품(기준상품 여러 개를 묶은 상품)';

-- New required column. Every existing product gets 'base' (기준상품) right
-- away; a constant default does not rewrite the table.
alter table public.products
  add column product_type public.product_type not null default 'base';

comment on column public.products.product_type is '상품유형 (base=기준상품, bundle=묶음상품). 등록할 때 정하며 나중에 바꿀 수 없습니다';

-- -----------------------------------------------------------------------------
-- 2. Food information: required for 기준상품, always empty for 묶음상품
-- -----------------------------------------------------------------------------

-- 보관온도 and 과세구분 were required for every product. A 묶음상품 has none
-- of its own (they come from its 기준상품), so the columns may now be empty.
-- The check below still requires them for every 기준상품.
alter table public.products
  alter column storage_type drop not null,
  alter column tax_type drop not null;

-- 기준상품: 보관온도 and 과세구분 must be filled in (as before).
-- 묶음상품: no food information of its own. 보관온도, 과세구분, 원산지,
-- 제조사, 유통기한 기준일수 are empty and 알레르기 is an empty list, so
-- nobody can type values that disagree with the 기준상품.
-- Every existing product is a 기준상품 with 보관온도 and 과세구분 filled in,
-- so they all pass.
alter table public.products
  add constraint products_product_type_fields_check
    check (
      (
        product_type = 'base'
        and storage_type is not null
        and tax_type is not null
      )
      or (
        product_type = 'bundle'
        and storage_type is null
        and tax_type is null
        and origin is null
        and manufacturer is null
        and shelf_life_days is null
        and allergens = '{}'
      )
    );

comment on constraint products_product_type_fields_check on public.products is '기준상품은 보관온도·과세구분이 꼭 있어야 하고, 묶음상품은 식품 정보(보관온도·과세구분·원산지·제조사·유통기한 기준일수·알레르기)를 직접 갖지 않습니다 (구성 기준상품에서 계산)';

comment on column public.products.storage_type is '보관온도 (상온/냉장/냉동). 기준상품만 입력하며, 묶음상품은 비어 있고 구성 기준상품에서 계산합니다';
comment on column public.products.tax_type is '과세구분 (과세/면세). 기준상품만 입력하며, 묶음상품은 비어 있고 구성 기준상품에서 계산합니다';
comment on column public.products.origin is '원산지 (예: 국산, 국산(전남 무안), 호주산). 기준상품만 입력합니다';
comment on column public.products.manufacturer is '제조사 또는 브랜드. 기준상품만 입력합니다';
comment on column public.products.shelf_life_days is '유통기한 기준일수 (제조일로부터 N일, 1~3650). 기준상품만 입력합니다';
comment on column public.products.allergens is '알레르기 유발물질 목록 (식품 등의 표시기준, 영문 키로 저장: egg, milk ...). 기준상품만 입력하며, 묶음상품은 빈 목록입니다';

-- -----------------------------------------------------------------------------
-- 3. The product type never changes
-- -----------------------------------------------------------------------------

-- Turning a 기준상품 into a 묶음상품 (or back) would break the 구성표 of
-- other 묶음상품 and, later, its stock. So it is refused; a different type
-- means a new product.
create function public.keep_product_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '상품유형(기준상품/묶음상품)은 등록한 뒤에 바꿀 수 없습니다. 다른 유형이 필요하면 새 상품으로 등록해 주세요.'
    using errcode = 'check_violation', hint = 'product_type_fixed';
end;
$$;

comment on function public.keep_product_type() is '상품유형(기준상품/묶음상품)을 등록 후에 바꾸지 못하게 막습니다.';

-- Runs only when an update really changes product_type.
create trigger products_keep_product_type
  before update of product_type on public.products
  for each row
  when (old.product_type is distinct from new.product_type)
  execute function public.keep_product_type();

comment on trigger products_keep_product_type on public.products is '상품유형이 바뀌는 수정을 거절합니다.';

-- -----------------------------------------------------------------------------
-- 4. 박스입수량 (box_quantity) is removed
-- -----------------------------------------------------------------------------

-- The view product_list_items lists box_quantity, so it must go first
-- (a column a view uses cannot be dropped). It is created again in step 7,
-- after the new table it reads exists. Nothing else depends on the view.
drop view public.product_list_items;

-- 묶음상품 replace 박스입수량 (e.g. "[박스] … X 24개입"). The stored values
-- were information only (never used for any calculation), so they are
-- dropped with the column.
alter table public.products
  drop constraint products_box_quantity_check;

alter table public.products
  drop column box_quantity;

-- -----------------------------------------------------------------------------
-- 5. product_bundle_items: 구성표 (which 기준상품, how many, in a 묶음상품)
-- -----------------------------------------------------------------------------

create table public.product_bundle_items (
  -- The 묶음상품 this row belongs to.
  bundle_id uuid not null references public.products (id) on delete restrict,
  -- The 기준상품 inside it.
  component_id uuid not null references public.products (id) on delete restrict,
  -- How many of the 기준상품 (in the 기준상품's own unit, e.g. 6 캔).
  quantity integer not null,
  -- Order in the 구성표 (smaller first).
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per (묶음상품, 기준상품): the same 기준상품 cannot be listed twice
  -- in one 묶음상품 (raise the quantity instead).
  constraint product_bundle_items_pkey primary key (bundle_id, component_id),
  -- Whole number from 1 to 100000 (same limits as BUNDLE_ITEM_QUANTITY in
  -- src/lib/products/constants.ts).
  constraint product_bundle_items_quantity_check
    check (quantity between 1 and 100000),
  -- A product cannot contain itself.
  constraint product_bundle_items_not_self_check
    check (bundle_id <> component_id)
);

-- "Which 묶음상품 contain this 기준상품?" (switching a 기준상품 off, the
-- 묶음상품 tab of a 기준상품). The primary key already covers bundle_id.
create index product_bundle_items_component_id_idx
  on public.product_bundle_items (component_id);

comment on table public.product_bundle_items is '묶음상품 구성표: 묶음상품 하나에 어떤 기준상품이 몇 개 들어 있는지. 기준상품만 넣을 수 있고, 한 묶음상품에 같은 기준상품은 한 번만 들어갑니다.';
comment on column public.product_bundle_items.bundle_id is '묶음상품 ID (products.product_type = bundle)';
comment on column public.product_bundle_items.component_id is '구성 기준상품 ID (products.product_type = base)';
comment on column public.product_bundle_items.quantity is '수량 (구성 기준상품의 단위 기준, 1~100000)';
comment on column public.product_bundle_items.sort_order is '구성표에 보이는 순서 (작은 숫자가 먼저)';
comment on column public.product_bundle_items.created_at is '등록 일시';
comment on column public.product_bundle_items.updated_at is '마지막 수정 일시';
comment on constraint product_bundle_items_quantity_check on public.product_bundle_items is '수량은 1~100000 사이의 정수';
comment on constraint product_bundle_items_not_self_check on public.product_bundle_items is '상품은 자기 자신을 구성상품으로 가질 수 없습니다';

-- updated_at = now on every change (shared function from the first migration).
create trigger product_bundle_items_set_updated_at
  before update on public.product_bundle_items
  for each row execute function public.set_updated_at();

comment on trigger product_bundle_items_set_updated_at on public.product_bundle_items is '수정할 때 updated_at을 현재 시각으로 바꿉니다.';

-- Checks every 구성표 row that is added or pointed at another product:
-- 1. component_id must be a 기준상품 (no 묶음상품 inside a 묶음상품).
-- 2. bundle_id must be a 묶음상품.
-- 3. A 묶음상품 that is 사용 may only contain 기준상품 that are 사용.
--
-- Both products are read with a lock (FOR SHARE). Switching a 기준상품 off
-- needs a stronger lock on the same row, so it waits until this save is
-- finished (and then also switches off the 묶음상품, see step 9) — or, if it
-- came first, this save waits and then sees the 기준상품 as 사용중지 and is
-- refused. Either way no 묶음상품 ends up 사용 with a 사용중지 기준상품.
-- The 기준상품 is locked before the 묶음상품: the same order as switching
-- a 기준상품 off, which keeps two saves from waiting for each other forever.
-- (This relies on Postgres' default isolation level READ COMMITTED.)
create function public.check_product_bundle_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  component_type public.product_type;
  component_is_active boolean;
  component_code text;
  bundle_type public.product_type;
  bundle_is_active boolean;
begin
  -- 1. The 기준상품 inside.
  select product.product_type, product.is_active, product.code
  into component_type, component_is_active, component_code
  from public.products as product
  where product.id = new.component_id
  for share;

  if not found then
    raise exception '구성상품으로 넣을 기준상품을 찾을 수 없습니다. 기준상품을 다시 선택해 주세요.'
      using errcode = 'foreign_key_violation', hint = 'bundle_component_not_found';
  end if;
  if component_type <> 'base' then
    raise exception '묶음상품에는 기준상품만 넣을 수 있습니다. (묶음상품 안에 묶음상품은 넣을 수 없습니다: %)', component_code
      using errcode = 'check_violation', hint = 'bundle_component_not_base';
  end if;

  -- 2. The 묶음상품 it belongs to.
  select product.product_type, product.is_active
  into bundle_type, bundle_is_active
  from public.products as product
  where product.id = new.bundle_id
  for share;

  if not found then
    raise exception '묶음상품을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.'
      using errcode = 'foreign_key_violation', hint = 'bundle_not_found';
  end if;
  if bundle_type <> 'bundle' then
    raise exception '구성상품은 묶음상품에만 넣을 수 있습니다. 기준상품에는 구성상품이 없습니다.'
      using errcode = 'check_violation', hint = 'bundle_item_parent_not_bundle';
  end if;

  -- 3. A 사용 묶음상품 cannot contain a 사용중지 기준상품.
  if bundle_is_active and not component_is_active then
    raise exception '사용중지된 기준상품(%)은 사용 중인 묶음상품에 넣을 수 없습니다. 기준상품을 먼저 사용으로 바꾸거나, 묶음상품을 사용중지로 저장해 주세요.', component_code
      using errcode = 'check_violation', hint = 'bundle_component_inactive';
  end if;

  return new;
end;
$$;

comment on function public.check_product_bundle_item() is '구성표 행을 확인합니다: 구성상품은 기준상품, 상위 상품은 묶음상품이어야 하고, 사용 중인 묶음상품에는 사용중지된 기준상품을 넣을 수 없습니다.';

-- Changing only quantity or sort_order needs no check.
create trigger product_bundle_items_check
  before insert or update of bundle_id, component_id on public.product_bundle_items
  for each row execute function public.check_product_bundle_item();

comment on trigger product_bundle_items_check on public.product_bundle_items is '구성표 행을 넣거나 바꿀 때 check_product_bundle_item()으로 확인합니다.';

-- Row Level Security and privileges: every signed-in employee (role
-- "authenticated") reads and changes all 구성표 rows, like products.
-- Visitors who are not signed in (role "anon") get nothing.
-- The app changes a 구성표 only through the functions in step 8, which save
-- the 묶음상품 and its 구성표 together; the privileges below are what those
-- functions need (they run with the employee's own permissions).
alter table public.product_bundle_items enable row level security;

create policy "Employees can read bundle items"
  on public.product_bundle_items for select to authenticated
  using (true);
create policy "Employees can add bundle items"
  on public.product_bundle_items for insert to authenticated
  with check (true);
create policy "Employees can change bundle items"
  on public.product_bundle_items for update to authenticated
  using (true) with check (true);
-- Removing a 기준상품 from a 구성표 deletes its row (products themselves are
-- never deleted).
create policy "Employees can delete bundle items"
  on public.product_bundle_items for delete to authenticated
  using (true);

-- Explicit privileges (new tables are not exposed to the API automatically).
revoke all on table public.product_bundle_items from anon, authenticated;
grant select, insert, update, delete
  on table public.product_bundle_items to authenticated;
grant all on table public.product_bundle_items to service_role;

-- -----------------------------------------------------------------------------
-- 6. A 묶음상품 can only be switched on when all its 기준상품 are on
-- -----------------------------------------------------------------------------

-- Runs when a 묶음상품 goes from 사용중지 to 사용 (single save or 선택 사용).
-- Its 기준상품 are locked first (FOR SHARE, same reason as in
-- check_product_bundle_item), then counted.
create function public.check_bundle_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inactive_count integer;
begin
  perform 1
  from public.products as component
  where component.id in (
    select item.component_id
    from public.product_bundle_items as item
    where item.bundle_id = new.id
  )
  order by component.id
  for share;

  select count(*) into inactive_count
  from public.product_bundle_items as item
  join public.products as component
    on component.id = item.component_id
  where item.bundle_id = new.id
    and not component.is_active;

  if inactive_count > 0 then
    raise exception '묶음상품(%)에 사용중지된 기준상품이 %개 들어 있어 사용으로 바꿀 수 없습니다. 기준상품을 먼저 사용으로 바꾸거나 구성에서 빼 주세요.', new.code, inactive_count
      using errcode = 'check_violation', hint = 'bundle_activation_blocked';
  end if;

  return new;
end;
$$;

comment on function public.check_bundle_activation() is '묶음상품을 사용으로 바꿀 때, 구성 기준상품이 모두 사용 중인지 확인합니다.';

create trigger products_check_bundle_activation
  before update of is_active on public.products
  for each row
  when (new.product_type = 'bundle' and new.is_active and not old.is_active)
  execute function public.check_bundle_activation();

comment on trigger products_check_bundle_activation on public.products is '사용중지된 기준상품이 들어 있는 묶음상품은 사용으로 바꿀 수 없습니다.';

-- -----------------------------------------------------------------------------
-- 7. product_list_items: the product list's view, created again
--
-- One row per product (기준상품 and 묶음상품) with:
-- - every products column (box_quantity is gone; product_type is new);
-- - category_parent_id, category_grandparent_id: the two categories above
--   the product's own, for the category filter (as before; 미분류 products
--   are listed with all three category columns empty);
-- - component_count: number of 기준상품 in a 묶음상품 (0 for a 기준상품);
-- - single_component_id/_code/_quantity: for a 묶음상품 of exactly one
--   기준상품 (e.g. 스팸 × 6), that 기준상품 and the quantity; otherwise empty;
-- - effective_*: the food information to show and filter by. For a
--   기준상품 its own values. For a 묶음상품, worked out from its 기준상품:
--   * 보관온도: the strictest (냉동 > 냉장 > 상온);
--   * 과세구분: 'taxable' if all are 과세, 'exempt' if all are 면세,
--     otherwise 'mixed' (혼합);
--   * 알레르기: every allergen of any 기준상품 (no duplicates);
--   * 유통기한 기준일수: the shortest one that is filled in;
--   * 원산지 / 제조사: the different values, joined with ", " (sorted by
--     character code, the same order the app uses).
--   The app computes the same rules while a 묶음상품 is being edited
--   (deriveBundleFoodInfo in src/lib/products/bundle.ts): change both
--   together.
--
-- security_invoker: the view uses the permissions (RLS) of the employee
-- asking, exactly like the tables.
-- -----------------------------------------------------------------------------

create view public.product_list_items
with (security_invoker = true)
as
select
  product.*,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id,
  coalesce(composition.component_count, 0) as component_count,
  composition.single_component_id,
  composition.single_component_code,
  composition.single_component_quantity,
  case
    when product.product_type = 'bundle' then composition.storage_type
    else product.storage_type
  end as effective_storage_type,
  case
    when product.product_type = 'bundle' then composition.tax_type
    else product.tax_type::text
  end as effective_tax_type,
  case
    when product.product_type = 'bundle'
      then coalesce(composition_allergens.allergens, '{}')
    else product.allergens
  end as effective_allergens,
  case
    when product.product_type = 'bundle' then composition.shelf_life_days
    else product.shelf_life_days
  end as effective_shelf_life_days,
  case
    when product.product_type = 'bundle' then composition.origin
    else product.origin
  end as effective_origin,
  case
    when product.product_type = 'bundle' then composition.manufacturer
    else product.manufacturer
  end as effective_manufacturer
from public.products as product
left join public.product_categories as category
  on category.id = product.category_id
left join public.product_categories as parent_category
  on parent_category.id = category.parent_id
-- A 묶음상품's 기준상품, summed up (one row per 묶음상품; nothing for a
-- 기준상품).
left join lateral (
  select
    count(*)::integer as component_count,
    case when count(*) = 1 then (array_agg(component.id))[1] end
      as single_component_id,
    case when count(*) = 1 then (array_agg(component.code))[1] end
      as single_component_code,
    case when count(*) = 1 then (array_agg(item.quantity))[1] end
      as single_component_quantity,
    -- The enum is declared room < chilled < frozen, so max = strictest.
    max(component.storage_type) as storage_type,
    case
      when count(*) = 0 then null
      when bool_and(component.tax_type = 'taxable') then 'taxable'
      when bool_and(component.tax_type = 'exempt') then 'exempt'
      else 'mixed'
    end as tax_type,
    -- min() skips empty values.
    min(component.shelf_life_days) as shelf_life_days,
    -- collate "C": sorted by character code, whatever the database's
    -- language settings are; then back to the normal collation.
    string_agg(
      distinct component.origin collate "C", ', '
      order by component.origin collate "C"
    ) collate "default" as origin,
    string_agg(
      distinct component.manufacturer collate "C", ', '
      order by component.manufacturer collate "C"
    ) collate "default" as manufacturer
  from public.product_bundle_items as item
  join public.products as component
    on component.id = item.component_id
  where item.bundle_id = product.id
) as composition
  on product.product_type = 'bundle'
-- Every allergen of a 묶음상품's 기준상품, without duplicates.
left join lateral (
  select array_agg(distinct allergen.key) as allergens
  from public.product_bundle_items as item
  join public.products as component
    on component.id = item.component_id
  cross join unnest(component.allergens) as allergen (key)
  where item.bundle_id = product.id
) as composition_allergens
  on product.product_type = 'bundle';

comment on view public.product_list_items is '상품 목록용: 상품(기준상품·묶음상품)과 분류의 상위 분류 ID, 묶음상품 구성 요약, 실제로 적용되는 식품 정보(effective_*: 기준상품은 자기 값, 묶음상품은 구성 기준상품에서 계산). 미분류 상품도 포함됩니다.';
comment on column public.product_list_items.category_parent_id is '상품 분류의 상위 분류 ID (없거나 미분류면 비어 있음)';
comment on column public.product_list_items.category_grandparent_id is '상품 분류의 상위의 상위 분류 ID (없거나 미분류면 비어 있음)';
comment on column public.product_list_items.component_count is '묶음상품에 들어 있는 기준상품 종류 수 (기준상품은 0)';
comment on column public.product_list_items.single_component_id is '기준상품 한 종류로만 된 묶음상품의 그 기준상품 ID (아니면 비어 있음)';
comment on column public.product_list_items.single_component_code is '기준상품 한 종류로만 된 묶음상품의 그 기준상품 코드 (아니면 비어 있음)';
comment on column public.product_list_items.single_component_quantity is '기준상품 한 종류로만 된 묶음상품의 수량, 예: 6개입이면 6 (아니면 비어 있음)';
comment on column public.product_list_items.effective_storage_type is '적용 보관온도: 기준상품은 자기 값, 묶음상품은 구성 기준상품 중 가장 엄격한 값 (냉동 > 냉장 > 상온)';
comment on column public.product_list_items.effective_tax_type is '적용 과세구분: taxable=과세, exempt=면세, mixed=혼합 (묶음상품에 과세·면세 기준상품이 섞인 경우)';
comment on column public.product_list_items.effective_allergens is '적용 알레르기 유발물질: 기준상품은 자기 값, 묶음상품은 구성 기준상품 전체의 합';
comment on column public.product_list_items.effective_shelf_life_days is '적용 유통기한 기준일수: 기준상품은 자기 값, 묶음상품은 구성 기준상품 중 가장 짧은 값';
comment on column public.product_list_items.effective_origin is '적용 원산지: 기준상품은 자기 값, 묶음상품은 구성 기준상품의 서로 다른 원산지를 쉼표로 이은 값';
comment on column public.product_list_items.effective_manufacturer is '적용 제조사/브랜드: 기준상품은 자기 값, 묶음상품은 구성 기준상품의 서로 다른 제조사를 쉼표로 이은 값';

-- Only signed-in employees may read the view; visitors who are not signed in
-- (anon) get nothing. Revoke first: Supabase may give new views default
-- privileges.
revoke all on table public.product_list_items from anon, authenticated;
grant select on table public.product_list_items to authenticated;
grant select on table public.product_list_items to service_role;

-- -----------------------------------------------------------------------------
-- 8. Saving a 묶음상품 together with its 구성표 (one transaction)
--
-- A 묶음상품 is two kinds of rows: the product and its 구성표 rows. Saving
-- them with separate API requests could leave half a save behind (e.g. a
-- 묶음상품 without 구성표) when the second request fails. These two functions
-- save both in one go: everything is saved, or nothing.
--
-- - security invoker: they run with the permissions of the employee calling
--   them (the same RLS and privileges as direct table access).
-- - search_path = '': every table name is written in full (public.…).
-- - Only signed-in employees may call them (grants below).
--
-- Arguments (JSON, written by src/lib/products/actions.ts):
--   product: {"code", "name", "category_id", "spec", "unit",
--             "purchase_price", "sale_price", "barcode", "is_active", "note"}
--            (empty optional values are null; food fields are not sent —
--            a 묶음상품 has none).
--   items:   [{"component_id": "<기준상품 id>", "quantity": 6}, …] in screen
--            order. 1 to 100 rows, each 기준상품 at most once.
-- -----------------------------------------------------------------------------

-- 묶음상품 등록. Returns the new product's id.
create function public.create_bundle_product(product jsonb, items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  -- 구성표 rules, checked before anything is saved.
  if items is null or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) = 0 then
    raise exception '묶음상품에는 기준상품을 1개 이상 넣어 주세요.'
      using errcode = 'check_violation', hint = 'bundle_items_empty';
  end if;
  if jsonb_array_length(items) > 100 then
    raise exception '묶음상품 하나에 기준상품은 100종류까지 넣을 수 있습니다.'
      using errcode = 'check_violation', hint = 'bundle_items_too_many';
  end if;
  if (
    select count(entry.item ->> 'component_id')
      <> count(distinct (entry.item ->> 'component_id')::uuid)
    from jsonb_array_elements(items) as entry (item)
  ) then
    raise exception '같은 기준상품을 한 묶음상품에 두 번 넣을 수 없습니다. 수량을 늘려 주세요.'
      using errcode = 'check_violation', hint = 'bundle_items_duplicate';
  end if;

  -- The product. Food fields stay empty (see products_product_type_fields_check);
  -- who/when are filled in by the products trigger.
  insert into public.products (
    product_type, code, name, category_id, spec, unit,
    purchase_price, sale_price, barcode, is_active, note
  )
  values (
    'bundle',
    product ->> 'code',
    product ->> 'name',
    (product ->> 'category_id')::uuid,
    product ->> 'spec',
    product ->> 'unit',
    (product ->> 'purchase_price')::bigint,
    (product ->> 'sale_price')::bigint,
    product ->> 'barcode',
    coalesce((product ->> 'is_active')::boolean, true),
    product ->> 'note'
  )
  returning id into new_id;

  -- Its 구성표, in screen order (sort_order 0, 1, 2 …). The trigger
  -- check_product_bundle_item checks every row.
  insert into public.product_bundle_items (
    bundle_id, component_id, quantity, sort_order
  )
  select
    new_id,
    (entry.item ->> 'component_id')::uuid,
    (entry.item ->> 'quantity')::integer,
    (entry.item_number - 1)::integer
  from jsonb_array_elements(items) with ordinality as entry (item, item_number);

  return new_id;
end;
$$;

comment on function public.create_bundle_product(jsonb, jsonb) is '묶음상품 등록: 상품과 구성표(기준상품 × 수량)를 한 번에 저장합니다. 새 상품 ID를 돌려줍니다.';

-- 묶음상품 수정. Replaces the product's fields and its whole 구성표.
-- loaded_updated_at = the product's updated_at when the form was opened: if
-- someone saved it after that, nothing is saved (the older form would
-- silently undo the other person's changes). Returns the product's id.
create function public.update_bundle_product(
  product_id uuid,
  loaded_updated_at timestamptz,
  product jsonb,
  items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.products%rowtype;
  make_active boolean := coalesce((product ->> 'is_active')::boolean, true);
begin
  -- The product as saved now, locked until this save is finished.
  select * into saved
  from public.products
  where id = product_id
  for update;

  if not found then
    raise exception '상품을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.'
      using errcode = 'no_data_found', hint = 'product_not_found';
  end if;
  if saved.product_type <> 'bundle' then
    raise exception '묶음상품이 아닙니다. 상품유형은 바꿀 수 없습니다.'
      using errcode = 'check_violation', hint = 'product_not_bundle';
  end if;
  if loaded_updated_at is null or saved.updated_at <> loaded_updated_at then
    raise exception '이 창을 연 뒤에 상품 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요.'
      using hint = 'product_changed';
  end if;

  -- 구성표 rules, checked before anything is saved (same as when adding).
  if items is null or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) = 0 then
    raise exception '묶음상품에는 기준상품을 1개 이상 넣어 주세요.'
      using errcode = 'check_violation', hint = 'bundle_items_empty';
  end if;
  if jsonb_array_length(items) > 100 then
    raise exception '묶음상품 하나에 기준상품은 100종류까지 넣을 수 있습니다.'
      using errcode = 'check_violation', hint = 'bundle_items_too_many';
  end if;
  if (
    select count(entry.item ->> 'component_id')
      <> count(distinct (entry.item ->> 'component_id')::uuid)
    from jsonb_array_elements(items) as entry (item)
  ) then
    raise exception '같은 기준상품을 한 묶음상품에 두 번 넣을 수 없습니다. 수량을 늘려 주세요.'
      using errcode = 'check_violation', hint = 'bundle_items_duplicate';
  end if;

  -- 1. The product's fields. 사용 여부: switching OFF happens now; switching
  --    ON waits until step 3, so the check sees the NEW 구성표 (a 사용중지
  --    기준상품 that is being taken out must not block it).
  update public.products
  set
    code = product ->> 'code',
    name = product ->> 'name',
    category_id = (product ->> 'category_id')::uuid,
    spec = product ->> 'spec',
    unit = product ->> 'unit',
    purchase_price = (product ->> 'purchase_price')::bigint,
    sale_price = (product ->> 'sale_price')::bigint,
    barcode = product ->> 'barcode',
    note = product ->> 'note',
    is_active = make_active and saved.is_active
  where id = product_id;

  -- 2. The new 구성표 replaces the old one (the trigger
  --    check_product_bundle_item checks every new row).
  delete from public.product_bundle_items
  where bundle_id = product_id;

  insert into public.product_bundle_items (
    bundle_id, component_id, quantity, sort_order
  )
  select
    product_id,
    (entry.item ->> 'component_id')::uuid,
    (entry.item ->> 'quantity')::integer,
    (entry.item_number - 1)::integer
  from jsonb_array_elements(items) with ordinality as entry (item, item_number);

  -- 3. Switch on (사용중지 → 사용). The trigger check_bundle_activation
  --    refuses it while a 기준상품 of the new 구성표 is 사용중지; then the
  --    whole save is undone.
  if make_active and not saved.is_active then
    update public.products
    set is_active = true
    where id = product_id;
  end if;

  return product_id;
end;
$$;

comment on function public.update_bundle_product(uuid, timestamptz, jsonb, jsonb) is '묶음상품 수정: 상품 정보와 구성표 전체를 한 번에 바꿉니다. 창을 연 뒤 다른 사람이 먼저 저장했으면(updated_at이 다르면) 저장하지 않습니다.';

-- Only signed-in employees may call them; not-signed-in visitors (anon) and
-- everyone else (public) may not. Revoke first: Supabase gives new functions
-- default privileges.
revoke all on function public.create_bundle_product(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_bundle_product(jsonb, jsonb)
  to authenticated, service_role;

revoke all on function public.update_bundle_product(uuid, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_bundle_product(uuid, timestamptz, jsonb, jsonb)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Switching a 기준상품 off switches off its 묶음상품
-- -----------------------------------------------------------------------------

-- Runs once for every 기준상품 that goes from 사용 to 사용중지 — in a single
-- save and in 선택 사용중지 of many products alike. Every 묶음상품 that
-- contains it and is still 사용 is switched to 사용중지.
-- Switching the 기준상품 on again does NOT switch its 묶음상품 on: someone
-- has to decide that for each 묶음상품.
-- It runs AFTER the change, so the 기준상품 is already 사용중지 when its
-- 묶음상품 are switched off. Each statement inside reads the newest saved
-- 구성표, including rows another save added while this one was waiting for
-- its lock (see check_product_bundle_item).
create function public.deactivate_bundles_of_base()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products as bundle
  set is_active = false
  where bundle.is_active
    and bundle.id in (
      select item.bundle_id
      from public.product_bundle_items as item
      where item.component_id = new.id
    );
  return null;
end;
$$;

comment on function public.deactivate_bundles_of_base() is '기준상품이 사용중지되면, 그 기준상품이 들어 있는 사용 중인 묶음상품도 모두 사용중지합니다.';

create trigger products_deactivate_bundles
  after update of is_active on public.products
  for each row
  when (
    old.is_active and not new.is_active and new.product_type = 'base'
  )
  execute function public.deactivate_bundles_of_base();

comment on trigger products_deactivate_bundles on public.products is '기준상품을 사용중지하면 그 기준상품이 들어 있는 묶음상품도 함께 사용중지합니다 (다시 사용으로 바꿔도 묶음상품은 그대로).';

-- -----------------------------------------------------------------------------
-- 10. A 묶음상품 always has at least one 기준상품
--
-- The functions of step 8 refuse an empty 구성표 right away. These triggers
-- make the database itself keep the rule, also for writes straight to the
-- tables (e.g. an API request that adds a 묶음상품 without 구성표, or deletes
-- the last row of its 구성표).
--
-- They are checked when the transaction is committed (DEFERRABLE INITIALLY
-- DEFERRED), not after each statement: saving a 묶음상품 adds the product
-- first and its 구성표 right after, in the same transaction, and replacing a
-- 구성표 deletes the old rows before adding the new ones.
--
-- Side effect: a 묶음상품 can only be deleted (by an administrator; the app
-- never deletes products) together with its 구성표 rows in ONE transaction.
-- -----------------------------------------------------------------------------

-- Runs for a new 묶음상품 (products) and for a 구성표 row that was deleted or
-- moved to another 묶음상품 (product_bundle_items).
-- The 묶음상품 row is locked first (FOR NO KEY UPDATE): when two saves at the
-- same moment each remove a different row of the same 구성표, the second one
-- waits for the first, then sees its change and is refused.
create function public.check_bundle_has_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  checked_id uuid;
  bundle_code text;
begin
  if tg_table_name = 'products' then
    checked_id := new.id;
  else
    checked_id := old.bundle_id;
  end if;

  select product.code into bundle_code
  from public.products as product
  where product.id = checked_id
    and product.product_type = 'bundle'
  for no key update;

  -- Not (or no longer) a 묶음상품: e.g. it was deleted in this same
  -- transaction together with its 구성표. Nothing to check.
  if not found then
    return null;
  end if;

  if not exists (
    select 1
    from public.product_bundle_items as item
    where item.bundle_id = checked_id
  ) then
    raise exception '묶음상품(%)에는 기준상품을 1개 이상 넣어 주세요.', bundle_code
      using errcode = 'check_violation', hint = 'bundle_items_empty';
  end if;

  return null;
end;
$$;

comment on function public.check_bundle_has_items() is '묶음상품에 구성 기준상품이 1개 이상 있는지 확인합니다 (트랜잭션을 마칠 때 검사).';

-- A new 묶음상품 must have its 구성표 by the end of the transaction. (The
-- product type never changes, so updates need no check.)
create constraint trigger products_bundle_has_items
  after insert on public.products
  deferrable initially deferred
  for each row
  when (new.product_type = 'bundle')
  execute function public.check_bundle_has_items();

comment on trigger products_bundle_has_items on public.products is '새 묶음상품은 트랜잭션이 끝날 때 구성 기준상품이 1개 이상 있어야 합니다.';

-- Deleting (or moving) a 구성표 row must not leave its 묶음상품 empty.
create constraint trigger product_bundle_items_keep_one
  after delete or update of bundle_id on public.product_bundle_items
  deferrable initially deferred
  for each row
  execute function public.check_bundle_has_items();

comment on trigger product_bundle_items_keep_one on public.product_bundle_items is '구성표 행을 지우거나 옮겨서 묶음상품의 구성 기준상품이 0개가 되면 거절합니다 (트랜잭션이 끝날 때 검사).';

-- -----------------------------------------------------------------------------
-- 11. Tell the API (PostgREST) to reload its picture of the database, so the
--     new table, view columns and functions are usable right away.
-- -----------------------------------------------------------------------------

notify pgrst, 'reload schema';
