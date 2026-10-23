-- =============================================================================
-- LOCAL TEST DATA ONLY
-- Runs automatically on `npx supabase db reset` (local Docker stack).
-- It is NOT sent to the real (hosted) database by `npm run db:push`.
-- The real database starts with no categories: the owner adds them in the app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 대분류 (level 1)
-- 양념·소스 and 기타 have no 중분류: their products sit in the 대분류.
-- -----------------------------------------------------------------------------

insert into public.product_categories (name, sort_order) values
  ('농산물', 1),
  ('수산물', 2),
  ('축산물', 3),
  ('가공식품', 4),
  ('양념·소스', 5),
  ('기타', 6);

-- -----------------------------------------------------------------------------
-- 중분류 (level 2, under a 대분류)
-- 활어 is switched off (사용 중지) and still has 소분류 under it.
-- -----------------------------------------------------------------------------

insert into public.product_categories (name, parent_id, sort_order, is_active)
select v.name, top.id, v.sort_order, v.is_active
from (
  values
    ('농산물', '채소', 1, true),
    ('농산물', '과일', 2, true),
    ('농산물', '곡류', 3, true),
    ('수산물', '냉동수산', 1, true),
    ('수산물', '건어물', 2, true),
    ('수산물', '활어', 3, false),
    ('축산물', '돈육', 1, true),
    ('축산물', '우육', 2, true),
    ('축산물', '계육', 3, true),
    ('가공식품', '냉동식품', 1, true),
    ('가공식품', '면류', 2, true),
    ('가공식품', '유제품', 3, true)
) as v (top_name, name, sort_order, is_active)
join public.product_categories as top
  on top.name = v.top_name and top.parent_id is null;

-- -----------------------------------------------------------------------------
-- 소분류 (level 3, under a 중분류)
-- 버섯류 and 우럭 have no products (they can be deleted in the app).
-- -----------------------------------------------------------------------------

insert into public.product_categories (name, parent_id, sort_order, is_active)
select v.name, mid.id, v.sort_order, v.is_active
from (
  values
    ('농산물', '채소', '엽채류', 1, true),
    ('농산물', '채소', '조미채소', 2, true),
    ('농산물', '채소', '버섯류', 3, true),
    ('수산물', '냉동수산', '새우', 1, true),
    ('수산물', '냉동수산', '오징어', 2, true),
    ('수산물', '활어', '광어', 1, true),
    ('수산물', '활어', '우럭', 2, true),
    ('가공식품', '냉동식품', '만두', 1, true),
    ('가공식품', '유제품', '치즈', 1, true)
) as v (top_name, mid_name, name, sort_order, is_active)
join public.product_categories as top
  on top.name = v.top_name and top.parent_id is null
join public.product_categories as mid
  on mid.name = v.mid_name and mid.parent_id = top.id;

-- -----------------------------------------------------------------------------
-- 기준상품 (sample base products: single units, "개입")
-- top_name = 대분류, mid_name = 중분류, sub_name = 소분류. The product is put
-- into the deepest one given (null = it sits one level higher). All three
-- null = 미분류 (no category). product_type is left out: the default is
-- 'base' (기준상품).
-- Prices are VAT-INCLUSIVE (부가세 포함), as employees type them; the
-- 부가세 별도 amount is worked out (view product_list_items), e.g.
-- 샌드위치햄 (과세) 판매가 12,000 → 부가세 1,090, 부가세 별도 10,910;
-- 면세 prices such as 복숭아 35,000 have no 부가세.
-- -----------------------------------------------------------------------------

insert into public.products (
  code, name, category_id, spec, unit, storage_type, tax_type,
  purchase_price_incl_vat, sale_price_incl_vat, origin, manufacturer,
  shelf_life_days, barcode, allergens, is_active, note
)
select
  v.code,
  v.name,
  coalesce(sub.id, mid.id, top.id),
  v.spec,
  v.unit,
  v.storage_type::public.storage_type,
  v.tax_type::public.tax_type,
  v.purchase_price_incl_vat,
  v.sale_price_incl_vat,
  v.origin,
  v.manufacturer,
  v.shelf_life_days,
  v.barcode,
  v.allergens::text[],
  v.is_active,
  v.note
from (
  values
    -- 농산물
    ('VEG-001', '양파', '농산물', '채소', '조미채소', '15kg', '망', 'room', 'exempt', 16500, 19800, '국산(전남 무안)', null, null, null, '{}', true, null),
    ('VEG-002', '대파', '농산물', '채소', '조미채소', '1kg', '단', 'chilled', 'exempt', null, null, null, null, null, null, '{}', true, null),
    ('VEG-003', '깐마늘', '농산물', '채소', '조미채소', '1kg', '봉', 'chilled', 'exempt', 9500, 11500, '국산(경북 의성)', null, 14, null, '{}', true, null),
    ('VEG-004', '감자(수미)', '농산물', '채소', null, '20kg', '박스', 'room', 'exempt', 32000, 37000, '국산(강원 평창)', null, null, null, '{}', true, '햇감자는 9~10월 입고'),
    ('VEG-005', '양배추', '농산물', '채소', '엽채류', '3입(8kg 내외)', '망', 'chilled', 'exempt', 9000, 11000, '국산(제주)', null, null, null, '{}', true, null),
    ('VEG-006', '청양고추', '농산물', '채소', '조미채소', '4kg', '박스', 'chilled', 'exempt', 28000, 33000, '국산', null, 10, null, '{}', true, null),
    ('VEG-007', '깻잎', '농산물', '채소', '엽채류', '100매', '봉', 'chilled', 'exempt', 2500, 3200, '국산(충남 금산)', null, 5, null, '{}', false, '거래처 변경으로 사용 중지'),
    ('FRU-001', '방울토마토', '농산물', '과일', null, '5kg', '박스', 'chilled', 'exempt', 25000, 29000, '국산(전북 장수)', null, 10, null, '{tomato}', true, null),
    ('FRU-002', '복숭아(백도)', '농산물', '과일', null, '4.5kg(12과)', '박스', 'chilled', 'exempt', 35000, 42000, '국산(경북 영천)', null, 7, null, '{peach}', false, '제철 상품(7~9월)'),
    ('FRU-003', '건살구', '농산물', '과일', null, '1kg', '봉', 'room', 'taxable', 15400, 18700, '터키', null, 365, null, '{sulfites}', true, null),
    ('GRN-001', '쌀(백미)', '농산물', '곡류', null, '20kg', '포', 'room', 'exempt', 54000, 59000, '국산(경기 이천)', '이천농협', null, null, '{}', true, null),
    ('NUT-001', '호두 분태', '농산물', null, null, '1kg', '봉', 'chilled', 'exempt', 18000, 22000, '미국', null, 365, null, '{walnut}', true, null),
    ('NUT-002', '잣', '농산물', null, null, '1kg', '봉', 'chilled', 'exempt', 68000, 79000, '중국', null, 365, null, '{pine_nut}', true, null),
    -- 수산물
    ('SEA-001', '냉동 흰다리새우(31/40)', '수산물', '냉동수산', '새우', '900g', '팩', 'frozen', 'exempt', 12500, 14900, '베트남', '바다마을', 730, '8801000001019', '{shrimp}', true, null),
    ('SEA-002', '냉동 오징어(손질)', '수산물', '냉동수산', '오징어', '1kg', '팩', 'frozen', 'exempt', 9800, 11900, '페루', '바다마을', 540, null, '{squid}', true, null),
    ('SEA-003', '냉동 고등어 필렛', '수산물', '냉동수산', null, '1kg(8~10쪽)', '팩', 'frozen', 'exempt', 11000, 13500, '노르웨이', null, 540, null, '{mackerel}', true, null),
    ('SEA-004', '냉동 절단꽃게', '수산물', '냉동수산', null, '1kg', '팩', 'frozen', 'exempt', 15000, 18500, '중국', null, 365, null, '{crab}', true, null),
    ('SEA-005', '생굴(봉지굴)', '수산물', null, null, '1kg', '봉', 'chilled', 'exempt', 13000, 16000, '국산(경남 통영)', null, 7, null, '{shellfish}', true, '11~2월 제철'),
    ('SEA-006', '활광어', '수산물', '활어', '광어', '1kg 내외', '마리', 'chilled', 'exempt', 18000, 22000, '국산(제주)', null, null, null, '{}', false, '활어 취급 중단으로 사용 중지'),
    ('DRY-001', '국물용 멸치', '수산물', '건어물', null, '1.5kg', '박스', 'chilled', 'exempt', 27000, 32000, '국산(경남 통영)', null, 365, null, '{}', true, null),
    ('DRY-002', '마른김(재래)', '수산물', '건어물', null, '100매', '봉', 'room', 'exempt', 9000, 11000, '국산(전남 완도)', null, 365, null, '{}', true, null),
    -- 축산물
    ('MEA-001', '돼지 삼겹살', '축산물', '돈육', null, null, 'kg', 'chilled', 'exempt', 21000, 24500, '국산', null, 10, null, '{pork}', true, '원육, kg 단위 거래'),
    ('MEA-002', '돼지 앞다리살(냉동)', '축산물', '돈육', null, '원육', 'kg', 'frozen', 'exempt', 7800, 9200, '스페인', null, 730, null, '{pork}', true, null),
    ('MEA-003', '소 척롤(불고기용)', '축산물', '우육', null, '슬라이스', 'kg', 'frozen', 'exempt', 16500, 19800, '호주', null, 730, null, '{beef}', true, null),
    ('MEA-004', '닭다리살 정육', '축산물', '계육', null, '2kg', '봉', 'frozen', 'exempt', 11000, 13500, '브라질', null, 540, null, '{chicken}', true, null),
    ('EGG-001', '계란(특란)', '축산물', null, null, '30구', '판', 'chilled', 'exempt', 6200, 7300, '국산', null, 30, null, '{egg}', true, null),
    -- 가공식품
    ('PRC-001', '고기만두', '가공식품', '냉동식품', '만두', '1.4kg', '봉', 'frozen', 'taxable', 8700, 9900, '국산', '한빛식품', 270, '8801000001026', '{wheat,soybean,pork}', true, null),
    ('PRC-002', '우동사리', '가공식품', '면류', null, '230g×5입', '봉', 'chilled', 'taxable', 3500, 4300, '국산', '한빛식품', 60, '8801000001033', '{wheat}', true, null),
    ('PRC-003', '냉면사리(메밀)', '가공식품', '면류', null, '2kg', '봉', 'chilled', 'taxable', 6200, 7600, null, '한빛식품', 90, null, '{buckwheat,wheat}', true, null),
    ('PRC-004', '슬라이스 체다치즈', '가공식품', '유제품', '치즈', '1.8kg(100매)', '팩', 'chilled', 'taxable', 21500, 25900, '미국', '데어리팜', 180, '8801000001040', '{milk}', true, null),
    ('PRC-005', '참치캔(대용량)', '가공식품', null, null, '1.88kg', '캔', 'room', 'taxable', 23100, 27500, '태국', null, 1095, '8801000001057', '{}', true, null),
    ('PRC-006', '샌드위치햄', '가공식품', null, null, '1kg', '팩', 'chilled', 'taxable', 9800, 12000, null, '한빛식품', 60, null, '{pork,soybean,wheat}', false, '제조사 단종'),
    ('PRC-007', '땅콩버터', '가공식품', null, null, '1kg', '병', 'room', 'taxable', 10800, 12900, '미국', null, 365, null, '{peanut}', true, null),
    ('PRC-010', '스팸 클래식 1.81kg', '가공식품', null, null, '1.81kg', '캔', 'room', 'taxable', 23700, 28500, '국산', 'CJ제일제당', 1095, '8801000001125', '{pork}', true, '묶음상품 예시의 기준상품'),
    -- 양념·소스
    ('SAU-001', '진간장', '양념·소스', null, null, '13L', '통', 'room', 'taxable', 26400, 31400, null, '장맛식품', 730, '8801000001064', '{soybean,wheat}', true, null),
    ('SAU-002', '고추장', '양념·소스', null, null, '14kg', '통', 'room', 'taxable', 57200, 67000, '국산', '장맛식품', 540, '8801000001071', '{wheat,soybean}', true, null),
    ('SAU-003', '토마토케첩', '양념·소스', null, null, '3.3kg', '통', 'room', 'taxable', 7600, 9100, null, null, 540, '8801000001088', '{tomato}', true, null),
    ('SAU-004', '카놀라유', '양념·소스', null, null, '18L', '캔', 'room', 'taxable', 50600, 58300, '캐나다', null, 730, null, '{}', true, null),
    ('SAU-005', '굴소스', '양념·소스', null, null, '2.2kg', '병', 'room', 'taxable', 13800, 16500, '중국', null, 730, '8801000001095', '{shellfish,wheat,soybean}', true, null),
    -- 기타
    ('ETC-001', '생수', '기타', null, null, '2L×6입', '팩', 'room', 'taxable', 3300, 3900, null, null, 365, '8801000001101', '{}', true, null),
    -- 미분류 (no category yet; one of them is 사용 중지)
    ('SAU-006', '참기름', null, null, null, '1.8L', '병', 'room', 'taxable', 20400, 24200, '중국', '장맛식품', 540, '8801000001118', '{}', true, null),
    ('PRC-008', '떡볶이떡(밀떡)', null, null, null, '1kg', '봉', 'chilled', 'taxable', 2600, 3200, '국산', '한빛식품', 30, null, '{wheat}', true, '분류 정리 전 신규 등록'),
    ('FRU-004', '냉동 블루베리', null, null, null, '1kg', '봉', 'frozen', 'exempt', 8500, 10500, '칠레', null, 730, null, '{}', true, null),
    ('PRC-009', '사각어묵', null, null, null, '1kg', '봉', 'chilled', 'taxable', 4700, 5700, '국산', '바다마을', 30, null, '{wheat,soybean}', false, '거래 중단')
) as v (
  code, name, top_name, mid_name, sub_name, spec, unit, storage_type, tax_type,
  purchase_price_incl_vat, sale_price_incl_vat, origin, manufacturer,
  shelf_life_days, barcode, allergens, is_active, note
)
left join public.product_categories as top
  on top.name = v.top_name and top.parent_id is null
left join public.product_categories as mid
  on mid.name = v.mid_name and mid.parent_id = top.id
left join public.product_categories as sub
  on sub.name = v.sub_name and sub.parent_id = mid.id
-- A misspelled 대분류/중분류/소분류 name drops the row (the check below then
-- fails) instead of quietly putting the product one level higher or making
-- it 미분류.
where (v.top_name is null or top.id is not null)
  and (v.mid_name is null or mid.id is not null)
  and (v.sub_name is null or sub.id is not null);

-- -----------------------------------------------------------------------------
-- 묶음상품 (sample bundles) and their 구성표 (product_bundle_items)
-- A 묶음상품 has no food information of its own: 보관온도, 과세구분,
-- 알레르기, 유통기한 기준일수, 원산지, 제조사 are worked out from its
-- 기준상품 (see the view product_list_items).
-- - PRC-010-6 / PRC-010-24: one 기준상품 (스팸) × 6 and × 24.
-- - PRC-010-SET: 스팸 × 2 + 참치 × 3 (과세) + 김 × 1 (면세) → 과세구분 "혼합".
--   Its price (부가세 포함) is split by the 기준상품 prices × 수량 into a
--   과세 and a 면세 part; only the 과세 part has 부가세.
-- - SEA-001-SET: 냉동 새우·오징어 + 굴소스 (상온) → 보관온도 "냉동" (the
--   strictest), 과세구분 "혼합", 유통기한 기준일수 540 (the shortest).
-- Prices are VAT-inclusive (부가세 포함) like the 기준상품 above.
-- - PRC-006-5: 사용 중지 (its 기준상품 샌드위치햄 is 사용 중지 too; a
--   사용 묶음상품 may not contain a 사용 중지 기준상품).
-- The app saves bundles through create_bundle_product / update_bundle_product;
-- this file inserts the rows directly (same checks run on both).
-- "A 묶음상품 has at least one 기준상품" is checked when the transaction ends:
-- `npx supabase db reset` runs this whole file as one transaction, so the
-- 묶음상품 below and their 구성표 rows (next statement) are checked together.
-- -----------------------------------------------------------------------------

insert into public.products (
  product_type, code, name, category_id, spec, unit,
  purchase_price_incl_vat, sale_price_incl_vat, barcode, is_active, note
)
select
  'bundle',
  v.code,
  v.name,
  coalesce(mid.id, top.id),
  v.spec,
  v.unit,
  v.purchase_price_incl_vat,
  v.sale_price_incl_vat,
  v.barcode,
  v.is_active,
  v.note
from (
  values
    ('PRC-010-6', '[묶음] 스팸 클래식 1.81kg X 6개입', '가공식품', null, '1.81kg×6', '묶음', 140000, 168000, null, true, null),
    ('PRC-010-24', '[박스] 스팸 클래식 1.81kg X 24개입', '가공식품', null, '1.81kg×24', '박스', 552000, 657600, '8801000001132', true, '박스 단위 출고'),
    ('PRC-010-SET', '[묶음] 스팸 클래식 1.81kg 2개 + 참치캔(대용량) 3개 + 마른김(재래) 1개', '가공식품', null, null, '세트', 121000, 145000, null, true, '선물세트 (과세·면세 상품 혼합)'),
    ('SEA-001-SET', '[묶음] 냉동 흰다리새우(31/40) 2개 + 냉동 오징어(손질) 2개 + 굴소스 1개', '수산물', '냉동수산', null, '세트', 58000, 69000, null, true, null),
    ('PRC-006-5', '[묶음] 샌드위치햄 X 5개입', '가공식품', null, '1kg×5', '묶음', 48000, 58000, null, false, '구성 기준상품(샌드위치햄) 단종으로 사용 중지')
) as v (
  code, name, top_name, mid_name, spec, unit,
  purchase_price_incl_vat, sale_price_incl_vat, barcode, is_active, note
)
left join public.product_categories as top
  on top.name = v.top_name and top.parent_id is null
left join public.product_categories as mid
  on mid.name = v.mid_name and mid.parent_id = top.id
where (v.top_name is null or top.id is not null)
  and (v.mid_name is null or mid.id is not null);

insert into public.product_bundle_items (bundle_id, component_id, quantity, sort_order)
select bundle.id, component.id, v.quantity, v.sort_order
from (
  values
    ('PRC-010-6', 'PRC-010', 6, 0),
    ('PRC-010-24', 'PRC-010', 24, 0),
    ('PRC-010-SET', 'PRC-010', 2, 0),
    ('PRC-010-SET', 'PRC-005', 3, 1),
    ('PRC-010-SET', 'DRY-002', 1, 2),
    ('SEA-001-SET', 'SEA-001', 2, 0),
    ('SEA-001-SET', 'SEA-002', 2, 1),
    ('SEA-001-SET', 'SAU-005', 1, 2),
    ('PRC-006-5', 'PRC-006', 5, 0)
) as v (bundle_code, component_code, quantity, sort_order)
join public.products as bundle
  on bundle.code = v.bundle_code
join public.products as component
  on component.code = v.component_code;

-- Stop the reset when a sample product did not find its category, or a
-- 구성표 row did not find its products.
do $$
begin
  if (select count(*) from public.products where product_type = 'base') <> 44 then
    raise exception 'seed.sql: expected 44 sample 기준상품, got %. Check the category names in the product list above.',
      (select count(*) from public.products where product_type = 'base');
  end if;
  if (select count(*) from public.products where product_type = 'bundle') <> 5 then
    raise exception 'seed.sql: expected 5 sample 묶음상품, got %. Check the category names in the bundle list above.',
      (select count(*) from public.products where product_type = 'bundle');
  end if;
  if (select count(*) from public.products where category_id is null) <> 4 then
    raise exception 'seed.sql: expected 4 미분류 sample products, got %.',
      (select count(*) from public.products where category_id is null);
  end if;
  if (select count(*) from public.product_bundle_items) <> 9 then
    raise exception 'seed.sql: expected 9 구성표 rows, got %. Check the product codes in the 구성표 list above.',
      (select count(*) from public.product_bundle_items);
  end if;
end;
$$;

-- =============================================================================
-- 직원 · 거래처분류 · 거래처 (sample data for 거래처관리 and 직원관리)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 직원 (employees), 직원관리
-- 영업담당 (is_sales_rep) = a sales channel / platform (쿠팡, 스마트스토어,
-- 배민상회, 식봄) or a salesperson; 배송담당 (is_delivery_driver) = a
-- direct-delivery driver (운영형태 직영 / 지입 / 용차). 오세훈 has both;
-- 관리자 has neither (he is in no 거래처 picker).
-- Changed further below, AFTER partners were given them (a partner keeps an
-- employee whose status or 담당업무 changed later; only a newly chosen one
-- must be 재직 and have the 담당업무):
-- - 한상우 (배송담당 of 6 partners) and 식봄 (영업담당 of 100024) → 퇴사;
-- - 김도경 (배송담당 of 100019) loses 담당업무 배송담당 (now 물류팀 사무).
-- -----------------------------------------------------------------------------

insert into public.employees (
  code, name, is_sales_rep, is_delivery_driver, hire_date, mobile, mobile2,
  phone, email, postal_code, address, address_detail, department, job_title,
  employment_type, is_salary_paid, driver_operation_type, vehicle_number,
  vehicle_type, note
)
select
  v.code, v.name, v.is_sales_rep, v.is_delivery_driver, v.hire_date::date,
  v.mobile, v.mobile2, v.phone, v.email, v.postal_code, v.address,
  v.address_detail, v.department, v.job_title,
  v.employment_type::public.employment_type, v.is_salary_paid,
  v.driver_operation_type::public.driver_operation_type, v.vehicle_number,
  v.vehicle_type::public.vehicle_type, v.note
from (
  values
    ('0001', '관리자', false, false, '2019-03-04', '01023450001', null, '0212340000', 'admin@food-erp.test', '04524', '서울 중구 을지로 100', '본사 3층', '경영지원팀', '대표', 'regular', true, null, null, null, '시스템 관리'),
    ('0002', '김영길', true, false, '2020-04-01', '01023451001', null, null, 'yg.kim@food-erp.test', null, null, null, '영업팀', '차장', 'regular', true, null, null, null, null),
    ('0003', '박지훈', true, false, '2021-07-01', '01023451002', '01098761002', null, 'jh.park@food-erp.test', null, null, null, '영업팀', '과장', 'regular', true, null, null, null, null),
    ('0004', '이수진', true, false, '2024-02-13', '01023451003', null, null, 'sj.lee@food-erp.test', null, null, null, '영업팀', '대리', 'contract', true, null, null, null, '신규 거래처 개척 담당'),
    ('0005', '쿠팡', true, false, '2025-09-01', '15771234', null, null, 'partner@coupang.test', null, null, null, '온라인 판매', null, 'other', false, null, null, null, '쿠팡 입점 판매 채널'),
    ('0006', '스마트스토어', true, false, '2025-09-01', '16881234', null, null, null, null, null, null, '온라인 판매', null, 'other', false, null, null, null, '네이버 스마트스토어 판매 채널'),
    ('0007', '배민상회', true, false, '2025-09-01', '16005678', null, null, null, null, null, null, '온라인 판매', null, 'other', false, null, null, null, null),
    ('0008', '식봄', true, false, '2025-09-01', '15449999', null, null, null, null, null, null, '온라인 판매', null, 'other', false, null, null, null, '2026년 8월 입점 종료'),
    ('0009', '최민호', false, true, '2020-05-11', '01023451004', null, null, null, '13487', '경기 성남시 분당구 판교역로 10', '101동 1001호', '배송팀', '팀장', 'regular', true, 'direct', '80가1234', 'frozen_truck', '1톤 냉동탑차 1호'),
    ('0010', '정대현', false, true, '2023-03-02', '01023451005', null, null, null, null, null, null, '배송팀', '주임', 'regular', true, 'consigned', '경기12바3456', 'refrigerated_truck', '1톤 냉장탑차 (지입)'),
    ('0011', '한상우', false, true, '2022-01-03', '01023451006', null, null, null, null, null, null, '배송팀', null, 'contract', true, 'direct', '80가5678', 'box_truck', null),
    ('0012', '용차1', false, true, '2026-07-01', '01055550012', null, null, null, null, null, null, null, null, 'daily', false, 'chartered', null, 'cargo_truck', '필요할 때 부르는 용차'),
    ('0013', '김도경', false, true, '2026-07-01', '01055550013', null, null, null, null, null, null, '물류팀', '사원', 'freelancer', true, 'consigned', '서울85사1234', 'small_van', null),
    ('0014', '오세훈', true, true, '2025-11-17', '01055550014', null, '0315550014', null, null, null, null, '영업배송팀', '대리', 'regular', true, 'direct', '경기80아4321', 'refrigerated_truck', '영업과 배송을 함께 맡음')
) as v (
  code, name, is_sales_rep, is_delivery_driver, hire_date, mobile, mobile2,
  phone, email, postal_code, address, address_detail, department, job_title,
  employment_type, is_salary_paid, driver_operation_type, vehicle_number,
  vehicle_type, note
);

-- -----------------------------------------------------------------------------
-- 거래처분류 (partner_categories): 대분류 → 중분류 → 소분류
--   오프라인 거래처 > 외식업 > 주요 거래처 / 일반 거래처 / 프랜차이즈
--   오프라인 거래처 > 급식·위탁
--   온라인 거래처 > 신규 개척            (no partners: it can be deleted)
--   온라인 거래처 > 오픈마켓 (사용 중지) > 스마트스토어 입점 (사용, but
--                                         hidden by its switched-off parent)
--   거래 중단 예정 (사용 중지, switched off below; one partner keeps it)
-- Names are unique in this sample, so partners below find them by name.
-- -----------------------------------------------------------------------------

insert into public.partner_categories (name, sort_order) values
  ('오프라인 거래처', 1),
  ('온라인 거래처', 2),
  ('거래 중단 예정', 3);

insert into public.partner_categories (name, parent_id, sort_order, is_active)
select v.name, parent.id, v.sort_order, v.is_active
from (
  values
    ('오프라인 거래처', '외식업', 1, true),
    ('오프라인 거래처', '급식·위탁', 2, true),
    ('온라인 거래처', '신규 개척', 1, true),
    ('온라인 거래처', '오픈마켓', 2, false)
) as v (parent_name, name, sort_order, is_active)
join public.partner_categories as parent
  on parent.name = v.parent_name and parent.parent_id is null;

insert into public.partner_categories (name, parent_id, sort_order)
select v.name, parent.id, v.sort_order
from (
  values
    ('외식업', '주요 거래처', 1),
    ('외식업', '일반 거래처', 2),
    ('외식업', '프랜차이즈', 3),
    ('오픈마켓', '스마트스토어 입점', 1)
) as v (parent_name, name, sort_order)
join public.partner_categories as parent
  on parent.name = v.parent_name;

-- -----------------------------------------------------------------------------
-- 거래처 (partners): 26 매출처 (100xxx), 9 매입처 (200xxx), 5 매출·매입
-- (300xxx). Phone numbers and 사업자등록번호 are digits only (the app shows
-- 02-1234-5678 and 123-45-67890). Every 사업자등록번호 has a valid check
-- digit. 100001/100012 and 100002/100017 share one 사업자등록번호 (the app
-- warns about it). 4 partners are 미사용; the ones with category_name null
-- are 미분류. 영업담당 / 배송담당 / 거래처분류 are looked up by name.
-- Platforms as 영업담당: 100010/100011 배민상회, 100015 스마트스토어,
-- 100025 쿠팡, 100024 식봄 (퇴사 below).
-- -----------------------------------------------------------------------------

insert into public.partners (
  code, partner_type, name, phone, industry, sales_rep_id, delivery_rep_id,
  category_id, payment_term, payment_day, credit_limit_type, credit_limit,
  invoice_type, slip_print, business_number, company_name, representative,
  business_category, business_item, postal_code, address, address_detail,
  tax_email, note, is_active
)
select
  v.code,
  v.partner_type::public.partner_type,
  v.name,
  v.phone,
  v.industry::public.partner_industry,
  sales_rep.id,
  delivery_rep.id,
  category.id,
  v.payment_term::public.payment_term,
  v.payment_day,
  v.credit_limit_type::public.credit_limit_type,
  v.credit_limit,
  v.invoice_type::public.invoice_type,
  v.slip_print::public.slip_print_type,
  v.business_number,
  v.company_name,
  v.representative,
  v.business_category,
  v.business_item,
  v.postal_code,
  v.address,
  v.address_detail,
  v.tax_email,
  v.note,
  v.is_active
from (
  values
    -- 매출처 (sales)
    ('100001', 'sales', '한빛식당', '0212345678', 'korean', '김영길', '최민호', '주요 거래처', 'monthly_day', 10, 'limited', 3000000::bigint, 'monthly', 'with_amount', '7078138080', '한빛식당', '김한빛', '음식점업', '한식', '04524', '서울 중구 을지로 100', '1층', 'tax@hanbit.test', null, true),
    ('100002', 'sales', '청담스시', '0234567890', 'japanese', '박지훈', '정대현', '주요 거래처', 'month_end', null, 'limited', 5000000, 'monthly', 'with_amount', '8371724168', '(주)청담스시', '오수현', '음식점업', '일식', '06015', '서울 강남구 도산대로 450', '2층', 'account@cheongdam-sushi.test', '활어 납품은 오전 9시 전', true),
    ('100003', 'sales', '황금반점', '0315551234', 'chinese', '김영길', '최민호', '일반 거래처', 'per_order', null, 'none', null, 'per_order', 'with_amount', '7091775682', '황금반점', '왕지강', '음식점업', '중식', '13487', '경기 성남시 분당구 판교역로 10', '지하 1층', null, '현금 결제만 가능', true),
    ('100004', 'sales', '라벨라 파스타', '0212223333', 'western', '이수진', '정대현', '일반 거래처', 'monthly_day', 25, 'unlimited', null, 'monthly', 'quantity_only', '7090909440', '라벨라', '박서연', '음식점업', '양식', '04050', '서울 마포구 양화로 45', '3층', 'labella@labella.test', null, true),
    ('100005', 'sales', '행복분식', '01055551234', 'snack', '이수진', '최민호', '일반 거래처', 'per_order', null, 'none', null, 'none', 'quantity_only', null, null, '김행복', null, null, null, null, null, null, '사업자등록번호 미제출', true),
    ('100006', 'sales', '모닝베이커리', '0327778888', 'cafe_bakery', '박지훈', '정대현', '일반 거래처', 'monthly_day', 5, 'limited', 1000000, 'monthly', 'with_amount', '5498188489', '모닝베이커리', '이아침', '제조업', '제과점', '21999', '인천 연수구 센트럴로 160', '1층 102호', null, null, true),
    ('100007', 'sales', '한잔술집', '01077778888', 'pub', '김영길', '한상우', '일반 거래처', 'month_end', null, 'limited', 2000000, 'monthly', 'with_amount', '1012501284', '한잔', '최한잔', '음식점업', '주점', '03187', '서울 종로구 종로 33', null, null, null, true),
    ('100008', 'sales', '푸른초등학교 급식실', '0312345670', 'catering', '박지훈', '최민호', '급식·위탁', 'monthly_day', 15, 'unlimited', null, 'monthly', 'with_amount', '5810962885', '푸른초등학교', '김푸름', '교육서비스업', '초등학교', '16514', '경기 수원시 영통구 광교로 100', null, 'school-meal@puleun-es.test', '검수 담당 영양사 확인 후 하차', true),
    ('100009', 'sales', '늘봄요양원', '0418889999', 'catering', '이수진', '정대현', '급식·위탁', 'monthly_day', 20, 'limited', 4000000, 'monthly', 'with_amount', '5811794403', '사회복지법인 늘봄', '정늘봄', '보건업', '노인요양시설', '31116', '충남 천안시 서북구 불당대로 200', null, 'nulbom@nulbom.test', null, true),
    ('100010', 'sales', '맛나치킨 강남점', '0255556666', 'franchise', '배민상회', '정대현', '프랜차이즈', 'month_end', null, 'limited', 1500000, 'monthly', 'with_amount', '4538178088', '맛나치킨 강남점', '유강남', '음식점업', '치킨', '06236', '서울 강남구 테헤란로 152', '1층', null, null, true),
    ('100011', 'sales', '맛나치킨 역삼점', '0255557777', 'franchise', '배민상회', '정대현', '프랜차이즈', 'month_end', null, 'limited', 1500000, 'monthly', 'with_amount', '5491756647', '맛나치킨 역삼점', '한역삼', '음식점업', '치킨', '06134', '서울 강남구 논현로 508', null, null, null, true),
    ('100012', 'sales', '한빛식당 2호점', '0212345679', 'korean', '김영길', '최민호', '주요 거래처', 'monthly_day', 10, 'limited', 2000000, 'monthly', 'with_amount', '7078138080', '한빛식당', '김한빛', '음식점업', '한식', '04536', '서울 중구 남대문로 120', 'B1', null, '본점과 같은 사업자로 세금계산서 발행', true),
    ('100013', 'sales', '바다횟집', '0517771234', 'japanese', '김영길', '한상우', '일반 거래처', 'per_order', null, 'limited', 500000, 'per_order', 'with_amount', '8690906880', '바다횟집', '배바다', '음식점업', '횟집', '48093', '부산 해운대구 해운대해변로 264', null, null, null, true),
    ('100014', 'sales', '소담한정식', '0624441234', 'korean', '이수진', '최민호', null, 'monthly_day', 28, 'unlimited', null, 'monthly', 'with_amount', '5170108808', '소담', '윤소담', '음식점업', '한정식', '61945', '광주 서구 상무중앙로 110', null, null, null, true),
    ('100015', 'sales', '오렌지카페', '15881234', 'cafe_bakery', '스마트스토어', '정대현', null, 'unspecified', null, 'unlimited', null, 'per_order', 'with_amount', null, null, null, null, null, null, null, null, null, null, true),
    ('100016', 'sales', '대박곱창', '05051234567', 'pub', '김영길', '한상우', '일반 거래처', 'month_end', null, 'none', null, 'none', 'quantity_only', '8698160968', '대박곱창', '강대박', '음식점업', '곱창', '42020', '대구 수성구 동대구로 200', null, null, '0505 안심번호로 연락', true),
    ('100017', 'sales', '청담스시 케이터링', '0234567891', 'japanese', '박지훈', '정대현', '주요 거래처', 'month_end', null, 'limited', 3000000, 'monthly', 'with_amount', '8371724168', '(주)청담스시', '오수현', '음식점업', '출장음식', '06015', '서울 강남구 도산대로 450', '지하 1층', 'account@cheongdam-sushi.test', null, true),
    ('100018', 'sales', '하늘중학교 급식실', '0425559999', 'catering', '박지훈', '최민호', '급식·위탁', 'monthly_day', 15, 'unlimited', null, 'monthly', 'with_amount', '7090127840', '하늘중학교', '이하늘', '교육서비스업', '중학교', '35208', '대전 서구 둔산로 100', null, 'meal@haneul-ms.test', null, true),
    ('100019', 'sales', '면사랑 칼국수', '0337771111', 'snack', '이수진', '김도경', null, 'per_order', null, 'none', null, 'per_order', 'quantity_only', '3572505447', '면사랑', '조면식', '음식점업', '칼국수', '24341', '강원 춘천시 중앙로 50', null, null, null, true),
    ('100020', 'sales', '더스테이크하우스', '15449876', 'western', '박지훈', '정대현', '주요 거래처', 'monthly_day', 10, 'limited', 8000000, 'monthly', 'with_amount', '1652532966', '(주)더스테이크', '문스테', '음식점업', '양식', '06164', '서울 강남구 영동대로 513', '5층', 'finance@thesteak.test', null, true),
    ('100021', 'sales', '김밥천지 시청점', '0277778888', 'snack', '이수진', '한상우', '거래 중단 예정', 'per_order', null, 'none', null, 'none', 'quantity_only', '4218191046', '김밥천지 시청점', '나김밥', '음식점업', '분식', '04519', '서울 중구 세종대로 110', null, null, '월말 폐업 예정', true),
    ('100022', 'sales', '동네치킨', '0313334444', 'franchise', '김영길', '최민호', '프랜차이즈', 'month_end', null, 'limited', 1000000, 'monthly', 'with_amount', '5490185928', '동네치킨', '장동네', '음식점업', '치킨', '10403', '경기 고양시 일산동구 중앙로 1200', null, null, '가맹 해지로 미사용', false),
    ('100023', 'sales', '옛맛식당', '0298765432', 'korean', '김영길', '한상우', null, 'unspecified', null, 'none', null, 'none', 'with_amount', '6131753280', '옛맛식당', '고옛맛', '음식점업', '한식', '02841', '서울 성북구 성북로 10', null, null, '2026년 8월 폐업', false),
    ('100024', 'sales', '미소라멘', '0516667777', 'japanese', '식봄', '정대현', null, 'monthly_day', 1, 'limited', 0, 'per_order', 'with_amount', '6130905764', '미소라멘', '최미소', '음식점업', '라멘', '47285', '부산 부산진구 서면로 68', null, null, '한도 0원: 미수금 정리 전까지 외상 중지', true),
    ('100025', 'sales', '정원카페', '0647778888', 'cafe_bakery', '쿠팡', '최민호', '일반 거래처', 'month_end', null, 'unlimited', null, 'monthly', 'with_amount', '2618184962', '정원카페', '송정원', '음식점업', '커피전문점', '63122', '제주특별자치도 제주시 노형로 400', null, null, null, true),
    ('100026', 'sales', '행복나무 어린이집', '0558889999', 'catering', '오세훈', '오세훈', '급식·위탁', 'monthly_day', 20, 'unlimited', null, 'monthly', 'quantity_only', '2613305286', '행복나무 어린이집', '한나무', '교육서비스업', '어린이집', '51430', '경남 창원시 성산구 중앙대로 150', null, 'tree@happytree.test', '위탁 급식 업체 변경으로 미사용', false),
    -- 매입처 (purchase)
    ('200001', 'purchase', '바다마을', '0517654321', 'food_distribution', null, null, null, 'monthly_day', 10, 'unlimited', null, 'monthly', 'with_amount', '7653368482', '(주)바다마을', '어부장', '도매업', '수산물', '49111', '부산 영도구 해양로 300', null, 'tax@badamaeul.test', '냉동수산물 공급', true),
    ('200002', 'purchase', '한빛식품', '0319876543', 'food_distribution', '김영길', null, null, 'month_end', null, 'unlimited', null, 'monthly', 'with_amount', '5812536484', '한빛식품(주)', '이한빛', '제조업', '가공식품', '17111', '경기 용인시 처인구 백옥대로 100', null, 'bill@hanbitfood.test', '만두·면류 제조사', true),
    ('200003', 'purchase', '장맛식품', '0438765432', 'food_distribution', null, null, null, 'monthly_day', 25, 'unlimited', null, 'monthly', 'with_amount', '8698166564', '장맛식품(주)', '장맛나', '제조업', '장류', '28116', '충북 청주시 흥덕구 오송생명로 50', null, 'jangmat@jangmat.test', null, true),
    ('200004', 'purchase', '데어리팜', '0634445555', 'food_distribution', null, null, '일반 거래처', 'monthly_day', 10, 'unlimited', null, 'monthly', 'with_amount', '2610943209', '데어리팜(주)', '유우유', '제조업', '유가공품', '54896', '전북특별자치도 전주시 덕진구 기린대로 1000', null, null, null, true),
    ('200005', 'purchase', '푸른들 영농조합', '0617778888', 'food_distribution', null, null, '주요 거래처', 'per_order', null, 'unlimited', null, 'per_order', 'with_amount', '3253361447', '푸른들영농조합법인', '김농부', '농업', '채소', '58217', '전남 나주시 빛가람로 700', null, null, '산지 직거래 (양파, 마늘)', true),
    ('200006', 'purchase', '한우마을 축산', '0547776666', 'food_distribution', null, null, null, 'monthly_day', 5, 'unlimited', null, 'monthly', 'with_amount', '2611766401', '한우마을축산', '소한우', '도매업', '축산물', '37600', '경북 포항시 북구 중앙로 300', null, null, null, true),
    ('200007', 'purchase', '한마음청과', '0234449999', 'food_distribution', null, null, null, 'per_order', null, 'unlimited', null, 'per_order', 'with_amount', '3578129445', '한마음청과', '박청과', '도매업', '청과물', '05661', '서울 송파구 양재대로 932', null, null, '청과 경매 대행', true),
    ('200008', 'purchase', '대한포장상회', '0225550000', 'other', null, null, null, 'month_end', null, 'unlimited', null, 'monthly', 'with_amount', '7413324168', '대한포장상회', '포장왕', '도소매업', '포장재', '07299', '서울 영등포구 영등포로 100', null, null, '거래 종료', false),
    ('200009', 'purchase', '글로벌수입식품', '07012345678', 'food_distribution', null, null, null, 'unspecified', null, 'unlimited', null, 'none', 'with_amount', '2290183685', '글로벌수입식품(주)', '최수입', '도매업', '수입식품', null, null, null, null, '해외 직수입 (치즈, 땅콩버터)', true),
    -- 매출·매입 (both)
    ('300001', 'both', '대성유통', '0312223333', 'food_distribution', '김영길', '최민호', '주요 거래처', 'month_end', null, 'limited', 10000000, 'monthly', 'with_amount', '4850921441', '대성유통(주)', '김대성', '도소매업', '식자재', '14055', '경기 안양시 동안구 시민대로 230', 'A동 101호', 'ds@daesung.test', '상호 매입·매출 (월말 상계)', true),
    ('300002', 'both', '이웃마트', '0328889999', 'food_distribution', '이수진', '정대현', '일반 거래처', 'monthly_day', 15, 'limited', 2500000, 'monthly', 'with_amount', '1332517202', '이웃마트', '이이웃', '소매업', '슈퍼마켓', '22004', '인천 연수구 송도과학로 32', null, null, null, true),
    ('300003', 'both', '다온푸드', '0418887777', 'food_distribution', '박지훈', null, null, 'month_end', null, 'unlimited', null, 'monthly', 'with_amount', '7738114241', '다온푸드', '한다온', '도소매업', '반찬', '31169', '충남 천안시 동남구 만남로 50', null, null, null, true),
    ('300004', 'both', '새벽시장 식자재', '0536667777', 'food_distribution', '김영길', '한상우', null, 'per_order', null, 'none', null, 'per_order', 'quantity_only', '8370961440', '새벽식자재', '정새벽', '도소매업', '식자재', '41585', '대구 북구 매천로 100', null, null, null, true),
    ('300005', 'both', '그린케이터링', '0221234567', 'catering', '박지훈', '최민호', '급식·위탁', 'monthly_day', 10, 'limited', 6000000, 'monthly', 'with_amount', '8372595687', '(주)그린케이터링', '녹그린', '서비스업', '단체급식', '04100', '서울 마포구 마포대로 100', '지하 1층', 'nutrition@green-catering.test', null, true)
) as v (
  code, partner_type, name, phone, industry, sales_rep_name, delivery_rep_name,
  category_name, payment_term, payment_day, credit_limit_type, credit_limit,
  invoice_type, slip_print, business_number, company_name, representative,
  business_category, business_item, postal_code, address, address_detail,
  tax_email, note, is_active
)
left join public.employees as sales_rep
  on sales_rep.name = v.sales_rep_name
left join public.employees as delivery_rep
  on delivery_rep.name = v.delivery_rep_name
left join public.partner_categories as category
  on category.name = v.category_name
-- A misspelled name drops the row (the check below then fails) instead of
-- quietly leaving the 담당 or 분류 empty.
where (v.sales_rep_name is null or sales_rep.id is not null)
  and (v.delivery_rep_name is null or delivery_rep.id is not null)
  and (v.category_name is null or category.id is not null);

-- -----------------------------------------------------------------------------
-- 담당자 (partner_contacts): at most one 대표 담당자 (is_primary) per
-- partner; 100006 has a contact but no 대표 담당자.
-- -----------------------------------------------------------------------------

insert into public.partner_contacts (
  partner_id, name, job_title, mobile, phone, email, memo, is_primary, sort_order
)
select partner.id, v.name, v.job_title, v.mobile, v.phone, v.email, v.memo, v.is_primary, v.sort_order
from (
  values
    ('100001', '김한빛', '대표', '01011112222', null, 'hanbit@hanbit.test', null, true, 0),
    ('100001', '이주방', '주방장', '01011113333', null, null, '발주 담당', false, 1),
    ('100002', '오수현', '대표이사', '01022223333', '0234567890', null, null, true, 0),
    ('100002', '정회계', '경리팀', '01022224444', null, 'account@cheongdam-sushi.test', '세금계산서 문의', false, 1),
    ('100002', '김셰프', '총괄 셰프', '01022225555', null, null, null, false, 2),
    ('100003', '왕지강', '사장', '01033334444', null, null, null, true, 0),
    ('100004', '박서연', '대표', '01044445555', null, 'labella@labella.test', null, true, 0),
    ('100004', '최주방', '주방 매니저', '01044446666', null, null, '오후에 발주', false, 1),
    ('100006', '이아침', '대표', '01066667777', null, null, null, false, 0),
    ('100008', '김영양', '영양사', '01088881111', '0312345671', 'dietitian@puleun-es.test', '검수 담당', true, 0),
    ('100008', '박행정', '행정실 주무관', null, '0312345672', null, '대금 지급', false, 1),
    ('100009', '정늘봄', '원장', null, '0418889999', null, null, true, 0),
    ('100010', '유강남', '점주', '01010101010', null, null, null, true, 0),
    ('100011', '한역삼', '점주', '01011111010', null, null, null, true, 0),
    ('100012', '김한빛', '대표', '01011112222', null, null, '본점과 같은 대표', true, 0),
    ('100017', '김케이', '케이터링 팀장', '01017171717', null, 'catering@cheongdam-sushi.test', null, true, 0),
    ('100018', '이영양', '영양교사', '01018181818', '0425559998', null, null, true, 0),
    ('100020', '문스테', '대표', '01020202020', null, 'finance@thesteak.test', null, true, 0),
    ('100020', '나구매', '구매팀 팀장', '01020202121', null, null, null, false, 1),
    ('100024', '최미소', '사장', '01024242424', null, null, '미수금 정리 중', true, 0),
    ('100025', '송정원', '대표', '01025252525', null, null, null, true, 0),
    ('200001', '어부장', '영업부장', '01027272727', '0517654321', 'sales@badamaeul.test', null, true, 0),
    ('200002', '이한빛', '대표', '01028282828', null, null, null, false, 0),
    ('200002', '박영업', '영업과장', '01028282929', null, 'sales@hanbitfood.test', '주문은 문자로', true, 1),
    ('200003', '장맛나', '대표', null, '0438765432', null, null, true, 0),
    ('200005', '김농부', '조합장', '01031313131', null, null, '수확철에는 직접 통화', true, 0),
    ('200009', '최수입', '대표', '01035353535', '07012345678', 'import@global-food.test', null, true, 0),
    ('300001', '김대성', '대표', '01036363636', null, null, null, true, 0),
    ('300001', '윤구매', '구매과장', '01036363737', null, 'buy@daesung.test', null, false, 1),
    ('300002', '이이웃', '점장', '01037373737', null, null, null, true, 0),
    ('300005', '녹그린', '영양팀장', '01040404040', '0221234568', 'nutrition@green-catering.test', null, true, 0)
) as v (partner_code, name, job_title, mobile, phone, email, memo, is_primary, sort_order)
join public.partners as partner
  on partner.code = v.partner_code;

-- -----------------------------------------------------------------------------
-- 배송지 (partner_addresses): exactly one 기본 배송지 (is_default) for every
-- partner that has addresses (checked when the transaction ends). 100020's
-- 기본 배송지 is its second one; 100005's has no 우편번호 (typed by hand).
-- -----------------------------------------------------------------------------

insert into public.partner_addresses (
  partner_id, label, postal_code, address, address_detail, recipient, phone,
  memo, is_default, sort_order
)
select partner.id, v.label, v.postal_code, v.address, v.address_detail, v.recipient, v.phone, v.memo, v.is_default, v.sort_order
from (
  values
    ('100001', '본점', '04524', '서울 중구 을지로 100', '1층 주방', '이주방', '01011113333', '오전 9시 전 납품', true, 0),
    ('100002', '본점', '06015', '서울 강남구 도산대로 450', '2층 주방 뒷문', '김셰프', '01022225555', '활어는 수조 옆', true, 0),
    ('100002', '중앙 키친', '06016', '서울 강남구 압구정로 300', '지하 1층', '김셰프', '01022225555', null, false, 1),
    ('100003', '매장', '13487', '경기 성남시 분당구 판교역로 10', '지하 1층', '왕지강', '01033334444', null, true, 0),
    ('100004', '매장', '04050', '서울 마포구 양화로 45', '3층', '최주방', '01044446666', '엘리베이터 이용', true, 0),
    ('100005', '매장', null, '서울 동작구 상도로 200', '1층', '김행복', '01055551234', null, true, 0),
    ('100006', '매장', '21999', '인천 연수구 센트럴로 160', '1층 102호', null, null, '새벽 6시 납품', true, 0),
    ('100006', '제2공장', '21998', '인천 연수구 송도과학로 80', '2동', null, null, null, false, 1),
    ('100007', '매장', '03187', '서울 종로구 종로 33', null, null, '01077778888', '오후 3시 이후', true, 0),
    ('100008', '급식실', '16514', '경기 수원시 영통구 광교로 100', '본관 뒤 급식실', '김영양', '01088881111', '검수 후 하차', true, 0),
    ('100009', '주방', '31116', '충남 천안시 서북구 불당대로 200', null, null, '0418889999', null, true, 0),
    ('100010', '매장', '06236', '서울 강남구 테헤란로 152', '1층', null, '01010101010', null, true, 0),
    ('100011', '매장', '06134', '서울 강남구 논현로 508', null, null, '01011111010', null, true, 0),
    ('100012', '2호점', '04536', '서울 중구 남대문로 120', 'B1', null, null, null, true, 0),
    ('100013', '매장', '48093', '부산 해운대구 해운대해변로 264', null, null, null, null, true, 0),
    ('100014', '매장', '61945', '광주 서구 상무중앙로 110', null, null, null, null, true, 0),
    ('100016', '매장', '42020', '대구 수성구 동대구로 200', null, null, '05051234567', null, true, 0),
    ('100017', '케이터링 주방', '06015', '서울 강남구 도산대로 450', '지하 1층', '김케이', '01017171717', null, true, 0),
    ('100017', '행사장', '06164', '서울 강남구 영동대로 513', '하역장 3번', null, null, '행사일에만', false, 1),
    ('100018', '급식실', '35208', '대전 서구 둔산로 100', null, '이영양', '01018181818', null, true, 0),
    ('100019', '매장', '24341', '강원 춘천시 중앙로 50', null, null, null, null, true, 0),
    ('100020', '본점', '06164', '서울 강남구 영동대로 513', '5층', null, null, null, false, 0),
    ('100020', '센트럴 키친', '13529', '경기 성남시 분당구 판교로 200', 'B2', null, '01020202121', '새벽 5~7시', true, 1),
    ('100021', '매장', '04519', '서울 중구 세종대로 110', null, null, null, null, true, 0),
    ('100022', '매장', '10403', '경기 고양시 일산동구 중앙로 1200', null, null, null, null, true, 0),
    ('100024', '매장', '47285', '부산 부산진구 서면로 68', null, null, null, null, true, 0),
    ('100025', '매장', '63122', '제주특별자치도 제주시 노형로 400', null, null, null, '항공 화물 경유', true, 0),
    ('100026', '어린이집', '51430', '경남 창원시 성산구 중앙대로 150', null, '한나무', null, null, true, 0),
    ('200005', '반품 수거지', '58217', '전남 나주시 빛가람로 700', '창고 2동', null, null, null, true, 0),
    ('300001', '본사 창고', '14055', '경기 안양시 동안구 시민대로 230', 'A동 101호', null, null, null, true, 0),
    ('300001', '물류센터', '17405', '경기 이천시 마장면 서이천로 100', null, null, '0312223334', '지게차 하차', false, 1),
    ('300002', '매장', '22004', '인천 연수구 송도과학로 32', null, null, null, null, true, 0),
    ('300004', '창고', '41585', '대구 북구 매천로 100', null, null, null, null, true, 0),
    ('300005', '본사 주방', '04100', '서울 마포구 마포대로 100', '지하 1층', '녹그린', '01040404040', null, true, 0),
    ('300005', '위탁 급식장 A', '16677', '경기 수원시 권선구 권선로 500', '구내식당', null, null, null, false, 1),
    ('300005', '위탁 급식장 B', '18471', '경기 화성시 동탄대로 100', null, null, null, null, false, 2)
) as v (partner_code, label, postal_code, address, address_detail, recipient, phone, memo, is_default, sort_order)
join public.partners as partner
  on partner.code = v.partner_code;

-- Changed AFTER being used: partners keep them (see the notes above).
update public.employees
set is_active = false, resignation_date = '2026-09-30'
where name = '한상우';
update public.employees
set is_active = false, resignation_date = '2026-08-31'
where name = '식봄';
update public.employees
set is_delivery_driver = false, driver_operation_type = null,
  vehicle_number = null, vehicle_type = null
where name = '김도경';
update public.partner_categories set is_active = false where name = '거래 중단 예정';

-- Stop the reset when a sample row did not find its employee, category or
-- partner.
do $$
begin
  if (select count(*) from public.employees) <> 14
    or (select count(*) from public.employees where not is_active) <> 2
    or (select count(*) from public.employees where is_sales_rep) <> 8
    or (select count(*) from public.employees where is_delivery_driver) <> 5 then
    raise exception 'seed.sql: expected 14 sample employees (2 퇴사, 8 영업담당, 5 배송담당).';
  end if;
  if (select count(*) from public.partner_categories) <> 11
    or (select count(*) from public.partner_categories where parent_id is null) <> 3
    or (select count(*) from public.partner_categories where not is_active) <> 2 then
    raise exception 'seed.sql: expected 11 sample 거래처분류 (3 대분류, 2 사용 중지), got %.',
      (select count(*) from public.partner_categories);
  end if;
  if (select count(*) from public.partners) <> 40 then
    raise exception 'seed.sql: expected 40 sample partners, got %. Check the employee and category names in the partner list above.',
      (select count(*) from public.partners);
  end if;
  if (select count(*) from public.partners where partner_type = 'sales') <> 26
    or (select count(*) from public.partners where partner_type = 'purchase') <> 9
    or (select count(*) from public.partners where partner_type = 'both') <> 5 then
    raise exception 'seed.sql: expected 26 매출처, 9 매입처 and 5 매출·매입.';
  end if;
  if (select count(*) from public.partners where category_id is null) <> 14 then
    raise exception 'seed.sql: expected 14 미분류 partners, got %.',
      (select count(*) from public.partners where category_id is null);
  end if;
  if (select count(*) from public.partners where not is_active) <> 4 then
    raise exception 'seed.sql: expected 4 미사용 partners, got %.',
      (select count(*) from public.partners where not is_active);
  end if;
  if (
    select count(*) from (
      select business_number
      from public.partners
      where business_number is not null
      group by business_number
      having count(*) > 1
    ) as shared
  ) <> 2 then
    raise exception 'seed.sql: expected 2 사업자등록번호 shared by two partners each.';
  end if;
  if (select count(*) from public.partner_contacts) <> 31 then
    raise exception 'seed.sql: expected 31 담당자, got %. Check the partner codes in the contact list above.',
      (select count(*) from public.partner_contacts);
  end if;
  if (select count(*) from public.partner_addresses) <> 36 then
    raise exception 'seed.sql: expected 36 배송지, got %. Check the partner codes in the address list above.',
      (select count(*) from public.partner_addresses);
  end if;
end;
$$;
