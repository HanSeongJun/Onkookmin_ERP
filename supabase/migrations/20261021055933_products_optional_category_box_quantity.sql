-- =============================================================================
-- 상품관리 update: 분류 is optional (미분류) and new 박스입수량 (box_quantity)
--
-- Runs after 20261021022829_create_products.sql, which is already applied to
-- the real (hosted) database. That file is never edited; every change to the
-- schema goes into a new migration like this one.
--
-- What changes:
-- 1. products.category_id may be empty (null). A product without a category
--    is "미분류" (uncategorized), so products can be registered before any
--    분류 exists. The foreign key (on delete restrict) stays: a category that
--    products use still cannot be deleted.
-- 2. New column products.box_quantity (박스입수량): how many units of the
--    product's unit are in one box, 1–100000, default 1. Information only:
--    the app does not convert quantities with it. Existing products get 1.
-- 3. The view product_list_items is created again so that it has the new
--    column and also lists 미분류 products (LEFT JOIN instead of JOIN).
--
-- Row Level Security, policies and table privileges of products do not
-- change. Table-level privileges (select, insert, update for authenticated)
-- automatically cover the new column.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 분류 is optional: null = 미분류
-- -----------------------------------------------------------------------------

-- Allow products without a category. Rows that already have a category keep
-- it. The foreign key products_category_id_fkey is not touched: a filled-in
-- category_id must still point to an existing category, and a category in use
-- still cannot be deleted (on delete restrict). The index
-- products_category_id_idx also covers "category_id is null" searches.
alter table public.products
  alter column category_id drop not null;

comment on column public.products.category_id is '분류 ID (대분류·중분류·소분류 중 하나). 비어 있으면 미분류';

-- -----------------------------------------------------------------------------
-- 2. 박스입수량 (box_quantity)
-- -----------------------------------------------------------------------------

-- New required column with default 1. Existing rows get 1 right away (a
-- constant default does not rewrite the table). The check keeps the value a
-- whole number from 1 to 100000 (same limits as BOX_QUANTITY in
-- src/lib/products/constants.ts).
alter table public.products
  add column box_quantity integer not null default 1,
  add constraint products_box_quantity_check
    check (box_quantity between 1 and 100000);

comment on column public.products.box_quantity is '박스입수량: 한 박스에 들어 있는 수량 (상품 단위 기준, 1~100000, 기본 1). 참고용이며 수량 환산에는 쓰지 않습니다';

-- -----------------------------------------------------------------------------
-- 3. product_list_items: created again with box_quantity and 미분류 products
--
-- "product.*" is turned into a fixed list of columns when a view is created,
-- so the old view does not see box_quantity. A view's columns cannot be
-- reordered with "create or replace view", so the view is dropped and created
-- again; dropping it also drops its comments and privileges, which are set
-- again below exactly as in the first migration. Nothing else in the database
-- depends on this view.
--
-- Same purpose as before: the two extra columns let the product list filter
-- by a category on any level with one short request
-- ("category_id = X or category_parent_id = X or category_grandparent_id = X").
-- The category is now joined with LEFT JOIN, so a 미분류 product (category_id
-- is null) is still listed; its category_id, category_parent_id and
-- category_grandparent_id are then all empty (null).
-- security_invoker: the view uses the permissions (RLS) of the employee
-- asking, exactly like the products table.
-- -----------------------------------------------------------------------------

drop view public.product_list_items;

create view public.product_list_items
with (security_invoker = true)
as
select
  product.*,
  category.parent_id as category_parent_id,
  parent_category.parent_id as category_grandparent_id
from public.products as product
left join public.product_categories as category
  on category.id = product.category_id
left join public.product_categories as parent_category
  on parent_category.id = category.parent_id;

comment on view public.product_list_items is '상품 목록용: 상품과 그 분류의 상위 분류 ID(중분류·대분류). 분류 필터에 사용합니다. 미분류 상품도 포함되며, 이때 분류 ID 칸은 모두 비어 있습니다.';
comment on column public.product_list_items.category_parent_id is '상품 분류의 상위 분류 ID (없거나 미분류면 비어 있음)';
comment on column public.product_list_items.category_grandparent_id is '상품 분류의 상위의 상위 분류 ID (없거나 미분류면 비어 있음)';

-- Only signed-in employees may read the view; visitors who are not signed in
-- (anon) get nothing. Revoke first: Supabase may give new views default
-- privileges.
revoke all on table public.product_list_items from anon, authenticated;
grant select on table public.product_list_items to authenticated;
grant select on table public.product_list_items to service_role;

-- Tell the API (PostgREST) to reload its picture of the database, so the new
-- column and the new view are usable right away.
notify pgrst, 'reload schema';
