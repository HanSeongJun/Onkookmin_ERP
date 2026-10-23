-- =============================================================================
-- 상품 가격: 부가세 포함 금액으로 저장 (VAT-inclusive prices)
--
-- Runs after 20261021022829_create_products.sql,
-- 20261021055933_products_optional_category_box_quantity.sql and
-- 20261021090954_bundle_products.sql, which are all already applied to the
-- real (hosted) database. Those files are never edited; this file changes
-- the schema on top of them. Existing prices are kept as they are: the owner
-- confirmed they were already typed VAT-inclusive (see step 3).
--
-- The owner's rules (decided 2026-10-22):
-- - Employees type every price VAT-INCLUSIVE (부가세 포함). The database
--   stores exactly what they typed. The VAT-exclusive amount (부가세 별도)
--   and the 부가세 are always worked out from it and never stored. (Storing
--   부가세 별도 and adding the 부가세 back would turn a typed 12,000 into
--   12,001.)
-- - 부가세 below 1 원 is cut off (버림). For a VAT-inclusive amount P:
--     과세: 부가세 = floor(P / 11), 부가세 별도 = P - 부가세
--     면세: 부가세 = 0,             부가세 별도 = P
--   e.g. 과세 12,000 → 부가세 1,090, 부가세 별도 10,910;
--        과세 1,358  → 부가세 123,   부가세 별도 1,235.
-- - 혼합 묶음상품 (과세 and 면세 기준상품 together): P is split by the price
--   ratio of its 기준상품.
--     과세 weight = Σ (과세 기준상품 price × 수량)
--     total weight = Σ (every 기준상품 price × 수량)
--     (the 판매가 of a 묶음상품 is split by its 기준상품's 판매가, the 매입가
--     by their 매입가; all of them VAT-inclusive)
--     과세 part T = round(P × 과세 weight / total weight)   (0.5 rounds up)
--     면세 part   = P - T
--     부가세      = floor(T / 11)
--     부가세 별도 = P - 부가세
--   When one of the 기준상품 has no such price, or the total weight is 0,
--   the price cannot be split: its 부가세 별도 and 부가세 stay empty (the
--   screen shows "-"; the VAT-inclusive price is still shown).
--   The future 정산 module uses this same rule.
-- - Changing a 기준상품's 과세구분 keeps its stored (VAT-inclusive) price;
--   the 부가세 별도 amount follows by itself.
-- - The app computes the same numbers while a form is being edited
--   (src/lib/products/vat.ts): change both together.
--
-- What this file does, in this order (each step needs the ones before it):
--  1. Helper functions for the rules above: vat_excluded_amount,
--     mixed_taxable_amount, mixed_vat_excluded_amount.
--  2. The view product_list_items is dropped (it lists the price columns).
--     It is created again in step 5.
--  3. Existing prices are NOT converted (the owner had already typed them
--     VAT-inclusive); only their columns are renamed in step 4.
--  4. The price columns are renamed so their meaning is clear:
--     purchase_price → purchase_price_incl_vat,
--     sale_price → sale_price_incl_vat (checks renamed too).
--  5. The view product_list_items is created again with the renamed columns
--     plus purchase_price_excl_vat, purchase_vat, sale_price_excl_vat,
--     sale_vat (worked out with the helpers of step 1).
--  6. create_bundle_product / update_bundle_product read the new JSON keys
--     purchase_price_incl_vat / sale_price_incl_vat (and refuse the old
--     ones, so an old app cannot silently save empty prices).
--  7. The API (PostgREST) is told to reload.
--
-- The Supabase CLI applies this whole file in one transaction: if any step
-- fails, nothing is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper functions (pure arithmetic, same results as src/lib/products/vat.ts)
--
-- Amounts are whole won. A negative amount (e.g. a refund in 정산 later)
-- gives the same numbers with a minus sign: the fraction is always dropped
-- toward zero, which is floor() for amounts of 0 or more.
-- They read no table: immutable, safe to use in views and indexes.
-- -----------------------------------------------------------------------------

-- 부가세 별도 amount of a VAT-inclusive amount.
-- taxable = true (과세): amount - floor(amount / 11); false (면세): amount.
-- Empty (null) when either argument is empty.
-- (bigint / integer drops the fraction: 12000 / 11 = 1090.)
create function public.vat_excluded_amount(amount_incl bigint, taxable boolean)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when taxable then amount_incl - amount_incl / 11
    else amount_incl
  end;
$$;

comment on function public.vat_excluded_amount(bigint, boolean) is '부가세 포함 금액의 부가세 별도 금액: 과세면 금액 - floor(금액/11) (부가세 원 미만 버림), 면세면 금액 그대로. 예: 과세 12,000 → 10,910';

-- 과세 part T of a 혼합 VAT-inclusive amount, split by weights:
-- T = round(amount × taxable_weight / total_weight), 0.5 rounded up.
-- Computed with whole numbers only (no rounding errors):
-- floor((2 × amount × taxable_weight + total_weight) / (2 × total_weight)).
-- Empty (null) when the weights cannot be used: missing, total_weight not
-- above 0, or taxable_weight below 0 or above total_weight.
create function public.mixed_taxable_amount(
  amount_incl bigint,
  taxable_weight numeric,
  total_weight numeric
)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when total_weight > 0
      and taxable_weight >= 0
      and taxable_weight <= total_weight
      then (
        sign(amount_incl::numeric)
        * div(
          2 * abs(amount_incl::numeric) * taxable_weight + total_weight,
          2 * total_weight
        )
      )::bigint
  end;
$$;

comment on function public.mixed_taxable_amount(bigint, numeric, numeric) is '혼합 묶음상품 가격(부가세 포함) 중 과세 부분: round(금액 × 과세 기준상품 가격합 / 전체 기준상품 가격합), 0.5는 올림. 가격합(가격 × 수량)을 알 수 없거나 전체가 0이면 비어 있음';

-- 부가세 별도 amount of a 혼합 VAT-inclusive amount:
-- amount - floor(T / 11), with T from mixed_taxable_amount (the 면세 part
-- has no 부가세). Empty (null) when the weights cannot be used.
create function public.mixed_vat_excluded_amount(
  amount_incl bigint,
  taxable_weight numeric,
  total_weight numeric
)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select amount_incl
    - public.mixed_taxable_amount(amount_incl, taxable_weight, total_weight) / 11;
$$;

comment on function public.mixed_vat_excluded_amount(bigint, numeric, numeric) is '혼합 묶음상품 가격(부가세 포함)의 부가세 별도 금액: 금액 - floor(과세 부분/11). 과세 부분은 mixed_taxable_amount. 가격합을 알 수 없으면 비어 있음';

-- Only signed-in employees (the view below runs with their permissions) and
-- the service role may call them; not-signed-in visitors (anon) and
-- everyone else (public) may not. Revoke first: Supabase gives new
-- functions default privileges.
revoke all on function public.vat_excluded_amount(bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.vat_excluded_amount(bigint, boolean)
  to authenticated, service_role;

revoke all on function public.mixed_taxable_amount(bigint, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.mixed_taxable_amount(bigint, numeric, numeric)
  to authenticated, service_role;

revoke all on function public.mixed_vat_excluded_amount(bigint, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.mixed_vat_excluded_amount(bigint, numeric, numeric)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The view product_list_items lists the price columns: drop it first.
--    It is created again in step 5. Nothing else depends on the view.
-- -----------------------------------------------------------------------------

drop view public.product_list_items;

-- -----------------------------------------------------------------------------
-- 3. Existing prices are kept as they are (no conversion)
--
-- Until this migration the price columns were labelled VAT-exclusive (부가세
-- 별도), but the owner confirmed on 2026-10-22 that the prices already in the
-- real database were typed VAT-INCLUSIVE (부가세 포함). So no amount changes
-- here: step 4 only renames the columns to say what they hold. Rows,
-- 수정자 and 수정 일시 are not touched.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. Rename the price columns (and their checks): they now hold the
--    VAT-inclusive amount.
-- -----------------------------------------------------------------------------

alter table public.products
  rename column purchase_price to purchase_price_incl_vat;
alter table public.products
  rename column sale_price to sale_price_incl_vat;

-- The checks keep their rule (empty or 0 or more); only the names change.
alter table public.products
  rename constraint products_purchase_price_check
  to products_purchase_price_incl_vat_check;
alter table public.products
  rename constraint products_sale_price_check
  to products_sale_price_incl_vat_check;

comment on column public.products.purchase_price_incl_vat is '기본 매입가 (원, 부가세 포함). 입력한 금액 그대로 저장합니다. 부가세 별도 금액은 저장하지 않고 계산합니다 (과세: 금액 - floor(금액/11), 면세: 그대로, 혼합 묶음상품: 구성 기준상품 매입가 비율로 나눠 계산)';
comment on column public.products.sale_price_incl_vat is '기본 판매가 (원, 부가세 포함). 입력한 금액 그대로 저장합니다. 부가세 별도 금액은 저장하지 않고 계산합니다 (과세: 금액 - floor(금액/11), 면세: 그대로, 혼합 묶음상품: 구성 기준상품 판매가 비율로 나눠 계산)';
comment on constraint products_purchase_price_incl_vat_check on public.products is '기본 매입가(부가세 포함)는 비어 있거나 0원 이상';
comment on constraint products_sale_price_incl_vat_check on public.products is '기본 판매가(부가세 포함)는 비어 있거나 0원 이상';

-- -----------------------------------------------------------------------------
-- 5. product_list_items: the product list's view, created again
--
-- Same columns as before (every products column, now with the renamed
-- prices; the category ids above the product's own; the 묶음상품 구성
-- summary; the effective_* food information), plus at the end:
-- - purchase_price_excl_vat / sale_price_excl_vat: 부가세 별도 amount of
--   the price, by the 과세구분 in effect (과세 / 면세 / 혼합, see the top
--   of this file);
-- - purchase_vat / sale_vat: the 부가세 (price - 부가세 별도).
-- They are empty when the price is empty, or for a 혼합 묶음상품 whose
-- 기준상품 do not all have that price (or the 기준상품 prices add up to 0).
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
  effective.tax_type as effective_tax_type,
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
  end as effective_manufacturer,
  excluded.purchase_price_excl_vat,
  product.purchase_price_incl_vat - excluded.purchase_price_excl_vat
    as purchase_vat,
  excluded.sale_price_excl_vat,
  product.sale_price_incl_vat - excluded.sale_price_excl_vat as sale_vat
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
    ) collate "default" as manufacturer,
    -- Weights for splitting a 혼합 묶음상품's price (mixed_taxable_amount):
    -- Σ 기준상품 price × 수량 of the 과세 기준상품, and of all of them.
    -- The total is empty when any 기준상품 has no such price.
    coalesce(
      sum(component.purchase_price_incl_vat::numeric * item.quantity)
        filter (where component.tax_type = 'taxable'),
      0
    ) as purchase_taxable_weight,
    case
      when count(component.purchase_price_incl_vat) = count(*)
        then sum(component.purchase_price_incl_vat::numeric * item.quantity)
    end as purchase_total_weight,
    coalesce(
      sum(component.sale_price_incl_vat::numeric * item.quantity)
        filter (where component.tax_type = 'taxable'),
      0
    ) as sale_taxable_weight,
    case
      when count(component.sale_price_incl_vat) = count(*)
        then sum(component.sale_price_incl_vat::numeric * item.quantity)
    end as sale_total_weight
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
  on product.product_type = 'bundle'
-- 과세구분 in effect: a 기준상품's own, a 묶음상품's worked out above.
cross join lateral (
  select
    case
      when product.product_type = 'bundle' then composition.tax_type
      else product.tax_type::text
    end as tax_type
) as effective
-- 부가세 별도 amounts of the two prices, by the 과세구분 in effect.
cross join lateral (
  select
    case effective.tax_type
      when 'taxable'
        then public.vat_excluded_amount(product.purchase_price_incl_vat, true)
      when 'exempt'
        then public.vat_excluded_amount(product.purchase_price_incl_vat, false)
      when 'mixed'
        then public.mixed_vat_excluded_amount(
          product.purchase_price_incl_vat,
          composition.purchase_taxable_weight,
          composition.purchase_total_weight
        )
    end as purchase_price_excl_vat,
    case effective.tax_type
      when 'taxable'
        then public.vat_excluded_amount(product.sale_price_incl_vat, true)
      when 'exempt'
        then public.vat_excluded_amount(product.sale_price_incl_vat, false)
      when 'mixed'
        then public.mixed_vat_excluded_amount(
          product.sale_price_incl_vat,
          composition.sale_taxable_weight,
          composition.sale_total_weight
        )
    end as sale_price_excl_vat
) as excluded;

comment on view public.product_list_items is '상품 목록용: 상품(기준상품·묶음상품)과 분류의 상위 분류 ID, 묶음상품 구성 요약, 실제로 적용되는 식품 정보(effective_*: 기준상품은 자기 값, 묶음상품은 구성 기준상품에서 계산), 가격의 부가세 별도 금액과 부가세. 미분류 상품도 포함됩니다.';
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
comment on column public.product_list_items.purchase_price_excl_vat is '기본 매입가의 부가세 별도 금액 (계산값): 과세는 매입가 - floor(매입가/11), 면세는 그대로, 혼합은 구성 기준상품 매입가 비율로 나눠 계산. 매입가가 없거나 혼합인데 구성 기준상품 매입가를 다 알 수 없으면 비어 있음';
comment on column public.product_list_items.purchase_vat is '기본 매입가의 부가세 (계산값): 매입가(부가세 포함) - 부가세 별도 금액. 계산할 수 없으면 비어 있음';
comment on column public.product_list_items.sale_price_excl_vat is '기본 판매가의 부가세 별도 금액 (계산값): 과세는 판매가 - floor(판매가/11), 면세는 그대로, 혼합은 구성 기준상품 판매가 비율로 나눠 계산. 판매가가 없거나 혼합인데 구성 기준상품 판매가를 다 알 수 없으면 비어 있음';
comment on column public.product_list_items.sale_vat is '기본 판매가의 부가세 (계산값): 판매가(부가세 포함) - 부가세 별도 금액. 계산할 수 없으면 비어 있음';

-- Only signed-in employees may read the view; visitors who are not signed in
-- (anon) get nothing. Revoke first: Supabase may give new views default
-- privileges.
revoke all on table public.product_list_items from anon, authenticated;
grant select on table public.product_list_items to authenticated;
grant select on table public.product_list_items to service_role;

-- -----------------------------------------------------------------------------
-- 6. Saving a 묶음상품: the price keys of the JSON argument are renamed
--
-- Same functions as before (same arguments, same checks), except:
--   product: {"code", "name", "category_id", "spec", "unit",
--             "purchase_price_incl_vat", "sale_price_incl_vat", "barcode",
--             "is_active", "note"}
--            (prices VAT-inclusive, as typed; empty optional values are null)
-- The old keys "purchase_price" / "sale_price" are refused (hint
-- 'price_keys_renamed'): an app from before this change would otherwise save
-- the prices as empty without anyone noticing.
-- CREATE OR REPLACE keeps the functions' privileges (signed-in employees and
-- the service role only).
-- -----------------------------------------------------------------------------

-- 묶음상품 등록. Returns the new product's id.
create or replace function public.create_bundle_product(product jsonb, items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  -- Old price keys (from before prices were VAT-inclusive).
  if product ? 'purchase_price' or product ? 'sale_price' then
    raise exception '가격 입력 방식이 바뀌었습니다(부가세 포함 금액). 화면을 새로 고친 뒤 다시 저장해 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'price_keys_renamed';
  end if;

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
    purchase_price_incl_vat, sale_price_incl_vat, barcode, is_active, note
  )
  values (
    'bundle',
    product ->> 'code',
    product ->> 'name',
    (product ->> 'category_id')::uuid,
    product ->> 'spec',
    product ->> 'unit',
    (product ->> 'purchase_price_incl_vat')::bigint,
    (product ->> 'sale_price_incl_vat')::bigint,
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

comment on function public.create_bundle_product(jsonb, jsonb) is '묶음상품 등록: 상품과 구성표(기준상품 × 수량)를 한 번에 저장합니다. 가격은 부가세 포함 금액(purchase_price_incl_vat, sale_price_incl_vat)입니다. 새 상품 ID를 돌려줍니다.';

-- 묶음상품 수정. Replaces the product's fields and its whole 구성표.
-- loaded_updated_at = the product's updated_at when the form was opened: if
-- someone saved it after that, nothing is saved (the older form would
-- silently undo the other person's changes). Returns the product's id.
create or replace function public.update_bundle_product(
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
  -- Old price keys (from before prices were VAT-inclusive).
  if product ? 'purchase_price' or product ? 'sale_price' then
    raise exception '가격 입력 방식이 바뀌었습니다(부가세 포함 금액). 화면을 새로 고친 뒤 다시 저장해 주세요.'
      using errcode = 'invalid_parameter_value', hint = 'price_keys_renamed';
  end if;

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
    purchase_price_incl_vat = (product ->> 'purchase_price_incl_vat')::bigint,
    sale_price_incl_vat = (product ->> 'sale_price_incl_vat')::bigint,
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

comment on function public.update_bundle_product(uuid, timestamptz, jsonb, jsonb) is '묶음상품 수정: 상품 정보와 구성표 전체를 한 번에 바꿉니다. 가격은 부가세 포함 금액(purchase_price_incl_vat, sale_price_incl_vat)입니다. 창을 연 뒤 다른 사람이 먼저 저장했으면(updated_at이 다르면) 저장하지 않습니다.';

-- -----------------------------------------------------------------------------
-- 7. Tell the API (PostgREST) to reload its picture of the database, so the
--    renamed columns, the new view columns and the functions are usable
--    right away.
-- -----------------------------------------------------------------------------

notify pgrst, 'reload schema';
