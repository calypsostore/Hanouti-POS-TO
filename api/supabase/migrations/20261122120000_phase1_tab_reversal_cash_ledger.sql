create table public.shift_reversal_snapshots (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  reversal_id uuid not null references public.tabs(id) on delete restrict,
  reversal_amount_millimes bigint not null check (reversal_amount_millimes > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'other')),
  captured_at timestamptz not null,
  primary key (store_id, shift_id, reversal_id),
  unique (reversal_id)
);

alter table public.shift_reversal_snapshots enable row level security;
revoke all on public.shift_reversal_snapshots from public, anon, authenticated;

create index shift_reversal_snapshots_reversal_id_idx
  on public.shift_reversal_snapshots (reversal_id);

comment on table public.shift_reversal_snapshots is
  'Persisted per-reversal close inclusion. No historical timestamp-only backfill is performed: historical closed shifts without an explicit snapshot retain their stored values and ambiguous reversals are not inferred.';

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
      and reversal.created_at <= new.closed_at
    on conflict do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.capture_shift_reversal_snapshot() from public, anon, authenticated;

drop trigger if exists capture_shift_reversal_snapshot_trigger on public.shifts;
create trigger capture_shift_reversal_snapshot_trigger
after update of status, closed_at on public.shifts
for each row
execute function public.capture_shift_reversal_snapshot();

create or replace function public.is_tab_reversal_included_in_shift_close(
  p_reversal_id uuid,
  p_reversal_shift_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.shift_reversal_snapshots snapshot
      where snapshot.reversal_id = p_reversal_id
        and snapshot.shift_id = p_reversal_shift_id
    )
    or false;
$$;

revoke all on function public.is_tab_reversal_included_in_shift_close(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_tab_reversal_included_in_shift_close(uuid, uuid) to authenticated;

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
        join public.tabs original
          on original.id = reversal.reverses_tab_id
         and original.kind = 'settled'
        join public.shifts reversal_shift
          on reversal_shift.id = p_reversal_shift_id
         and reversal_shift.store_id = reversal.store_id
        where reversal.id = p_reversal_id
          and reversal.kind = 'reversal'
          and reversal_shift.status = 'closed'
          and reversal_shift.closed_at is not null
          and (
            reversal.shift_id <> original.shift_id
            or (
              reversal.shift_id = original.shift_id
              and original.created_at <= reversal_shift.closed_at
              and reversal.created_at > reversal_shift.closed_at
            )
              or (
                reversal.shift_id = original.shift_id
                and original.created_at > reversal_shift.closed_at
                and reversal.created_at > original.created_at
              )
          )
      ) then 'proven_post_close'
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
  select * into target from public.shifts shift where shift.id = p_shift_id;
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
        when tab.kind = 'reversal' then -tab.amount_millimes
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
  target_shift public.shifts%rowtype;
  result public.tabs%rowtype;
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
  ) then
    raise exception 'This payment has already been reversed.';
  end if;
  if not public.verify_store_pin(payment.store_id, p_pin, 'credit_override') then
    raise exception 'Incorrect Admin PIN.';
  end if;

  select * into target_shift
  from public.shifts
  where store_id = payment.store_id
    and staff_id = auth.uid()
    and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  insert into public.tabs (
    store_id,
    customer_id,
    shift_id,
    staff_id,
    kind,
    amount_millimes,
    note,
    reverses_tab_id,
    payment_method
  ) values (
    payment.store_id,
    payment.customer_id,
    coalesce(target_shift.id, payment.shift_id),
    auth.uid(),
    'reversal',
    payment.amount_millimes,
    btrim(p_reason),
    payment.id,
    payment.payment_method
  ) returning * into result;

  return result;
end
$$;

revoke all on function public.reverse_tab_payment(uuid, text, text) from public, anon;
grant execute on function public.reverse_tab_payment(uuid, text, text) to authenticated;

alter function public.get_shift_summary(uuid)
  rename to get_shift_summary_legacy;

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
  tab_payments bigint;
  card_tab_payments bigint;
  other_tab_payments bigint;
  expected_cash bigint;
  cash_adjustments bigint;
begin
  result := public.get_shift_summary_legacy(p_shift_id);
  select * into target from public.shifts where id = p_shift_id;

  if target.status = 'open' then
    select coalesce(sum(case
      when tab.kind = 'settled' then tab.amount_millimes
      when tab.kind = 'reversal' then -tab.amount_millimes
      else 0
    end), 0)::bigint
    into tab_payments
    from public.tabs tab
    where tab.shift_id = p_shift_id
      and tab.payment_method = 'cash'
      and tab.kind in ('settled', 'reversal');
    select
      coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'card'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal' and tab.payment_method = 'card'
      ), 0),
      coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'other'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal' and tab.payment_method = 'other'
      ), 0)
    into card_tab_payments, other_tab_payments
    from public.tabs tab
    where tab.shift_id = p_shift_id
      and tab.kind in ('settled', 'reversal');

    select coalesce(sum(adjustment.amount_millimes), 0)::bigint
    into cash_adjustments
    from public.shift_void_adjustments adjustment
    join public.orders order_record
      on order_record.id = adjustment.order_id
     and order_record.shift_id = adjustment.shift_id
     and order_record.store_id = adjustment.store_id
    where adjustment.shift_id = p_shift_id
      and order_record.payment_method = 'cash';

    expected_cash := target.starting_cash_millimes
      + coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.shift_id = p_shift_id
          and order_record.status = 'done'
          and order_record.payment_method = 'cash'
      ), 0)
      + tab_payments
      + coalesce((
        select sum(case
          when movement.kind = 'in' then movement.amount_millimes
          else -movement.amount_millimes
        end)
        from public.cash_movements movement
        where movement.shift_id = p_shift_id
      ), 0)
      + cash_adjustments;

    result := jsonb_set(result, '{expectedCashMillimes}', to_jsonb(expected_cash), true);
    result := jsonb_set(
      result,
      '{cashFlowExFloatMillimes}',
      to_jsonb(expected_cash - target.starting_cash_millimes),
      true
    );
    result := jsonb_set(
      result,
      '{tabPaymentsMillimes}',
      to_jsonb(tab_payments),
      true
    );
    result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(card_tab_payments), true);
    result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(other_tab_payments), true);
  elsif target.status = 'closed' then
    result := jsonb_set(
      result,
      '{tabPaymentsMillimes}',
      to_jsonb(coalesce((
        select sum(case
          when tab.kind = 'settled' then tab.amount_millimes
          when tab.kind = 'reversal'
            and public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
            then -tab.amount_millimes
          else 0
        end)
        from public.tabs tab
        where tab.shift_id = p_shift_id
          and tab.payment_method = 'cash'
          and tab.kind in ('settled', 'reversal')
      ), 0)),
      true
    );
    select
      coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'card'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'card'
          and public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
      ), 0),
      coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'settled' and tab.payment_method = 'other'
      ), 0) - coalesce(sum(tab.amount_millimes) filter (
        where tab.kind = 'reversal'
          and tab.payment_method = 'other'
          and public.is_tab_reversal_included_in_shift_close(tab.id, tab.shift_id)
      ), 0)
    into card_tab_payments, other_tab_payments
    from public.tabs tab
    where tab.shift_id = p_shift_id
      and tab.kind in ('settled', 'reversal');
    result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(card_tab_payments), true);
    result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(other_tab_payments), true);
  end if;

  return result;
end
$$;

revoke all on function public.get_shift_summary(uuid) from public, anon;
grant execute on function public.get_shift_summary(uuid) to authenticated;
revoke all on function public.get_shift_summary_legacy(uuid) from public, anon, authenticated;

alter function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean)
  rename to get_dashboard_summary_legacy;

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
  legacy_total_expected bigint;
  legacy_cash_refunds bigint;
  legacy_shift_total bigint;
  historical_adjustments bigint;
  reconstructed_expected bigint;
  cash_float bigint;
  total_counted bigint;
  total_difference bigint;
  cash_sales bigint;
  cash_refunds bigint;
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
  legacy_total_expected := coalesce((result->>'totalExpectedCashMillimes')::bigint, 0);
  legacy_cash_refunds := coalesce((result->>'cashRefundsMillimes')::bigint, 0);
  select coalesce(sum((entry->>'expectedCashMillimes')::bigint), 0)::bigint
  into legacy_shift_total
  from jsonb_array_elements(
    case
      when jsonb_typeof(result->'shiftLines') = 'array'
        then result->'shiftLines'
      else '[]'::jsonb
    end
  ) entry;

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
      where tab.kind = 'reversal' and tab.payment_method = 'cash'
      and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'card'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'reversal' and tab.payment_method = 'card'
      and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'settled' and tab.payment_method = 'other'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.kind = 'reversal' and tab.payment_method = 'other'
      and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
    ), 0)
  into cash_tab_net, card_tab_net, other_tab_net
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between p_from and p_to;

  result := jsonb_set(result, '{cashRefundsMillimes}', to_jsonb(cash_refunds), true);
  result := jsonb_set(result, '{tabsSettledMillimes}', to_jsonb(cash_tab_net), true);
  result := jsonb_set(result, '{tabPaymentsReceivedMillimes}', to_jsonb(cash_tab_net), true);
  result := jsonb_set(result, '{cardTabPaymentsMillimes}', to_jsonb(card_tab_net), true);
  result := jsonb_set(result, '{otherTabPaymentsMillimes}', to_jsonb(other_tab_net), true);
  result := jsonb_set(result, '{nonCashTabPaymentsMillimes}', to_jsonb(card_tab_net + other_tab_net), true);

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

  historical_adjustments := legacy_total_expected - legacy_shift_total + legacy_cash_refunds;
  reconstructed_expected := reconstructed_expected - cash_refunds + historical_adjustments;

  result := jsonb_set(result, '{totalExpectedCashMillimes}', to_jsonb(reconstructed_expected), true);
  result := jsonb_set(result, '{expectedCashExFloatMillimes}', to_jsonb(reconstructed_expected - cash_float), true);
  result := jsonb_set(result, '{cashFloatMillimes}', to_jsonb(cash_float), true);
  result := jsonb_set(result, '{totalCountedMillimes}', to_jsonb(total_counted), true);
  result := jsonb_set(result, '{totalDifferenceMillimes}', to_jsonb(total_difference), true);
  result := jsonb_set(result, '{cashSalesMillimes}', to_jsonb(cash_sales), true);
  result := jsonb_set(
    result,
    '{cashDifferenceMillimes}',
    to_jsonb(total_difference),
    true
  );

  result := jsonb_set(
    result,
    '{ambiguousTabReversalIds}',
    coalesce((
      select jsonb_agg(to_jsonb(tab.id))
      from public.tabs tab
      where tab.store_id = p_store_id
        and tab.kind = 'reversal'
        and tab.created_at between p_from and p_to
        and public.get_tab_reversal_status(tab.id, tab.shift_id) = 'ambiguous'
    ), '[]'::jsonb),
    true
  );

  return result;
end
$$;

revoke all on function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) from public, anon;
grant execute on function public.get_dashboard_summary(uuid,timestamptz,timestamptz,boolean) to authenticated;
revoke all on function public.get_dashboard_summary_legacy(uuid,timestamptz,timestamptz,boolean) from public, anon, authenticated;

update public.app_schema_version
set version = 20261122120000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
