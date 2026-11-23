alter table public.tabs
  add column if not exists reversal_attribution text,
  add column if not exists reversal_post_close_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.tabs'::regclass
      and constraint_record.conname = 'tabs_reversal_attribution_check'
  ) then
    alter table public.tabs drop constraint tabs_reversal_attribution_check;
  end if;
  alter table public.tabs
    add constraint tabs_reversal_attribution_check
    check (reversal_attribution is null or reversal_attribution in ('same_shift', 'post_close', 'ambiguous'));
end
$$;

comment on column public.tabs.reversal_attribution is
  'Explicit operational attribution: same_shift, post_close, or ambiguous. Null means historical or not yet classified.';
comment on column public.tabs.reversal_post_close_at is
  'Deterministic operational event timestamp for explicitly post-close reversals. It is a reportable event marker, not the basis for ownership.';

create or replace function public.prevent_duplicate_tab_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'reversal' and new.reverses_tab_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.reverses_tab_id::text, 0)
    );
    if exists (
      select 1
      from public.tabs existing
      where existing.kind = 'reversal'
        and existing.reverses_tab_id = new.reverses_tab_id
        and existing.id <> new.id
    ) then
      raise exception 'This payment has already been reversed.';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.prevent_duplicate_tab_reversal() from public, anon, authenticated;

drop trigger if exists prevent_duplicate_tab_reversal_trigger on public.tabs;
create trigger prevent_duplicate_tab_reversal_trigger
before insert or update of kind, reverses_tab_id on public.tabs
for each row
execute function public.prevent_duplicate_tab_reversal();

create or replace function public.capture_shift_reversal_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
AS $$
begin
  if new.status = 'closed'
    and old.status = 'open'
    and new.closed_at is not null then
    insert into public.shift_reversal_snapshots (
      store_id,
      shift_id,
      reversal_id,
      reversal_amount_millimes,
      payment_method,
      captured_at
    )
    select
      new.store_id,
      new.id,
      reversal.id,
      reversal.amount_millimes,
      reversal.payment_method,
      new.closed_at
    from public.tabs reversal
    where reversal.store_id = new.store_id
      and reversal.shift_id = new.id
      and reversal.kind = 'reversal'
      and reversal.reversal_attribution = 'same_shift'
      and reversal.created_at <= new.closed_at
    on conflict do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.capture_shift_reversal_snapshot() from public, anon, authenticated;

create or replace function public.reverse_tab_payment(
  p_payment_id uuid,
  p_pin text,
  p_reason text
)
returns public.tabs
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.tabs%rowtype;
  target_store public.stores%rowtype;
  original_shift public.shifts%rowtype;
  target_shift public.shifts%rowtype;
  result public.tabs%rowtype;
  locked_shift public.shifts%rowtype;
  attribution text;
  post_close_at timestamptz;
begin
  select * into payment
  from public.tabs
  where id = p_payment_id
  for update;

  if not found or payment.store_id <> (select public.current_store_id())
    or not public.is_store_owner(payment.store_id) then
    raise exception 'Only this store owner can reverse a tab payment.' using errcode = '42501';
  end if;
  if payment.kind <> 'settled'
    or length(btrim(coalesce(p_reason, ''))) = 0
    or length(p_reason) > 500 then
    raise exception 'A valid payment and reversal reason are required.';
  end if;
  if exists (
    select 1
    from public.tabs
    where reverses_tab_id = payment.id
      and kind = 'reversal'
  ) then
    raise exception 'This payment has already been reversed.';
  end if;
  if not public.verify_store_pin(payment.store_id, p_pin, 'credit_override') then
    raise exception 'Incorrect Admin PIN.';
  end if;

  select * into target_store
  from public.stores
  where store_id = payment.store_id
  for update;
  if not found then
    raise exception 'The original store could not be found.';
  end if;

  select * into original_shift
  from public.shifts
  where id = payment.shift_id
    and store_id = payment.store_id
  ;

  if not found then
    raise exception 'The original settlement shift could not be found.';
  end if;

  select * into target_shift
  from public.shifts
  where store_id = payment.store_id
    and staff_id = auth.uid()
    and status = 'open'
  order by opened_at desc
  limit 1;

  for locked_shift in
    select shift.*
    from public.shifts shift
    where shift.store_id = payment.store_id
      and shift.id in (original_shift.id, target_shift.id)
    order by shift.id
    for update
  loop
    if locked_shift.id = original_shift.id then
      original_shift := locked_shift;
    end if;
    if target_shift.id is not null and locked_shift.id = target_shift.id then
      target_shift := locked_shift;
    end if;
  end loop;

  if original_shift.status = 'open' then
    attribution := 'same_shift';
  elsif original_shift.status = 'closed' and target_shift.id is not null then
    attribution := 'post_close';
  elsif original_shift.status = 'closed' then
    attribution := 'ambiguous';
  else
    attribution := 'ambiguous';
  end if;

  if attribution = 'post_close' then
    post_close_at := clock_timestamp();
  else
    post_close_at := null;
  end if;

  insert into public.tabs (
    store_id,
    customer_id,
    shift_id,
    staff_id,
    kind,
    amount_millimes,
    note,
    reverses_tab_id,
    payment_method,
    reversal_attribution,
    reversal_post_close_at
  ) values (
    payment.store_id,
    payment.customer_id,
    case
      when attribution = 'same_shift' then original_shift.id
      when attribution = 'post_close' then target_shift.id
      else original_shift.id
    end,
    auth.uid(),
    'reversal',
    payment.amount_millimes,
    btrim(p_reason),
    payment.id,
    payment.payment_method,
    attribution,
    post_close_at
  ) returning * into result;

  return result;
end
$$;

revoke all on function public.reverse_tab_payment(uuid, text, text) from public, anon;
grant execute on function public.reverse_tab_payment(uuid, text, text) to authenticated;

create or replace function public.get_tab_reversal_status(
  p_reversal_id uuid,
  p_reversal_shift_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when exists (
        select 1
        from public.shift_reversal_snapshots snapshot
        where snapshot.reversal_id = p_reversal_id
          and snapshot.shift_id = p_reversal_shift_id
      ) then 'included'
      when exists (
        select 1
        from public.tabs reversal
        where reversal.id = p_reversal_id
          and reversal.kind = 'reversal'
          and reversal.reversal_attribution = 'post_close'
      ) then 'proven_post_close'
      when exists (
        select 1
        from public.tabs reversal
        where reversal.id = p_reversal_id
          and reversal.kind = 'reversal'
          and reversal.reversal_attribution = 'same_shift'
      ) then 'included'
      else 'ambiguous'
    end;
$$;

revoke all on function public.get_tab_reversal_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_tab_reversal_status(uuid, uuid) to authenticated;

create or replace function public.get_shift_expected_cash(p_shift_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
begin
  select * into target
  from public.shifts shift
  where shift.id = p_shift_id;

  if not found or target.store_id <> (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or (
        target.staff_id = (select auth.uid())
        and public.has_store_permission('open_close_shift')
      )
    ) then
    raise exception 'Not authorized to view expected shift cash.' using errcode = '42501';
  end if;

  if target.status = 'closed' and target.expected_cash_millimes is not null then
    return target.expected_cash_millimes + coalesce((
      select sum(adjustment.amount_millimes)
      from public.shift_void_adjustments adjustment
      join public.orders order_record
        on order_record.id = adjustment.order_id
       and order_record.shift_id = adjustment.shift_id
       and order_record.store_id = adjustment.store_id
      where adjustment.shift_id = target.id
        and order_record.payment_method = 'cash'
    ), 0);
  end if;

  return target.starting_cash_millimes
    + coalesce((
      select sum(order_record.total_millimes)
      from public.orders order_record
      where order_record.shift_id = target.id
        and order_record.status = 'done'
        and order_record.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and tab.reversal_attribution in ('same_shift', 'post_close')
          then -tab.amount_millimes
        else 0
      end)
      from public.tabs tab
      where tab.shift_id = target.id
        and tab.kind in ('settled', 'reversal')
        and tab.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case
        when movement.kind = 'in' then movement.amount_millimes
        else -movement.amount_millimes
      end)
      from public.cash_movements movement
      where movement.shift_id = target.id
    ), 0)
    + coalesce((
      select sum(adjustment.amount_millimes)
      from public.shift_void_adjustments adjustment
      join public.orders order_record
        on order_record.id = adjustment.order_id
       and order_record.shift_id = adjustment.shift_id
       and order_record.store_id = adjustment.store_id
      where adjustment.shift_id = target.id
        and order_record.payment_method = 'cash'
    ), 0);
end
$$;

revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;

create or replace function public.get_customer_balance(p_customer_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.customers%rowtype;
  result bigint;
begin
  select * into target
  from public.customers
  where id = p_customer_id;

  if not found or target.store_id <> (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or public.has_store_permission('customers_view')
      or public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    ) then
    raise exception 'Not authorized to view this customer balance.' using errcode = '42501';
  end if;

  select coalesce((
    select sum(order_record.total_millimes)
    from public.orders order_record
    where order_record.customer_id = target.id
      and order_record.payment_method = 'tab'
      and order_record.status = 'done'
  ), 0)
  - coalesce((
    select sum(tab.amount_millimes)
    from public.tabs tab
    where tab.customer_id = target.id
      and tab.kind = 'settled'
  ), 0)
  + coalesce((
    select sum(tab.amount_millimes)
    from public.tabs tab
    where tab.customer_id = target.id
      and tab.kind = 'reversal'
      and tab.reversal_attribution in ('same_shift', 'post_close')
  ), 0)
  + coalesce((
    select sum(tab.amount_millimes)
    from public.tabs tab
    where tab.customer_id = target.id
      and tab.kind = 'issued'
      and tab.order_id is null
  ), 0)
  into result;

  return result;
end
$$;

revoke all on function public.get_customer_balance(uuid) from public, anon;
grant execute on function public.get_customer_balance(uuid) to authenticated;

create or replace function public.get_customer_balance_reconciliation(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  verified_balance bigint;
  unresolved_amount bigint;
  unresolved jsonb;
begin
  verified_balance := public.get_customer_balance(p_customer_id);
  select coalesce(sum(tab.amount_millimes), 0)::bigint
  into unresolved_amount
  from public.tabs tab
  where tab.customer_id = p_customer_id
    and tab.kind = 'reversal'
    and (tab.reversal_attribution is null or tab.reversal_attribution = 'ambiguous');

  select coalesce(jsonb_agg(jsonb_build_object(
    'reversalId', tab.id,
    'originalSettlementId', tab.reverses_tab_id,
    'paymentMethod', tab.payment_method,
    'amountMillimes', tab.amount_millimes,
    'reversalCreatedAt', tab.created_at
  ) order by tab.created_at), '[]'::jsonb)
  into unresolved
  from public.tabs tab
  where tab.customer_id = p_customer_id
    and tab.kind = 'reversal'
    and (tab.reversal_attribution is null or tab.reversal_attribution = 'ambiguous');

  return jsonb_build_object(
    'verifiedBalanceMillimes', verified_balance,
    'unresolvedReversalMillimes', unresolved_amount,
    'unresolvedReversals', unresolved
  );
end
$$;

revoke all on function public.get_customer_balance_reconciliation(uuid) from public, anon;
grant execute on function public.get_customer_balance_reconciliation(uuid) to authenticated;

create or replace function public.get_reversal_ledger(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cash_settled bigint;
  card_settled bigint;
  other_settled bigint;
  cash_same_shift bigint;
  card_same_shift bigint;
  other_same_shift bigint;
  cash_post_close bigint;
  card_post_close bigint;
  other_post_close bigint;
  unresolved jsonb;
begin
  select
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'cash'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'card'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'other'
    ), 0)
  into cash_settled, card_settled, other_settled
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.kind = 'settled'
    and tab.created_at between p_from and p_to;

  select
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'included'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'included'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'included'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'proven_post_close'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'proven_post_close'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'proven_post_close'
    ), 0)
  into cash_same_shift, card_same_shift, other_same_shift,
       cash_post_close, card_post_close, other_post_close
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.kind = 'reversal'
    and tab.created_at between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reversalId', reversal.id,
    'originalSettlementId', reversal.reverses_tab_id,
    'originalShiftId', original.shift_id,
    'reversalShiftId', reversal.shift_id,
    'paymentMethod', reversal.payment_method,
    'amountMillimes', reversal.amount_millimes,
    'originalSettlementCreatedAt', original.created_at,
    'reversalCreatedAt', reversal.created_at,
    'reason', reversal.note,
    'state', 'ambiguous'
  ) order by reversal.created_at), '[]'::jsonb)
  into unresolved
  from public.tabs reversal
  join public.tabs original
    on original.id = reversal.reverses_tab_id
  where reversal.store_id = p_store_id
    and reversal.kind = 'reversal'
    and public.get_tab_reversal_status(reversal.id, reversal.shift_id) = 'ambiguous'
    and reversal.created_at between p_from and p_to;

  return jsonb_build_object(
    'cashVerifiedSettlementsMillimes', cash_settled,
    'cardVerifiedSettlementsMillimes', card_settled,
    'otherVerifiedSettlementsMillimes', other_settled,
    'cashSameShiftReversalMillimes', cash_same_shift,
    'cardSameShiftReversalMillimes', card_same_shift,
    'otherSameShiftReversalMillimes', other_same_shift,
    'cashPostCloseReversalMillimes', cash_post_close,
    'cardPostCloseReversalMillimes', card_post_close,
    'otherPostCloseReversalMillimes', other_post_close,
    'cashVerifiedNetMillimes', cash_settled - cash_same_shift - cash_post_close,
    'cardVerifiedNetMillimes', card_settled - card_same_shift - card_post_close,
    'otherVerifiedNetMillimes', other_settled - other_same_shift - other_post_close,
    'unresolvedTabReversals', unresolved
  );
end
$$;

revoke all on function public.get_reversal_ledger(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_reversal_ledger(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.capture_shift_reversal_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed'
    and old.status = 'open'
    and new.closed_at is not null then
    insert into public.shift_reversal_snapshots (
      store_id,
      shift_id,
      reversal_id,
      reversal_amount_millimes,
      payment_method,
      captured_at
    )
    select
      new.store_id,
      new.id,
      reversal.id,
      reversal.amount_millimes,
      reversal.payment_method,
      new.closed_at
    from public.tabs reversal
    where reversal.store_id = new.store_id
      and reversal.shift_id = new.id
      and reversal.kind = 'reversal'
      and reversal.reversal_attribution = 'same_shift'
    on conflict do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.capture_shift_reversal_snapshot() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.get_shift_summary(uuid)') is not null
    and to_regprocedure('public.get_shift_summary_legacy(uuid)') is null then
    execute 'alter function public.get_shift_summary(uuid) rename to get_shift_summary_legacy';
  end if;
end
$$;

create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target public.shifts%rowtype;
  expected_cash bigint;
  unresolved jsonb;
begin
  result := public.get_shift_summary_legacy(p_shift_id);
  select * into target from public.shifts where id = p_shift_id;
  expected_cash := public.get_shift_expected_cash(p_shift_id);
  result := jsonb_set(result, '{expectedCashMillimes}', to_jsonb(expected_cash), true);
  result := jsonb_set(
    result,
    '{cashFlowExFloatMillimes}',
    to_jsonb(expected_cash - target.starting_cash_millimes),
    true
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'reversalId', reversal.id,
    'originalSettlementId', reversal.reverses_tab_id,
    'originalShiftId', original.shift_id,
    'reversalShiftId', reversal.shift_id,
    'paymentMethod', reversal.payment_method,
    'amountMillimes', reversal.amount_millimes,
    'originalSettlementCreatedAt', original.created_at,
    'reversalCreatedAt', reversal.created_at,
    'reason', reversal.note,
    'state', 'ambiguous'
  ) order by reversal.created_at), '[]'::jsonb)
  into unresolved
  from public.tabs reversal
  join public.tabs original
    on original.id = reversal.reverses_tab_id
  where reversal.shift_id = p_shift_id
    and reversal.kind = 'reversal'
    and public.get_tab_reversal_status(reversal.id, reversal.shift_id) = 'ambiguous';

  if target.status = 'open' then
    result := jsonb_set(result, '{tabPaymentsMillimes}', to_jsonb(coalesce((
      select sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and tab.reversal_attribution in ('same_shift', 'post_close')
          then -tab.amount_millimes
        else 0
      end)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.payment_method = 'cash'
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
    result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(coalesce((
      select coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'card'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'card'
          and tab.reversal_attribution in ('same_shift', 'post_close')
      ), 0)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
    result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(coalesce((
      select coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'other'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'other'
          and tab.reversal_attribution in ('same_shift', 'post_close')
      ), 0)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
  elsif target.status = 'closed' then
    result := jsonb_set(result, '{tabPaymentsMillimes}', to_jsonb(coalesce((
      select sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and (
            public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
            or tab.reversal_attribution = 'post_close'
          )
          then -tab.amount_millimes
        else 0
      end)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.payment_method = 'cash'
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
    result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(coalesce((
      select coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'card'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'card'
          and (
            public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
            or tab.reversal_attribution = 'post_close'
          )
      ), 0)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
    result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(coalesce((
      select coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'other'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'other'
          and (
            public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
            or tab.reversal_attribution = 'post_close'
          )
      ), 0)
      from public.tabs tab
      where tab.shift_id = p_shift_id
        and tab.kind in ('settled', 'reversal')
    ), 0)), true);
  end if;

  result := jsonb_set(result, '{unresolvedTabReversals}', unresolved, true);
  return result;
end
$$;

revoke all on function public.get_shift_summary(uuid) from public, anon;
grant execute on function public.get_shift_summary(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean)') is not null
    and to_regprocedure('public.get_dashboard_summary_legacy(uuid,timestamptz,timestamptz,boolean)') is null then
    execute 'alter function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) rename to get_dashboard_summary_legacy';
  end if;
end
$$;

create or replace function public.get_dashboard_summary(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_use_expense_creation_period boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  shift_lines jsonb := '[]'::jsonb;
  shift_summary jsonb;
  shift_line jsonb;
  unresolved jsonb;
  cash_refunds bigint;
  reconstructed_expected bigint;
  cash_float bigint;
  total_counted bigint;
  total_difference bigint;
  cash_sales bigint;
  cash_tab_net bigint;
  card_tab_net bigint;
  other_tab_net bigint;
begin
  result := public.get_dashboard_summary_legacy(
    p_store_id,
    p_from,
    p_to,
    p_use_expense_creation_period
  );

  for shift_line in
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(result->'shiftLines') = 'array' then result->'shiftLines'
        else '[]'::jsonb
      end
    )
  loop
    shift_summary := public.get_shift_summary((shift_line->>'shiftId')::uuid);
    shift_lines := shift_lines || jsonb_build_array(shift_summary);
  end loop;
  result := jsonb_set(result, '{shiftLines}', shift_lines, true);

  select coalesce(sum((entry->>'expectedCashMillimes')::bigint), 0)::bigint,
         coalesce(sum((entry->>'startingCashMillimes')::bigint), 0)::bigint,
         coalesce(sum(case when entry->>'status' <> 'in_progress'
           then coalesce((entry->>'countedCashMillimes')::bigint, 0) else 0 end), 0)::bigint,
         coalesce(sum(case when entry->>'status' <> 'in_progress'
           then coalesce((entry->>'differenceMillimes')::bigint, 0) else 0 end), 0)::bigint,
         coalesce(sum(coalesce((entry->>'cashSalesMillimes')::bigint, 0)), 0)::bigint
  into reconstructed_expected, cash_float, total_counted, total_difference, cash_sales
  from jsonb_array_elements(shift_lines) entry;

  select coalesce(sum(tab.amount_millimes) filter (
    where tab.kind = 'reversal'
      and tab.payment_method = 'cash'
      and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'proven_post_close'
  ), 0)::bigint
  into cash_refunds
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.created_at between p_from and p_to;

  select
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'cash'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'reversal'
        and tab.payment_method = 'cash'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'card'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'reversal'
        and tab.payment_method = 'card'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'other'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'reversal'
        and tab.payment_method = 'other'
        and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0)
  into cash_tab_net, card_tab_net, other_tab_net
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reversalId', reversal.id,
    'originalSettlementId', reversal.reverses_tab_id,
    'originalShiftId', original.shift_id,
    'reversalShiftId', reversal.shift_id,
    'paymentMethod', reversal.payment_method,
    'amountMillimes', reversal.amount_millimes,
    'originalSettlementCreatedAt', original.created_at,
    'reversalCreatedAt', reversal.created_at,
    'reason', reversal.note,
    'state', 'ambiguous'
  ) order by reversal.created_at), '[]'::jsonb)
  into unresolved
  from public.tabs reversal
  join public.tabs original
    on original.id = reversal.reverses_tab_id
  where reversal.store_id = p_store_id
    and reversal.kind = 'reversal'
    and reversal.created_at between p_from and p_to
    and public.get_tab_reversal_status(reversal.id, reversal.shift_id) = 'ambiguous';

  result := jsonb_set(result, '{cashRefundsMillimes}', to_jsonb(cash_refunds), true);
  result := jsonb_set(result, '{tabsSettledMillimes}', to_jsonb(cash_tab_net), true);
  result := jsonb_set(result, '{tabPaymentsReceivedMillimes}', to_jsonb(cash_tab_net), true);
  result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(card_tab_net), true);
  result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(other_tab_net), true);
  result := jsonb_set(result, '{nonCashTabPaymentsMillimes}', to_jsonb(card_tab_net + other_tab_net), true);
  result := jsonb_set(result, '{totalExpectedCashMillimes}', to_jsonb(reconstructed_expected), true);
  result := jsonb_set(result, '{expectedCashExFloatMillimes}', to_jsonb(reconstructed_expected - cash_float), true);
  result := jsonb_set(result, '{cashFloatMillimes}', to_jsonb(cash_float), true);
  result := jsonb_set(result, '{totalCountedMillimes}', to_jsonb(total_counted), true);
  result := jsonb_set(result, '{totalDifferenceMillimes}', to_jsonb(total_difference), true);
  result := jsonb_set(result, '{cashSalesMillimes}', to_jsonb(cash_sales), true);
  result := jsonb_set(result, '{cashDifferenceMillimes}', to_jsonb(total_difference), true);
  result := jsonb_set(result, '{unresolvedTabReversals}', unresolved, true);
  result := jsonb_set(
    result,
    '{ambiguousTabReversalIds}',
    coalesce((
      select jsonb_agg(to_jsonb(reversal.id))
      from public.tabs reversal
      where reversal.store_id = p_store_id
        and reversal.kind = 'reversal'
        and reversal.created_at between p_from and p_to
        and public.get_tab_reversal_status(reversal.id, reversal.shift_id) = 'ambiguous'
    ), '[]'::jsonb),
    true
  );

  return result;
end
$$;

revoke all on function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) from public, anon;
grant execute on function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) to authenticated;

do $$
begin
  if to_regprocedure('public.record_report(jsonb,text)') is not null
    and to_regprocedure('public.record_report_legacy(jsonb,text)') is null then
    execute 'alter function public.record_report(jsonb,text) rename to record_report_legacy';
  end if;
end
$$;

create or replace function public.record_report(p_report jsonb, p_pin text default null)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_type text;
  actor public.profiles%rowtype;
  target_store public.stores%rowtype;
  period_from timestamptz;
  period_to timestamptz;
  previous_z_at timestamptz;
  expected_period_from timestamptz;
  ledger jsonb;
  unresolved_count integer;
  server_summary jsonb;
  server_sales bigint;
  server_order_count integer;
  shift_count integer;
  server_payment_split jsonb;
  server_cash_tab bigint;
  server_card_tab bigint;
  server_other_tab bigint;
  server_cash_refunds bigint;
  server_expected_cash bigint;
  server_cash_float bigint;
  server_total_counted bigint;
  server_total_difference bigint;
  expected_cash_ex_float bigint;
  counted_cash bigint;
  counted_card bigint;
  counted_other bigint;
  cash_difference bigint;
  card_difference bigint;
  other_difference bigint;
  expected_card bigint;
  expected_other bigint;
  assigned_z_number integer;
  business_day date;
  report_data jsonb;
  result public.reports%rowtype;
begin
  report_type := nullif(p_report->>'type', '');
  if report_type = 'X' then
    return public.record_report_legacy(p_report, p_pin);
  end if;
  if report_type is distinct from 'Z' then
    raise exception 'Report details or period are invalid.';
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active;
  select * into target_store
  from public.stores
  where store_id = actor.store_id
  for update;
  if actor.id is null or actor.role <> 'owner' or target_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;

  period_from := nullif(p_report->>'periodFrom', 'null')::timestamptz;
  period_to := nullif(p_report->>'periodTo', 'null')::timestamptz;
  if period_from is null or period_to is null
    or period_from > period_to
    or period_to is distinct from nullif(p_report->>'createdAt', 'null')::timestamptz
    or period_to < now() - interval '5 minutes'
    or period_to > now() + interval '30 seconds' then
    raise exception 'Report details or period are invalid.';
  end if;
  if jsonb_typeof(p_report->'shifts') is distinct from 'array' then
    raise exception 'Report shift lines must be a JSON array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    where jsonb_typeof(snapshot_line.value) is distinct from 'object'
      or jsonb_typeof(snapshot_line.value->'shiftId') is distinct from 'string'
      or snapshot_line.value->>'shiftId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Report shift IDs must be valid UUIDs.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    where jsonb_typeof(snapshot_line.value->'startingCashMillimes') is distinct from 'number'
      or snapshot_line.value->>'startingCashMillimes' !~ '^[0-9]+$'
      or jsonb_typeof(snapshot_line.value->'forceClosedByOwner') is distinct from 'boolean'
  ) then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;

  previous_z_at := public.get_last_z_report_boundary(target_store.store_id);
  select min(shift.opened_at)
  into expected_period_from
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at <= period_to
    and (previous_z_at is null or shift.opened_at > previous_z_at)
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  if expected_period_from is null then
    raise exception 'The business day is closed. Open a new shift before creating another report.';
  end if;
  if period_from is distinct from expected_period_from then
    raise exception 'Report period must begin when the first unreported shift after the previous Z opens.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    join public.z_reported_shifts reported
      on reported.store_id = target_store.store_id
      and reported.shift_id = (snapshot_line.value->>'shiftId')::uuid
  ) then
    raise exception 'A shift in this Z report was already included in a previous Z report.';
  end if;
  select count(*)::integer
  into shift_count
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  if jsonb_array_length(p_report->'shifts') <> shift_count then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;
  if exists (
    select 1
    from public.shifts eligible_shift
    where eligible_shift.store_id = target_store.store_id
      and eligible_shift.opened_at >= period_from
      and eligible_shift.opened_at <= period_to
      and not exists (
        select 1
        from public.z_reported_shifts reported
        where reported.store_id = eligible_shift.store_id
          and reported.shift_id = eligible_shift.id
      )
      and not exists (
        select 1
        from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
        where (snapshot_line.value->>'shiftId')::uuid = eligible_shift.id
          and (snapshot_line.value->>'startingCashMillimes')::bigint
            = eligible_shift.starting_cash_millimes
          and (snapshot_line.value->>'forceClosedByOwner')::boolean
            = eligible_shift.force_closed_by_owner
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    where not exists (
      select 1
      from public.shifts eligible_shift
      where (snapshot_line.value->>'shiftId')::uuid = eligible_shift.id
        and eligible_shift.store_id = target_store.store_id
        and eligible_shift.opened_at >= period_from
        and eligible_shift.opened_at <= period_to
        and eligible_shift.starting_cash_millimes
          = (snapshot_line.value->>'startingCashMillimes')::bigint
        and eligible_shift.force_closed_by_owner
          = (snapshot_line.value->>'forceClosedByOwner')::boolean
        and not exists (
          select 1
          from public.z_reported_shifts reported
          where reported.store_id = eligible_shift.store_id
            and reported.shift_id = eligible_shift.id
        )
    )
  ) then
    raise exception 'Report shift lines contain values that do not match persisted shifts.';
  end if;

  if exists (
    select 1
    from public.orders order_record
    where order_record.store_id = target_store.store_id
      and order_record.status = 'pending_void'
  ) then
    raise exception 'Resolve every void request before creating a Z report.';
  end if;

  if exists (
    select 1
    from public.shifts shift
    where shift.store_id = target_store.store_id
      and shift.status = 'open'
  ) then
    raise exception 'Force-close or close every shift before creating a Z report.';
  end if;
  if nullif(p_pin, '') is null
    or not public.verify_store_pin(target_store.store_id, p_pin, 'z_report') then
    raise exception 'Incorrect owner PIN.';
  end if;

  ledger := public.get_reversal_ledger(target_store.store_id, period_from, period_to);
  unresolved_count := jsonb_array_length(ledger->'unresolvedTabReversals');
  if unresolved_count > 0 then
    raise exception
      'Z reconciliation unresolved: %',
      ledger->>'unresolvedTabReversals';
  end if;

  server_summary := public.get_dashboard_summary(
    target_store.store_id,
    period_from,
    period_to,
    true
  );

  select count(*)::integer,
         coalesce(sum(order_record.total_millimes) filter (
           where order_record.status = 'done'
         ), 0)::bigint,
         jsonb_build_object(
           'cash', coalesce(sum(order_record.total_millimes) filter (
             where order_record.status = 'done' and order_record.payment_method = 'cash'
           ), 0),
           'card', coalesce(sum(order_record.total_millimes) filter (
             where order_record.status = 'done' and order_record.payment_method = 'card'
           ), 0),
           'other', coalesce(sum(order_record.total_millimes) filter (
             where order_record.status = 'done' and order_record.payment_method = 'other'
           ), 0),
           'tab', coalesce(sum(order_record.total_millimes) filter (
             where order_record.status = 'done' and order_record.payment_method = 'tab'
           ), 0)
         )
  into server_order_count, server_sales, server_payment_split
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.created_at between period_from and period_to;

  server_cash_tab := (ledger->>'cashVerifiedNetMillimes')::bigint;
  server_card_tab := (ledger->>'cardVerifiedNetMillimes')::bigint;
  server_other_tab := (ledger->>'otherVerifiedNetMillimes')::bigint;
  server_cash_refunds := (ledger->>'cashPostCloseReversalMillimes')::bigint;

  select coalesce(sum(public.get_shift_expected_cash(shift.id)), 0)::bigint,
         coalesce(sum(shift.starting_cash_millimes), 0)::bigint,
         coalesce(sum(
           shift.counted_cash_millimes
         ) filter (where shift.status = 'closed'), 0)::bigint,
         coalesce(sum(
           shift.difference_millimes
         ) filter (where shift.status = 'closed'), 0)::bigint
  into server_expected_cash, server_cash_float,
       server_total_counted, server_total_difference
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.status = 'closed'
    and shift.opened_at <= period_to
    and shift.closed_at between period_from and period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  server_expected_cash := coalesce(server_expected_cash, 0);
  expected_cash_ex_float := server_expected_cash - server_cash_float;

  expected_card := (server_payment_split->>'card')::bigint + server_card_tab;
  expected_other := (server_payment_split->>'other')::bigint + server_other_tab;

  counted_cash := nullif(p_report->>'countedCashMillimes', 'null')::bigint;
  counted_card := nullif(p_report->>'countedCardMillimes', 'null')::bigint;
  counted_other := nullif(p_report->>'countedOtherMillimes', 'null')::bigint;
  cash_difference := counted_cash - expected_cash_ex_float;
  card_difference := counted_card - expected_card;
  other_difference := counted_other - expected_other;

  if counted_cash is null or counted_cash < 0
    or counted_card is null or counted_card < 0
    or counted_other is null or counted_other < 0
    or p_report->>'countedCashIncludesFloat' is distinct from 'false'
    or nullif(p_report->>'cashDifferenceMillimes', '')::bigint is distinct from cash_difference
    or nullif(p_report->>'expectedCardMillimes', 'null')::bigint is distinct from expected_card
    or nullif(p_report->>'expectedOtherMillimes', 'null')::bigint is distinct from expected_other
    or ((cash_difference <> 0 or card_difference <> 0 or other_difference <> 0)
      and nullif(btrim(p_report->>'cashDifferenceNote'), '') is null) then
    raise exception 'Z counts are incomplete, require a note, or do not reconcile with the server ledger.';
  end if;

  business_day := public.get_current_business_date(target_store.store_id);
  select coalesce(max(report.z_number), 0) + 1
  into assigned_z_number
  from public.reports report
  where report.store_id = target_store.store_id and report.type = 'Z';

  report_data := p_report;
  report_data := report_data || server_summary;
  report_data := jsonb_set(report_data, '{zNumber}', to_jsonb(assigned_z_number), true);
  report_data := jsonb_set(report_data, '{reportNumber}',
    to_jsonb('Z-' || pg_catalog.lpad(assigned_z_number::text, 6, '0')), true);
  report_data := jsonb_set(report_data, '{salesMillimes}', to_jsonb(server_sales), true);
  report_data := jsonb_set(report_data, '{salesCollectedMillimes}', to_jsonb(
    (server_payment_split->>'cash')::bigint
    + (server_payment_split->>'card')::bigint
    + (server_payment_split->>'other')::bigint
    + server_cash_tab + server_card_tab + server_other_tab
  ), true);
  report_data := jsonb_set(report_data, '{totalExpectedCashMillimes}', to_jsonb(server_expected_cash), true);
  report_data := jsonb_set(report_data, '{cashFloatMillimes}', to_jsonb(server_cash_float), true);
  report_data := jsonb_set(report_data, '{expectedCashExFloatMillimes}', to_jsonb(expected_cash_ex_float), true);
  report_data := jsonb_set(report_data, '{totalCountedMillimes}', to_jsonb(server_total_counted), true);
  report_data := jsonb_set(report_data, '{totalDifferenceMillimes}', to_jsonb(server_total_difference), true);
  report_data := jsonb_set(report_data, '{cashDifferenceMillimes}', to_jsonb(cash_difference), true);
  report_data := jsonb_set(report_data, '{countedCashIncludesFloat}', 'false'::jsonb, true);
  report_data := jsonb_set(report_data, '{expectedCardMillimes}', to_jsonb(expected_card), true);
  report_data := jsonb_set(report_data, '{cardDifferenceMillimes}', to_jsonb(card_difference), true);
  report_data := jsonb_set(report_data, '{expectedOtherMillimes}', to_jsonb(expected_other), true);
  report_data := jsonb_set(report_data, '{otherDifferenceMillimes}', to_jsonb(other_difference), true);
  report_data := jsonb_set(report_data, '{cashRefundsMillimes}', to_jsonb(server_cash_refunds), true);
  report_data := jsonb_set(report_data, '{tabsSettledMillimes}', to_jsonb(server_cash_tab), true);
  report_data := jsonb_set(report_data, '{tabPaymentsReceivedMillimes}', to_jsonb(server_cash_tab), true);
  report_data := jsonb_set(report_data, '{cardTabPaymentsMillimes}', to_jsonb(server_card_tab), true);
  report_data := jsonb_set(report_data, '{otherTabPaymentsMillimes}', to_jsonb(server_other_tab), true);
  report_data := jsonb_set(report_data, '{nonCashTabPaymentsMillimes}',
    to_jsonb(server_card_tab + server_other_tab), true);
  report_data := jsonb_set(report_data, '{unresolvedTabReversals}',
    ledger->'unresolvedTabReversals', true);

  insert into public.reports (
    store_id, type, business_date, created_at, sales_millimes, sales_collected_millimes,
    expenses_millimes, net_profit_millimes, receivable_millimes, order_count,
    cash_difference_millimes, z_number, period_from, period_to, generated_by, data
  ) values (
    target_store.store_id, 'Z', business_day, now(), server_sales,
    (server_payment_split->>'cash')::bigint
      + (server_payment_split->>'card')::bigint
      + (server_payment_split->>'other')::bigint
      + server_cash_tab + server_card_tab + server_other_tab,
    coalesce((report_data->>'expensesMillimes')::bigint, 0),
    (server_payment_split->>'cash')::bigint
      + (server_payment_split->>'card')::bigint
      + (server_payment_split->>'other')::bigint
      + server_cash_tab + server_card_tab + server_other_tab
      - coalesce((report_data->>'expensesMillimes')::bigint, 0),
    coalesce((report_data->>'receivableMillimes')::bigint, 0),
    server_order_count, cash_difference, assigned_z_number,
    period_from, period_to, actor.id, report_data
  ) returning * into result;

  insert into public.z_reported_shifts (store_id, shift_id, report_id, reported_at)
  select target_store.store_id, shift.id, result.id, result.created_at
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );

  update public.stores
  set day_closed_on = business_day
  where store_id = target_store.store_id;

  return result;
end
$$;

revoke all on function public.record_report(jsonb,text) from public, anon;
grant execute on function public.record_report(jsonb,text) to authenticated;
revoke all on function public.record_report_legacy(jsonb,text) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.force_close_day(text)') is not null
    and to_regprocedure('public.force_close_day_legacy(text)') is null then
    execute 'alter function public.force_close_day(text) rename to force_close_day_legacy';
  end if;
end
$$;

create or replace function public.force_close_day(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_store public.stores%rowtype;
  locked_shift public.shifts%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active;
  if actor.id is null or actor.role <> 'owner' then
    raise exception 'Only this store owner can force-close the business day.' using errcode = '42501';
  end if;
  select * into target_store
  from public.stores
  where store_id = actor.store_id
  for update;
  if not found then
    raise exception 'The original store could not be found.';
  end if;

  for locked_shift in
    select shift.*
    from public.shifts shift
    where shift.store_id = target_store.store_id
      and shift.status = 'open'
    order by shift.id
    for update
  loop
    null;
  end loop;

  return public.force_close_day_legacy(p_pin);
end
$$;

revoke all on function public.force_close_day(text) from public, anon;
grant execute on function public.force_close_day(text) to authenticated;
revoke all on function public.force_close_day_legacy(text) from public, anon, authenticated;

create or replace function public.reject_ambiguous_z_reversals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unresolved_count integer;
begin
  if new.type = 'Z' then
    select count(*)::integer
    into unresolved_count
    from public.tabs reversal
    where reversal.store_id = new.store_id
      and reversal.kind = 'reversal'
      and public.get_tab_reversal_status(reversal.id, reversal.shift_id) = 'ambiguous'
      and reversal.created_at between new.period_from and new.period_to;
    if unresolved_count > 0 then
      raise exception 'Resolve every ambiguous tab reversal before creating a Z report.';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.reject_ambiguous_z_reversals() from public, anon, authenticated;

update public.app_schema_version
set version = 20261122131000,
    updated_at = now()
where singleton;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
  ) then
    execute 'grant execute on function public.reverse_tab_payment(uuid,text,text) to service_role';
    execute 'grant execute on function public.get_tab_reversal_status(uuid,uuid) to service_role';
    execute 'grant execute on function public.get_reversal_ledger(uuid,timestamptz,timestamptz) to service_role';
    execute 'grant execute on function public.get_shift_expected_cash(uuid) to service_role';
    execute 'grant execute on function public.get_shift_summary(uuid) to service_role';
    execute 'grant execute on function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) to service_role';
    execute 'grant execute on function public.get_customer_balance(uuid) to service_role';
    execute 'grant execute on function public.get_customer_balance_reconciliation(uuid) to service_role';
    execute 'grant execute on function public.record_report(jsonb,text) to service_role';
  end if;
end
$$;

notify pgrst, 'reload schema';
