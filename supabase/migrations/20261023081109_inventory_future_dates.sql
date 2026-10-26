-- =============================================================================
-- 재고관리: 오늘 이후 날짜의 전표 (예정 전표, 새벽배송)
--
-- Runs after 20261023015348_inventory.sql (migration 8, pushed: never edit
-- it). Only changes the 재고 functions and adds one settings column and one
-- read-only view (stock_history_lines); no table or stored row of stock
-- changes.
--
-- The owner's request (2026-10-23): the company does 새벽배송 (dawn
-- delivery). An order received on the 23rd is entered on the 23rd dated
-- the 24th, delivered on the 24th, and its stock leaves on the 24th. Until
-- now every 재고 전표 had to be dated today or earlier. Now:
-- - Every 전표 (기초재고, 입고, 출고, 폐기, 이동, 실사조정, 취소) may be dated
--   up to today + N days, N = app_settings.future_doc_days (default 7,
--   0 to 30, changed on 창고·로케이션 설정 → 재고 설정). Back-dating stays
--   allowed. Every save function reads the setting itself, so the database
--   enforces the same limit as the screens (hint stock_doc_date_future).
-- - Dates mean what they say, everywhere:
--   * 기한: a 출고 dated D never takes a lot whose 기한일 is before D (a lot
--     whose 기한 ends ON D may go out that day).
--   * Stock per date: a 전표 dated D may only take stock that is there at
--     the end of D (after every line dated D or earlier) AND must not make
--     the stock of any later day negative. That is the smallest running
--     balance of the (lot, location) from D on (stock_pair_at.available).
--     So stock received after D is never given to a 전표 dated D, and a
--     today-dated 출고 never takes stock that an already entered 출고 of
--     tomorrow needs: FEFO then takes other lots (or reports the shortage).
--     Applies to 출고 (FEFO plan, preview, allocate_fefo), 폐기, 이동 (the
--     source; the destination gets the stock from D), 실사조정 (the 전산
--     수량 is the stock at the end of the 실사 date, a decrease must leave
--     the later days enough) and 취소 (undoing a 입고 dated D must not take
--     away stock that later lines use). After saving, the history of every
--     (lot, location) the 전표 took stock from and that has later lines is
--     checked again (check_stock_document_history), whatever the date.
--   * stock_balances keeps meaning "after every entered 전표, including the
--     예정 (future-dated) ones": 재고처별 재고현황 shows that, so 예정 출고
--     are already deducted there.
--   * A 전표 undone on its own date (e.g. tomorrow's 출고 cancelled by the
--     customer: its 취소 is dated tomorrow too) never took stock away on
--     any day: its lines that took stock and their 취소 lines are left out
--     of every per-date number (view stock_history_lines), so the stock is
--     free again at once, also for today's 전표.
-- - The ledger stays append-only, stock never goes below 0 on any day, lots
--   are locked in one ordered statement before stock is taken
--   (lock_stock_lots), and the same request_id is saved once.
--
-- Messages a user may see are in Korean; hints are listed in
-- INVENTORY_DB_RULES (src/lib/inventory/constants.ts). The TS mirrors of
-- the date limit are docDateLimitMessage / docDateLimitHint /
-- maxDocDate (same file): change both together.
--
-- What this file does, in this order:
--  1. app_settings.future_doc_days (+ the column privilege).
--  2. Date helpers: stock_future_doc_days, stock_max_doc_date,
--     stock_doc_date_limit_message, check_stock_doc_date; read_stock_doc_date
--     uses the setting.
--  3. Stock per date: view stock_history_lines, stock_pair_at,
--     stock_available_from (faster, same meaning), check_stock_pair_history
--     and stock_integrity_check (both on stock_history_lines),
--     check_stock_document_history, stock_available_on.
--  4. FEFO plan (stock_issue_plan) per date.
--  5. Save functions: issue_stock, dispose_stock, transfer_stock,
--     apply_stock_count, reverse_stock_document, import_opening_stock;
--     stock_count_sheet; product_stock_ledger (잔량 without the lines of a
--     전표 undone on its own date); stock_dashboard (예정 전표 count).
--  6. Privileges, comments, PostgREST reload.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app_settings.future_doc_days
-- -----------------------------------------------------------------------------

alter table public.app_settings
  add column future_doc_days integer not null default 7;

alter table public.app_settings
  add constraint app_settings_future_doc_days_check
    check (future_doc_days is not null and future_doc_days between 0 and 30);

comment on column public.app_settings.future_doc_days is '전표 일자를 오늘 이후 며칠까지 정할 수 있는지 (0~30, 기본 7; 새벽배송: 내일 날짜 출고를 오늘 입력). 0이면 오늘까지';

grant update (future_doc_days) on table public.app_settings to authenticated;

comment on column public.stock_documents.doc_date is '전표 일자 (한국 날짜, 지난 날짜 가능, 오늘 이후는 재고 설정의 일수까지 = 예정 전표)';

-- -----------------------------------------------------------------------------
-- 2. Date helpers
-- -----------------------------------------------------------------------------

-- N of "오늘 이후 N일까지" (app_settings.future_doc_days; 0 when the row is
-- missing, i.e. today only).
create function public.stock_future_doc_days()
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select settings.future_doc_days from public.app_settings as settings where settings.id = 1),
    0
  )
$$;

comment on function public.stock_future_doc_days() is '전표 일자를 오늘 이후 며칠까지 정할 수 있는지 (재고 설정, 0~30).';

-- The latest date a new 전표 may have: today (Korea) + the setting.
create function public.stock_max_doc_date()
returns date
language sql
stable
set search_path = ''
as $$
  select public.stock_today() + public.stock_future_doc_days()
$$;

comment on function public.stock_max_doc_date() is '새 전표에 쓸 수 있는 가장 늦은 날짜 (오늘 + 재고 설정의 일수).';

-- The Korean message when a date is after stock_max_doc_date().
-- subject: the field with its particle ("전표 일자는", "입고일은").
-- Same text as docDateLimitMessage in src/lib/inventory/constants.ts.
create function public.stock_doc_date_limit_message(subject text default '전표 일자는')
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when public.stock_future_doc_days() = 0
      then format('%s 오늘(%s) 이후로 정할 수 없습니다.', subject, public.stock_today())
    else format('%s 오늘 이후 %s일(%s)까지 정할 수 있습니다.',
      subject, public.stock_future_doc_days(), public.stock_max_doc_date())
  end
$$;

comment on function public.stock_doc_date_limit_message(text) is '전표 일자 한도 메시지 (예: 전표 일자는 오늘 이후 7일(2026-10-30)까지 정할 수 있습니다.).';

-- Refuses a date after stock_max_doc_date() (hint stock_doc_date_future).
create function public.check_stock_doc_date(
  value date,
  subject text default '전표 일자는',
  line_no integer default null,
  field text default 'doc_date',
  extra jsonb default null
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if value is not null and value > public.stock_max_doc_date() then
    perform public.raise_stock_error(
      public.stock_doc_date_limit_message(subject), 'stock_doc_date_future',
      line_no, field, '22023', extra
    );
  end if;
end;
$$;

comment on function public.check_stock_doc_date(date, text, integer, text, jsonb) is '날짜가 오늘 + 재고 설정의 일수보다 늦으면 오류 (stock_doc_date_future).';

-- The 전표 date: today (Korea) when empty; at most today + the setting;
-- not before 2000-01-01. Back-dating is allowed (the history is checked).
create or replace function public.read_stock_doc_date(value jsonb)
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
  perform public.check_stock_doc_date(result);
  return result;
end;
$$;

comment on function public.read_stock_doc_date(jsonb) is '재고 함수: 전표 일자를 읽습니다 (비우면 오늘, 오늘 이후는 재고 설정의 일수까지).';

-- -----------------------------------------------------------------------------
-- 3. Stock per date
-- -----------------------------------------------------------------------------

-- The ledger lines that count for the stock of each day (the history):
-- every line except, for a 전표 undone ON ITS OWN DATE, its lines that took
-- stock away and the 취소 lines that put that stock back (same date, same
-- lot and location, opposite quantity). Such a 전표 never took anything
-- away on any day — typically tomorrow's 새벽배송 출고 cancelled by the
-- customer (its 취소 can only be dated tomorrow, too): without this, its
-- stock would stay held until tomorrow, even for today's 전표. Leaving out
-- such a pair (− then + of one quantity on one day) only raises the running
-- balances between the two lines, so every rule that held with them still
-- holds. Lines that brought stock in (입고, 이동 받는 쪽, 실사 증가) and
-- their 취소 lines always count. The end-of-day stock is the same either
-- way. Used by stock_pair_at, check_stock_pair_history, the FEFO plan,
-- stock_integrity_check and the 잔량 of product_stock_ledger.
create view public.stock_history_lines
with (security_invoker = true)
as
select
  movement.id,
  movement.seq,
  movement.document_id,
  movement.lot_id,
  movement.location_id,
  movement.product_id,
  movement.doc_date,
  movement.quantity_delta
from public.stock_movements as movement
where not (
  (movement.quantity_delta < 0 and exists (
    select 1
    from public.stock_movements as undo
    where undo.reverses_movement_id = movement.id
      and undo.doc_date = movement.doc_date
  ))
  or (movement.quantity_delta > 0 and movement.reverses_movement_id is not null and exists (
    select 1
    from public.stock_movements as undone
    where undone.id = movement.reverses_movement_id
      and undone.doc_date = movement.doc_date
  ))
);

comment on view public.stock_history_lines is '날짜별 재고 계산에 쓰는 원장 줄: 같은 날 취소된 전표의 (재고를 꺼낸) 줄과 그 취소 줄은 뺍니다 (그 전표는 어느 날에도 재고를 쓰지 않은 것으로 봄; 예: 취소한 내일 새벽배송 출고).';

revoke all on table public.stock_history_lines from anon, authenticated;
grant select on table public.stock_history_lines to authenticated, service_role;

-- One (lot, location) seen from a date, its lines (stock_history_lines)
-- ordered by (doc_date, seq) — a new line of that date comes after every
-- line dated on or before it:
-- - on_date: the stock at the end of that date (lines dated on or before);
-- - available: what a NEW line of that date may take without making the
--   stock negative on that day or any later day = the smallest running
--   balance from that date on (= on_date when nothing is dated later).
-- Exactly one row.
create function public.stock_pair_at(
  target_lot_id uuid,
  target_location_id uuid,
  at_date date
)
returns table (on_date numeric, available numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(history.delta) filter (where history.doc_date <= at_date), 0),
    least(
      coalesce(sum(history.delta) filter (where history.doc_date <= at_date), 0),
      coalesce(
        min(history.running) filter (where history.doc_date > at_date),
        coalesce(sum(history.delta) filter (where history.doc_date <= at_date), 0)
      )
    )
  from (
    select
      movement.doc_date,
      movement.quantity_delta as delta,
      sum(movement.quantity_delta) over (
        order by movement.doc_date, movement.seq
        rows between unbounded preceding and current row
      ) as running
    from public.stock_history_lines as movement
    where movement.lot_id = target_lot_id
      and movement.location_id = target_location_id
  ) as history
$$;

comment on function public.stock_pair_at(uuid, uuid, date) is '로트 × 위치를 그 날짜로 봤을 때: on_date = 그날 마감 수량, available = 그 날짜로 새로 꺼낼 수 있는 수량 (그 날짜 이후 재고 흐름의 가장 작은 잔량).';

-- Same meaning as before (stock_pair_at.available), with a quick answer
-- when nothing is dated after from_date: then it is the quantity now.
create or replace function public.stock_available_from(
  target_lot_id uuid,
  target_location_id uuid,
  from_date date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.stock_movements as later
      where later.lot_id = target_lot_id
        and later.location_id = target_location_id
        and later.doc_date > from_date
    ) then (
      select pair_state.available
      from public.stock_pair_at(target_lot_id, target_location_id, from_date) as pair_state
    )
    else coalesce((
      select balance.quantity
      from public.stock_balances as balance
      where balance.lot_id = target_lot_id
        and balance.location_id = target_location_id
    ), 0)
  end
$$;

comment on function public.stock_available_from(uuid, uuid, date) is '그 날짜로 새로 꺼낼 수 있는 수량: 그 날짜 이후의 재고 흐름에서 가장 작은 잔량 (그 뒤 날짜의 줄이 없으면 현재 수량).';

-- After a 전표 took stock away: the running balance of the (lot,
-- location), by date and then saving order, must never be below 0 — on
-- stock_history_lines (same as before, except that a 전표 undone on its own
-- date and its 취소 are left out: they never took stock on any day).
create or replace function public.check_stock_pair_history(
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
    from public.stock_history_lines as movement
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

comment on function public.check_stock_pair_history(uuid, uuid, integer, text) is '재고를 꺼낸 뒤, 그 로트 × 위치의 날짜별 잔량(같은 날 취소된 전표 제외)이 한 번도 0보다 작아지지 않는지 확인합니다.';

-- 재고 기록 점검 (same as migration 8, except negative_history: on
-- stock_history_lines, like every per-date rule). Problems found (empty =
-- fine):
-- - balance_mismatch: stock_balances ≠ the sum of the lines;
-- - negative_balance: a balance below 0;
-- - negative_history: a running balance below 0 at some moment (lines by
--   date, then saving order; a 전표 undone on its own date left out);
-- - movement_mismatch: a line whose product, 단가, date, 구분 or 취소 mark
--   does not match its lot / 전표, or that moves a lot before its 입고일;
-- - balance_product_mismatch, lot_not_base, document_without_lines,
--   lot_without_receipt_line, reversal_mismatch (see migration 8).
-- Run it in the SQL console (select * from public.stock_integrity_check();)
-- or from the tests; it changes nothing.
create or replace function public.stock_integrity_check()
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
    from public.stock_history_lines as movement
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

comment on function public.stock_integrity_check() is '재고 기록 점검: 현재 재고 = 전표 줄 합계, 음수 재고 없음(지난 날짜 포함, 같은 날 취소된 전표 제외), 줄·로트·전표·취소가 서로 맞는지. 문제가 없으면 빈 결과.';

-- After a 전표 took stock away: every (lot, location) it took from that has
-- lines dated after the 전표 must keep a running balance of 0 or more on
-- every day (check_stock_pair_history). Pairs without later lines need no
-- check: their last running balance is the current one, which the CHECK on
-- stock_balances keeps at 0 or more.
create function public.check_stock_document_history(
  target_document_id uuid,
  list text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  pair record;
begin
  for pair in
    select movement.lot_id, movement.location_id, min(movement.line_no) as line_no,
      min(movement.doc_date) as doc_date
    from public.stock_movements as movement
    where movement.document_id = target_document_id
      and movement.quantity_delta < 0
    group by movement.lot_id, movement.location_id
    order by min(movement.line_no), movement.lot_id, movement.location_id
  loop
    if exists (
      select 1
      from public.stock_movements as later
      where later.lot_id = pair.lot_id
        and later.location_id = pair.location_id
        and later.doc_date > pair.doc_date
    ) then
      perform public.check_stock_pair_history(pair.lot_id, pair.location_id, pair.line_no, list);
    end if;
  end loop;
end;
$$;

comment on function public.check_stock_document_history(uuid, text) is '전표가 꺼낸 로트 × 위치 중 뒤 날짜의 줄이 있는 곳의 날짜별 잔량이 0보다 작아지지 않는지 확인합니다.';

-- What can go out per 기준상품 on a date (출고 등록's "출고 가능" column):
-- Σ over its (lot, location) with stock of the quantity a new line of that
-- date may take (stock_pair_at.available), without lots whose 기한 is
-- before that date (counted in "expired") and lots received after it.
-- Returns [{"product_id", "available", "expired"}] for the products with
-- stock (others: 0). at_date empty = today.
create function public.stock_available_on(
  target_product_ids uuid[],
  at_date date default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with day as (
    select coalesce(at_date, public.stock_today()) as value
  ),
  candidates as (
    select
      balance.product_id,
      lot.expiry_kind <> 'none' and lot.expiry_date < day.value as is_expired,
      case
        when lot.received_date > day.value then 0
        when exists (
          select 1
          from public.stock_movements as later
          where later.lot_id = balance.lot_id
            and later.location_id = balance.location_id
            and later.doc_date > day.value
        ) then greatest((
          select pair_state.available
          from public.stock_pair_at(balance.lot_id, balance.location_id, day.value) as pair_state
        ), 0)
        else balance.quantity
      end as available
    from public.stock_balances as balance
    join public.stock_lots as lot on lot.id = balance.lot_id
    cross join day
    where balance.product_id = any (coalesce(target_product_ids, '{}'))
      and balance.quantity > 0
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'product_id', per_product.product_id,
      'available', per_product.available,
      'expired', per_product.expired
    ) order by per_product.product_id),
    '[]'::jsonb
  )
  from (
    select
      candidate.product_id,
      coalesce(sum(candidate.available) filter (where not candidate.is_expired), 0) as available,
      coalesce(sum(candidate.available) filter (where candidate.is_expired), 0) as expired
    from candidates as candidate
    group by candidate.product_id
  ) as per_product
$$;

comment on function public.stock_available_on(uuid[], date) is '기준상품별로 그 날짜에 출고할 수 있는 수량 (그 날짜의 재고 흐름 기준, 기한 경과·그 뒤 입고 제외). JSON 배열.';

-- -----------------------------------------------------------------------------
-- 4. FEFO plan per date
-- -----------------------------------------------------------------------------

-- The FEFO plan of 출고 lines (shared by the preview and issue_stock).
-- lines: [{"product_id", "quantity", "warehouse_id"?, "zone_id"?,
--          "location_id"?}, …] — a 묶음상품 is split into its 기준상품.
-- For each 기준상품, lots are taken in this order (FEFO):
--   1. lots WITH a 기한 before lots without one ("none" last);
--   2. the earliest 기한일; 3. the earliest 입고일; 4. the older lot;
--   5. within one lot: 창고코드, 구역코드, 위치코드.
-- Everything is seen from the 전표 date D (plan_date, default today, at
-- most today + the setting):
--   * never a lot whose 기한일 is before D (기한 경과; include_expired only
--     for previews) — a lot whose 기한 ends ON D may go;
--   * never a lot received after D;
--   * from each (lot, location) at most what a new line dated D may take
--     (stock_pair_at.available: the stock at the end of D, and never more
--     than later days still need) — so lines dated after D keep their
--     stock and FEFO takes other lots instead.
-- Several lines (or 묶음상품) with the same 기준상품 share its stock: lines
-- limited to a 위치, then to a 구역, then to a 창고 are planned first, then
-- the others, each group in line order (see the loop below).
-- only_lot_ids (issue_stock): only these lots (the ones it locked).
-- Returns {"doc_date", "ok" (no shortage), "lines" (in line order): [{"line",
--   "product_id", "product_code", "product_name", "product_type", "unit",
--   "quantity", "shortage" (bool), "demands": [{"product_id", "code",
--   "name", "unit", "storage_type", "quantity", "allocated", "shortage",
--   "available", "expired_excluded", "taken_by_other_lines" (stock at the
--   line's places that lines planned before it took), "reserved_later"
--   (stock there at the end of D that lines dated after D use),
--   "arriving_later" (stock that comes after D: lots received later and
--   later 이동/조정 in), "allocations": [{lot, location, "quantity",
--   "available", "days_left" (from today), …}]}]}]}.
create or replace function public.stock_issue_plan(
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
  reserved_total numeric;
  arriving_total numeric;
  -- The candidates of each 기준상품, read once per plan (many lines of one
  -- product share them): product id → JSON array of its (lot, location) in
  -- FEFO order with the date-aware quantities (see below).
  product_candidates jsonb := '{}'::jsonb;
  candidates jsonb;
  candidate record;
  candidate_key text;
  candidate_stock numeric;
  on_date_quantity numeric;
  candidate_base numeric;
  candidate_consumed numeric;
  candidate_available numeric;
  taken_total numeric;
  take numeric;
  line_short boolean;
begin
  perform public.check_stock_doc_date(effective_date);
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
      expired_total := 0;
      reserved_total := 0;
      arriving_total := 0;
      taken_total := 0;
      allocations := '{}';
      -- Every (lot, location) of the 기준상품 with stock now, plus the ones
      -- without stock now that have lines dated after D (their stock on D
      -- is reserved by those lines: counted in reserved_later, never
      -- taken), in FEFO order, read once per product and plan:
      --   stock   = the quantity now (after every entered 전표);
      --   on_date = the stock at the end of D;
      --   base    = what a new line dated D may take: the smallest running
      --             balance from D on (= stock when nothing is dated after
      --             D), computed in one pass over the lines of the pairs
      --             that have lines after D.
      candidates := product_candidates -> component.product_id::text;
      if candidates is null then
        select coalesce(jsonb_agg(jsonb_build_object(
            'lot_id', balance.lot_id,
            'lot_no', lot.lot_no,
            'expiry_kind', lot.expiry_kind,
            'expiry_date', lot.expiry_date,
            'received_date', lot.received_date,
            'unit_cost_incl_vat', lot.unit_cost_incl_vat,
            'location_id', balance.location_id,
            'location_code', location.code,
            'location_name', location.name,
            'zone_id', zone.id,
            'zone_code', zone.code,
            'zone_name', zone.name,
            'zone_storage_type', zone.storage_type,
            'warehouse_id', warehouse.id,
            'warehouse_code', warehouse.code,
            'warehouse_name', warehouse.name,
            'stock', balance.quantity,
            'on_date', coalesce(history.on_date, balance.quantity),
            'base', greatest(coalesce(history.available, balance.quantity), 0)
          )
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
        ), '[]'::jsonb)
        into candidates
        from (
          select stock.lot_id, stock.location_id, stock.quantity
          from public.stock_balances as stock
          where stock.product_id = component.product_id
            and stock.quantity > 0
          union all
          select stock.lot_id, stock.location_id, stock.quantity
          from public.stock_balances as stock
          where stock.quantity = 0
            and (stock.lot_id, stock.location_id) in (
              select later.lot_id, later.location_id
              from public.stock_movements as later
              where later.product_id = component.product_id
                and later.doc_date > effective_date
            )
        ) as balance
        join public.stock_lots as lot on lot.id = balance.lot_id
        join public.storage_locations as location on location.id = balance.location_id
        join public.warehouse_zones as zone on zone.id = location.zone_id
        join public.warehouses as warehouse on warehouse.id = zone.warehouse_id
        left join (
          -- Same numbers as stock_pair_at (on stock_history_lines), for
          -- every pair with later lines.
          select
            history_line.lot_id,
            history_line.location_id,
            coalesce(sum(history_line.delta) filter (where history_line.doc_date <= effective_date), 0)
              as on_date,
            least(
              coalesce(sum(history_line.delta) filter (where history_line.doc_date <= effective_date), 0),
              coalesce(
                min(history_line.running) filter (where history_line.doc_date > effective_date),
                coalesce(sum(history_line.delta) filter (where history_line.doc_date <= effective_date), 0)
              )
            ) as available
          from (
            select
              movement.lot_id,
              movement.location_id,
              movement.doc_date,
              movement.quantity_delta as delta,
              sum(movement.quantity_delta) over (
                partition by movement.lot_id, movement.location_id
                order by movement.doc_date, movement.seq
                rows between unbounded preceding and current row
              ) as running
            from public.stock_history_lines as movement
            where movement.product_id = component.product_id
              and (movement.lot_id, movement.location_id) in (
                select later.lot_id, later.location_id
                from public.stock_movements as later
                where later.product_id = component.product_id
                  and later.doc_date > effective_date
              )
          ) as history_line
          group by history_line.lot_id, history_line.location_id
        ) as history
          on history.lot_id = balance.lot_id and history.location_id = balance.location_id
        -- issue_stock plans only with the lots it locked (the ones with
        -- stock); a (lot, location) without stock now gives nothing on any
        -- date, it is only counted.
        where only_lot_ids is null or lot.id = any (only_lot_ids) or balance.quantity = 0;
        product_candidates := product_candidates
          || jsonb_build_object(component.product_id::text, candidates);
      end if;

      -- The ones in the line's places; those that cannot go on D are
      -- counted (expired, arriving later) and skipped.
      for candidate in
        select item.value
        from jsonb_array_elements(candidates) with ordinality as item (value, ordinality)
        order by item.ordinality
      loop
        if (filter_warehouse is not null and (candidate.value ->> 'warehouse_id')::uuid <> filter_warehouse)
          or (filter_zone is not null and (candidate.value ->> 'zone_id')::uuid <> filter_zone)
          or (filter_location is not null and (candidate.value ->> 'location_id')::uuid <> filter_location) then
          continue;
        end if;
        candidate_stock := (candidate.value ->> 'stock')::numeric;
        -- Received after the 전표 date: not there yet that day.
        if (candidate.value ->> 'received_date')::date > effective_date then
          arriving_total := arriving_total + candidate_stock;
          continue;
        end if;
        on_date_quantity := (candidate.value ->> 'on_date')::numeric;
        candidate_base := (candidate.value ->> 'base')::numeric;

        -- 기한 경과 on D (a 기한 ending ON D may still go out that day).
        if not include_expired
          and candidate.value ->> 'expiry_kind' <> 'none'
          and (candidate.value ->> 'expiry_date')::date < effective_date then
          expired_total := expired_total + candidate_base;
          continue;
        end if;
        -- Stock there on D that lines dated after D use, and stock that
        -- comes only after D.
        reserved_total := reserved_total + greatest(on_date_quantity - candidate_base, 0);
        arriving_total := arriving_total + greatest(candidate_stock - candidate_base, 0);

        candidate_key := (candidate.value ->> 'lot_id') || ':' || (candidate.value ->> 'location_id');
        candidate_consumed := coalesce((consumed ->> candidate_key)::numeric, 0);
        -- Stock here that other lines of this 전표 were given first.
        taken_total := taken_total + least(candidate_consumed, candidate_base);
        candidate_available := candidate_base - candidate_consumed;
        if candidate_available <= 0 then
          continue;
        end if;
        available_total := available_total + candidate_available;
        if remaining > 0 then
          take := least(candidate_available, remaining);
          -- The lot and place as the candidate has them, plus the D-day
          -- (from today), what it could give and what the plan takes.
          allocations := array_append(allocations,
            (candidate.value - 'stock' - 'on_date' - 'base')
            || jsonb_build_object(
              'days_left', (candidate.value ->> 'expiry_date')::date - today,
              'available', candidate_available,
              'quantity', take
            ));
          consumed := jsonb_set(
            consumed,
            array[candidate_key],
            to_jsonb(candidate_consumed + take)
          );
          remaining := remaining - take;
        end if;
      end loop;

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
        'reserved_later', reserved_total,
        'arriving_later', arriving_total,
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

comment on function public.stock_issue_plan(jsonb, date, boolean, uuid[]) is '출고 줄들의 FEFO 배정 계획 (전표 일자 기준: 그날 기한 경과·그 뒤 입고 제외, 뒤 날짜 전표가 쓰는 재고 제외; 기한 빠른 순 → 입고일 → 오래된 로트, 기한 없음은 마지막; 위치·구역·창고를 정한 줄부터 배정). plan_stock_issue와 issue_stock이 함께 씁니다.';

comment on function public.plan_stock_issue(jsonb, date, boolean) is '출고 배정 미리보기: 그 출고일에 FEFO로 어느 로트·위치에서 얼마나 나갈지 (저장하지 않음). 부족하면 ok=false.';

comment on function public.allocate_fefo(uuid, numeric, uuid, uuid, uuid, date, boolean) is '상품 하나의 FEFO 배정 미리보기 (그 날짜 기준, 기한 빠른 로트부터, 기한 경과 제외). 앞으로 주문 출고도 이 규칙을 씁니다.';

-- -----------------------------------------------------------------------------
-- 5. Save functions
-- -----------------------------------------------------------------------------

-- The "(… 제외)" part of a 재고 부족 message: what the quantity that can
-- go out leaves out (same words as shortageText in
-- src/app/(app)/inventory/issues/_components/issue-plan-table.tsx).
create function public.stock_shortage_notes(demand jsonb, plan_date date)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  notes text[];
  -- "내일 이후" for today's 전표, else "10-25 이후" (the day after it).
  after_text text := case
    when plan_date = public.stock_today() then '내일 이후'
    else to_char(plan_date + 1, 'MM-DD') || ' 이후'
  end;
begin
  notes := array_remove(array[
    case
      when coalesce((demand ->> 'taken_by_other_lines')::numeric, 0) > 0 then
        format('같은 전표의 다른 줄에 먼저 배정한 %s %s',
          public.stock_quantity_text((demand ->> 'taken_by_other_lines')::numeric), demand ->> 'unit')
    end,
    case
      when coalesce((demand ->> 'expired_excluded')::numeric, 0) > 0 then
        format('기한이 지난 재고 %s %s',
          public.stock_quantity_text((demand ->> 'expired_excluded')::numeric), demand ->> 'unit')
    end,
    case
      when coalesce((demand ->> 'reserved_later')::numeric, 0) > 0 then
        format('%s 전표가 쓰는 재고 %s %s', after_text,
          public.stock_quantity_text((demand ->> 'reserved_later')::numeric), demand ->> 'unit')
    end,
    case
      when coalesce((demand ->> 'arriving_later')::numeric, 0) > 0 then
        format('%s 들어오는 재고 %s %s', after_text,
          public.stock_quantity_text((demand ->> 'arriving_later')::numeric), demand ->> 'unit')
    end
  ], null);
  if cardinality(notes) = 0 then
    return '';
  end if;
  return ' (' || array_to_string(notes, ', ') || ' 제외)';
end;
$$;

comment on function public.stock_shortage_notes(jsonb, date) is '재고 부족 메시지의 (… 제외) 부분: 다른 줄에 먼저 배정, 기한 경과, 뒤 날짜 전표가 쓰는 재고, 뒤에 들어오는 재고.';

-- 출고 등록 (manual 출고 now; later the 주문 module calls it too).
-- header: {"doc_date" (empty = today; up to today + the setting),
--          "partner_id" (any 사용 거래처, optional), "memo", "request_id"}
-- lines: [{"product_id" (기준상품 or 묶음상품), "quantity", "warehouse_id"?,
--          "zone_id"?, "location_id"? (only stock there), "memo"}, …]
-- The lots are chosen by FEFO on the 전표 date (stock_issue_plan): the
-- same plan plan_stock_issue shows, computed again here after locking the
-- lots. Not enough stock → error stock_insufficient naming the product and
-- the quantity that can go out on that date (nothing saved).
-- Returns {"document_id", "doc_no", "doc_date", "doc_type", "plan",
--          "warnings": []}.
create or replace function public.issue_stock(header jsonb, lines jsonb)
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
  line_memos text[] := '{}';
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
  -- then plan with the quantities after the lock. (A lot without stock now
  -- has nothing to give on any date: its last running balance is 0.)
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
        perform public.raise_stock_error(
          format('‘%s’ 재고가 부족합니다. 필요 %s %s, %s 출고할 수 있는 수량 %s %s%s.',
            short_demand ->> 'name',
            public.stock_quantity_text((short_demand ->> 'quantity')::numeric), short_demand ->> 'unit',
            case
              when issue_date = public.stock_today() then '오늘'
              else to_char(issue_date, 'MM-DD') || '에'
            end,
            public.stock_quantity_text((short_demand ->> 'available')::numeric), short_demand ->> 'unit',
            public.stock_shortage_notes(short_demand, issue_date)),
          'stock_insufficient', (plan_line ->> 'line')::integer, 'quantity', '23514',
          jsonb_build_object(
            'product_id', short_demand ->> 'product_id',
            'requested', (short_demand ->> 'quantity')::numeric,
            'available', (short_demand ->> 'available')::numeric,
            'expired_excluded', (short_demand ->> 'expired_excluded')::numeric,
            'taken_by_other_lines', (short_demand ->> 'taken_by_other_lines')::numeric,
            'reserved_later', (short_demand ->> 'reserved_later')::numeric,
            'arriving_later', (short_demand ->> 'arriving_later')::numeric
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

  -- No day after the 출고 may go below 0 (the plan already kept later
  -- lines' stock; this is the last guard).
  perform public.check_stock_document_history(document.id);

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

comment on function public.issue_stock(jsonb, jsonb) is '출고 등록: 전표 일자 기준 FEFO(기한 빠른 로트부터, 그날 기한 경과·그 뒤 입고 제외, 뒤 날짜 전표가 쓰는 재고 제외)로 로트·위치를 골라 꺼냅니다. 재고가 부족하면 상품과 출고 가능 수량을 알리고 아무것도 저장하지 않습니다.';

-- 폐기 / 이동: the message when a line wants more than the (lot, location)
-- may give on the 전표 date.
create function public.stock_take_too_much_message(
  what text,
  lot_label text,
  location_label text,
  take_date date,
  available numeric,
  unit text,
  current_quantity numeric
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when greatest(available, 0) >= current_quantity
      then format('%s 수량이 남은 재고보다 많습니다: %s, %s (남은 수량 %s %s).',
        what, lot_label, location_label, public.stock_quantity_text(greatest(available, 0)), unit)
    else format('%s 수량이 %s에 쓸 수 있는 재고보다 많습니다: %s, %s (그 날짜에 쓸 수 있는 수량 %s %s, 지금 재고 %s %s). 그 날짜 뒤의 입고·출고·이동 전표(예정 전표 포함)를 확인해 주세요.',
      what, take_date, lot_label, location_label,
      public.stock_quantity_text(greatest(available, 0)), unit,
      public.stock_quantity_text(current_quantity), unit)
  end
$$;

comment on function public.stock_take_too_much_message(text, text, text, date, numeric, text, numeric) is '폐기·이동 수량이 그 날짜에 쓸 수 있는 재고보다 많을 때의 메시지.';

-- 폐기 등록.
-- header: {"doc_date" (up to today + the setting), "memo", "request_id"}
-- lines: [{"lot_id", "location_id", "quantity", "reason" ('expired' |
--          'damaged' | 'quality' | 'other'), "memo" (required for
--          'other')}, …]
-- Each line may take at most what the (lot, location) can give on the 전표
-- date without leaving a later line without stock (stock_available_from).
create or replace function public.dispose_stock(header jsonb, lines jsonb)
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

    -- What the (lot, location) can give on the 전표 date (earlier lines of
    -- this 전표 are saved already, so they are counted).
    available := public.stock_available_from(line_lot_id, line_location_id, disposal_date);
    if line_quantity > available then
      perform public.raise_stock_error(
        public.stock_take_too_much_message(
          '폐기할', lot_row.name || ' 로트 ' || lot_row.lot_no,
          coalesce((select info.label from public.stock_location_info(line_location_id) as info), '-'),
          disposal_date, available, lot_row.unit,
          coalesce((
            select balance.quantity from public.stock_balances as balance
            where balance.lot_id = line_lot_id and balance.location_id = line_location_id
          ), 0)
        ),
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

  perform public.check_stock_document_history(document.id);

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'warnings', '[]'::jsonb
  );
end;
$$;

comment on function public.dispose_stock(jsonb, jsonb) is '폐기 등록: 고른 로트 × 위치에서 수량을 빼고 사유(기한 경과/파손/품질 불량/기타+메모)를 남깁니다. 전표 일자에 쓸 수 있는 재고보다 많이 뺄 수 없습니다 (뒤 날짜 전표가 쓰는 재고 제외).';

-- 재고처간 이동 등록.
-- header: {"doc_date" (up to today + the setting), "memo", "request_id"}
-- lines: [{"lot_id", "from_location_id", "to_location_id", "quantity",
--          "memo"}, …] — the 위치 it goes to must be 사용 (with its 구역 and
--          창고). Each line is two ledger lines (− from, + to): the source
--          gives at most what it can on the 전표 date (later lines keep
--          their stock); the destination has the stock from that date.
-- A 구역 with another 보관온도 than the product is allowed but listed in
-- "warnings" (the screen shows stock_transfer_warnings before saving).
create or replace function public.transfer_stock(header jsonb, lines jsonb)
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

    -- What the source can give on the 전표 date (earlier lines of this
    -- 전표 are saved already, see dispose_stock).
    available := public.stock_available_from(line_lot_id, from_location, transfer_date);
    if line_quantity > available then
      perform public.raise_stock_error(
        public.stock_take_too_much_message(
          '이동할', lot_row.name || ' 로트 ' || lot_row.lot_no,
          coalesce((select info.label from public.stock_location_info(from_location) as info), '-'),
          transfer_date, available, lot_row.unit,
          coalesce((
            select balance.quantity from public.stock_balances as balance
            where balance.lot_id = line_lot_id and balance.location_id = from_location
          ), 0)
        ),
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

  perform public.check_stock_document_history(document.id);

  return jsonb_build_object(
    'document_id', document.id,
    'doc_no', document.doc_no,
    'doc_date', document.doc_date,
    'doc_type', document.doc_type,
    'warnings', to_jsonb(warnings)
  );
end;
$$;

comment on function public.transfer_stock(jsonb, jsonb) is '재고처간 이동: 로트를 한 위치에서 다른 위치로 옮깁니다 (보내는 쪽은 전표 일자에 쓸 수 있는 만큼, 받는 위치는 사용 중이어야 함). 보관온도가 다른 구역이면 warnings로 알립니다.';

-- 실사재고조정 (stock count).
-- header: {"doc_date" (the count date, up to today + the setting), "memo"
--          (사유), "request_id"}
-- lines: [{"lot_id", "location_id", "system_quantity" (the quantity the
--          screen showed for the end of doc_date), "counted_quantity"
--          (0 or more), "memo"}, …]
-- new_lots: stock found that has no lot yet: [{"product_id" (기준상품),
--          "location_id", "quantity", "expiry_kind", "expiry_date",
--          "manufactured_date", "lot_no", "supplier_lot_no",
--          "unit_cost_incl_vat", "origin", "memo"}, …] (입고일 = doc_date).
-- Only differences are saved (counted − system as a + or − line). When the
-- stock of the count date changed after the screen read it (system_quantity
-- is not the quantity at the end of doc_date now), nothing is saved
-- (stock_count_changed: read the 실사 목록 again). A decrease must leave
-- the lines dated after the count enough (stock_history_negative). No
-- difference at all → stock_count_no_difference. A line that puts stock
-- where its lot had none that day needs a 사용 위치 (like 입고;
-- stock_location_inactive).
-- Returns {"document_id", "doc_no", "doc_date", "doc_type", "increased",
--          "decreased", "unchanged", "lots" (new lots), "warnings"}.
create or replace function public.apply_stock_count(
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

    -- The 전산 수량 = the stock at the end of the count date.
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

    -- A decrease must leave enough for the lines dated after the count
    -- (earlier 실사 dates, and 예정 전표 after today alike).
    if counted_quantity < current_quantity
      and current_quantity - counted_quantity
        > public.stock_available_from(line_lot_id, line_location_id, count_date) then
      if count_date < public.stock_today() then
        perform public.raise_stock_error(
          format('%s 이후에 이 로트(%s %s)에서 나간 재고가 있어, 그 날짜로 %s %s까지 줄일 수 없습니다. 오늘 날짜로 실사해 주세요.',
            count_date, lot_row.name, lot_row.lot_no,
            public.stock_quantity_text(counted_quantity), lot_row.unit),
          'stock_history_negative', line_no, 'counted_quantity', '23514',
          jsonb_build_object('list', 'lines'));
      end if;
      perform public.raise_stock_error(
        format('%s 뒤 날짜의 전표가 이 로트(%s %s)의 재고를 쓰고 있어, 그 날짜로 %s %s까지 줄일 수 없습니다. 뒤 날짜의 전표(예정 출고 등)를 먼저 확인해 주세요.',
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

  perform public.check_stock_document_history(document.id, 'lines');

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

comment on function public.apply_stock_count(jsonb, jsonb, jsonb) is '실사재고조정: 실사 일자 마감 수량(전산 수량)과의 차이만 +/- 조정하고, 새로 발견한 재고는 새 로트로 넣습니다. 불러온 뒤 재고가 바뀌었거나 줄인 만큼을 뒤 날짜 전표가 쓰고 있으면 저장하지 않습니다.';

-- 실사 목록: the stock of a 창고 (or one 구역 / 위치) at the end of as_of
-- (default today; up to today + the setting): one line per (lot, location)
-- with a quantity above 0. At most 3,000 lines (otherwise choose a smaller
-- scope).
-- Returns {"as_of", "lines": [{"lot_id", "location_id", "system_quantity",
-- product, lot, location …}]} sorted by 창고·구역·위치, 상품코드, 기한.
create or replace function public.stock_count_sheet(
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
  perform public.check_stock_doc_date(count_date, '실사 일자는');

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

comment on function public.stock_count_sheet(uuid, uuid, uuid, date) is '실사 목록: 창고(구역·위치) 안의 그 날짜 마감 재고 (로트 × 위치, 최대 3,000줄; 날짜는 오늘 이후 재고 설정의 일수까지).';

-- 취소 (undo a 전표).
-- target_document_id: the 전표 to undo. header: {"doc_date" (empty =
-- today, or the original 전표 date when that is later; not before the
-- original 전표 date; at most today + the setting — or the original date
-- when that is later, so a 예정 전표 can always be undone), "memo" (empty =
-- "<전표번호> 취소"), "request_id"}.
-- Creates a 취소 전표 with the opposite of every line and marks both. Only
-- when the stock it takes back can go on the 취소 date without leaving a
-- later line without stock (e.g. a 입고 whose stock was partly issued —
-- also by a 예정 출고 — cannot be undone: undo the 출고 first). A 취소 전표
-- and an already undone 전표 cannot be undone.
create or replace function public.reverse_stock_document(
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
  later_date date;
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

  reversal_date := coalesce(
    public.read_stock_date(header -> 'doc_date', null, 'doc_date', '취소 일자'),
    greatest(public.stock_today(), original.doc_date)
  );
  if reversal_date > greatest(public.stock_max_doc_date(), original.doc_date) then
    perform public.raise_stock_error(
      case
        when original.doc_date > public.stock_max_doc_date()
          then format('이 예정 전표는 원래 전표 일자(%s)로 취소해 주세요. (재고 설정의 날짜 범위를 넘습니다.)', original.doc_date)
        else public.stock_doc_date_limit_message('취소 일자는')
      end,
      'stock_doc_date_future', null, 'doc_date', '22023');
  end if;
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

  -- Every (lot, location) the 취소 takes stock from must be able to give it
  -- on the 취소 date without leaving a later line without stock.
  for pair in
    select movement.lot_id, movement.location_id, sum(movement.quantity_delta) as quantity,
      min(movement.line_no) as line_no
    from public.stock_movements as movement
    where movement.document_id = original.id
    group by movement.lot_id, movement.location_id
    having sum(movement.quantity_delta) > 0
  loop
    available := public.stock_available_from(pair.lot_id, pair.location_id, reversal_date);
    if available < pair.quantity then
      select product.name, product.unit, lot.lot_no into lot_info
      from public.stock_lots as lot
      join public.products as product on product.id = lot.product_id
      where lot.id = pair.lot_id;
      -- Enough today, but not on every day since the (earlier) 취소 date.
      if reversal_date < public.stock_today()
        and public.stock_available_from(pair.lot_id, pair.location_id, public.stock_today()) >= pair.quantity then
        perform public.raise_stock_error(
          format('%s 이후에 이 로트(%s %s)에서 나간 재고가 있어 그 날짜로는 취소할 수 없습니다. 취소 일자를 오늘로 해 주세요.',
            reversal_date, lot_info.name, lot_info.lot_no),
          'stock_history_negative', pair.line_no, 'doc_date', '23514',
          jsonb_build_object('lot_id', pair.lot_id, 'location_id', pair.location_id));
      end if;
      -- Enough on a later date that a 취소 may still have: the lines that
      -- need the stock are dated after the 취소 date — typically a 예정
      -- 출고 that was undone on its own (later) date, which puts the stock
      -- back only from that date. Name the first such date (the smallest
      -- running balance from a date on only grows with the date).
      select line_date.value into later_date
      from (
        select distinct movement.doc_date as value
        from public.stock_movements as movement
        where movement.lot_id = pair.lot_id
          and movement.location_id = pair.location_id
          and movement.doc_date > reversal_date
          and movement.doc_date <= greatest(public.stock_max_doc_date(), original.doc_date)
      ) as line_date
      where public.stock_available_from(pair.lot_id, pair.location_id, line_date.value) >= pair.quantity
      order by line_date.value
      limit 1;
      if later_date is not null then
        perform public.raise_stock_error(
          format('%s 뒤 날짜의 전표가 이 로트(%s %s)의 재고를 쓰고 있어 그 날짜로는 취소할 수 없습니다. 취소 일자를 %s(으)로 해 주세요.',
            reversal_date, lot_info.name, lot_info.lot_no, later_date),
          'stock_history_negative', pair.line_no, 'doc_date', '23514',
          jsonb_build_object('lot_id', pair.lot_id, 'location_id', pair.location_id,
            'suggested_date', later_date));
      end if;
      perform public.raise_stock_error(
        format('이미 출고·이동·폐기된 재고(예정 전표 포함)가 있어 취소할 수 없습니다: %s 로트 %s, %s (취소에 필요한 수량 %s %s, 남은 수량 %s %s). 그 전표들을 먼저 취소해 주세요.',
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
  -- moment (−5 at B before +3 at B). seq follows this order, so the
  -- history check below never sees such a moment either.
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

  perform public.check_stock_document_history(document.id);

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

comment on function public.reverse_stock_document(uuid, jsonb) is '전표 취소: 모든 줄의 반대 수량으로 취소 전표를 만들고 두 전표를 서로 연결합니다 (기본 날짜: 오늘, 예정 전표는 그 날짜). 되돌릴 재고가 이미 나갔거나 뒤 날짜 전표가 쓰고 있으면 취소할 수 없습니다.';

-- 기초재고 일괄등록: the stock on hand when the company starts using the
-- ERP. One 기초재고 전표 (doc_type 'opening') with one new lot per row.
-- Its date: opening_date when given; otherwise today — or the latest
-- 입고일 of the rows when that is later (a lot cannot be in stock before
-- its 입고일), so a file whose 입고일 is tomorrow becomes a 예정 기초재고
-- of tomorrow. 입고일 and the date: at most today + the setting. All or
-- nothing: the first row that fails undoes everything and is reported with
-- its Excel row (hint import_row_invalid, detail {sheet, excel_row, field
-- (column key of src/lib/imports/opening-stock.ts), rule, reason, state}).
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
create or replace function public.import_opening_stock(
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
  latest_received date;
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
  if opening_date is not null then
    document_date := public.read_stock_doc_date(to_jsonb(opening_date));
  end if;

  begin
    -- The 입고일 of every row first: each at most today + the setting; the
    -- latest decides the 전표 date (when no opening_date was given).
    current_field := 'receivedDate';
    latest_received := null;
    for entry in select value from jsonb_array_elements(rows) loop
      row_value := entry.value;
      current_row := (row_value ->> 'excel_row')::integer;
      received := public.read_stock_date(row_value -> 'received_date', null, 'received_date', '입고일');
      perform public.check_stock_doc_date(received, '입고일은', null, 'received_date');
      latest_received := greatest(latest_received, received);
    end loop;
    current_row := null;
    if document_date is null then
      document_date := greatest(public.stock_today(), coalesce(latest_received, public.stock_today()));
      perform public.check_stock_doc_date(document_date);
    end if;

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

comment on function public.import_opening_stock(jsonb, date, uuid) is '기초재고 일괄등록: 엑셀 행마다 기준상품 로트를 만들어 기초재고 전표 하나로 넣습니다 (전표 일자: 오늘, 입고일이 오늘 이후인 행이 있으면 가장 늦은 입고일 = 예정). 모두 저장되거나 하나도 저장되지 않으며, 실패한 엑셀 행을 알립니다. 같은 저장 요청(request_id)이 다시 오면 새로 저장하지 않고 그 전표를 돌려줍니다.';

-- 상품별 거래수불 (same as migration 8, except the 잔량): every line of the
-- period in (doc_date, seq) order with its running 잔량 from the 이월.
-- The lines of a 전표 undone on its own date and their 취소 lines (not in
-- stock_history_lines) are listed but do not move the 잔량 — that 전표
-- never took stock on any day, and the stock it held may already be used by
-- other 전표 of earlier dates (counting it would show a 잔량 below 0 for a
-- moment). They carry "same_day_cancelled": true. 입고/출고 sums, the
-- 기말 and the summary count every line as before (such a pair adds up to 0).
create or replace function public.product_stock_ledger(
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
      -- A line of a 전표 undone on its own date (or its 취소 line).
      history_line.id is null as same_day_cancelled,
      opening + sum(case when history_line.id is null then 0 else movement.quantity_delta end) over (
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
    left join public.stock_history_lines as history_line on history_line.id = movement.id
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

comment on function public.product_stock_ledger(uuid, date, date, uuid, uuid, uuid) is '상품별 거래수불: 기간 안의 전표 줄(일자·저장 순서)과 이월부터의 잔량 (같은 날 취소된 전표의 줄은 잔량을 바꾸지 않음, same_day_cancelled). JSON.';

-- The dashboard's stock cards: 기한 경과 / 기한 임박 (the setting) / 보관온도
-- 불일치 (rows, lots, products, value) and the stock on hand (after every
-- entered 전표, 예정 ones included), plus the latest 전표 (recent_limit,
-- 1–50) and the number of 예정 전표 (dated after today, not undone).
create or replace function public.stock_dashboard(recent_limit integer default 10)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'today', public.stock_today(),
    'expiry_warning_days', (select settings.expiry_warning_days from public.app_settings as settings),
    'future_doc_days', public.stock_future_doc_days(),
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
    'scheduled', (
      select jsonb_build_object(
        'document_count', count(*),
        'issue_count', count(*) filter (where document.doc_type = 'issue'),
        'first_date', min(document.doc_date),
        'last_date', max(document.doc_date)
      )
      from public.stock_documents as document
      where document.doc_date > public.stock_today()
        and document.doc_type <> 'reversal'
        and document.reversed_by_id is null
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

comment on function public.stock_dashboard(integer) is '대시보드 재고 카드: 기한 경과·기한 임박·보관온도 불일치 재고(건수·로트·상품·금액), 전체 재고(예정 전표 포함), 예정 전표 수, 최근 전표. JSON.';

-- -----------------------------------------------------------------------------
-- 6. Privileges of the new functions (Supabase grants new functions to
-- everyone by default: revoke first). Replaced functions keep theirs.
-- -----------------------------------------------------------------------------

revoke all on function public.stock_future_doc_days() from public, anon, authenticated;
revoke all on function public.stock_max_doc_date() from public, anon, authenticated;
revoke all on function public.stock_doc_date_limit_message(text) from public, anon, authenticated;
revoke all on function public.check_stock_doc_date(date, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.stock_pair_at(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.check_stock_document_history(uuid, text) from public, anon, authenticated;
revoke all on function public.stock_available_on(uuid[], date) from public, anon, authenticated;
revoke all on function public.stock_shortage_notes(jsonb, date) from public, anon, authenticated;
revoke all on function public.stock_take_too_much_message(text, text, text, date, numeric, text, numeric) from public, anon, authenticated;

-- Used by read functions running as the employee (and by the screens).
grant execute on function public.stock_future_doc_days() to authenticated, service_role;
grant execute on function public.stock_max_doc_date() to authenticated, service_role;
grant execute on function public.stock_doc_date_limit_message(text) to authenticated, service_role;
grant execute on function public.check_stock_doc_date(date, text, integer, text, jsonb) to authenticated, service_role;
grant execute on function public.stock_pair_at(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.stock_available_on(uuid[], date) to authenticated, service_role;
grant execute on function public.stock_shortage_notes(jsonb, date) to authenticated, service_role;
-- Only used inside the save functions (which run as the owner).
grant execute on function public.check_stock_document_history(uuid, text) to service_role;
grant execute on function public.stock_take_too_much_message(text, text, text, date, numeric, text, numeric) to service_role;

-- Tell the API (PostgREST) to read the new column and functions.
notify pgrst, 'reload schema';
