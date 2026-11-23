alter function public.close_shift(uuid,bigint,text)
  rename to close_shift_blind_legacy;

create or replace function public.close_shift(
  p_shift_id uuid,
  p_counted_cash_millimes bigint,
  p_difference_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  target public.shifts%rowtype;
  blind boolean;
begin
  payload := public.close_shift_blind_legacy(
    p_shift_id,
    p_counted_cash_millimes,
    p_difference_note
  );
  select shift.* into target
  from public.shifts shift
  where shift.id = p_shift_id;

  select coalesce((setting.settings->>'blindShiftClosing')::boolean, false)
  into blind
  from public.store_settings setting
  where setting.store_id = target.store_id;

  if blind
    and (select auth.uid()) = target.staff_id
    and not public.is_store_owner(target.store_id) then
    payload := jsonb_set(payload, '{shift,expected_cash_millimes}', 'null'::jsonb, true);
    payload := jsonb_set(payload, '{shift,difference_millimes}', 'null'::jsonb, true);
    payload := jsonb_set(payload, '{shift,difference_note}', 'null'::jsonb, true);
  end if;
  return payload;
end
$$;

revoke all on function public.close_shift(uuid,bigint,text) from public, anon;
grant execute on function public.close_shift(uuid,bigint,text) to authenticated;

alter function public.get_shift_summary(uuid)
  rename to get_shift_summary_blind_legacy;

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
  blind boolean;
begin
  result := public.get_shift_summary_blind_legacy(p_shift_id);
  select shift.* into target
  from public.shifts shift
  where shift.id = p_shift_id;

  select coalesce((setting.settings->>'blindShiftClosing')::boolean, false)
  into blind
  from public.store_settings setting
  where setting.store_id = target.store_id;

  if blind
    and (select auth.uid()) = target.staff_id
    and not public.is_store_owner(target.store_id) then
    result := result - 'expectedCashMillimes';
    result := result - 'cashFlowExFloatMillimes';
    result := result - 'countedCashMillimes';
    result := result - 'differenceMillimes';
  end if;
  return result;
end
$$;

revoke all on function public.get_shift_summary(uuid) from public, anon;
grant execute on function public.get_shift_summary(uuid) to authenticated;

create table if not exists public.tab_settlement_idempotency_keys (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now()
);

revoke all on table public.tab_settlement_idempotency_keys from public, anon, authenticated;

alter function public.settle_customer_tab(uuid,bigint,uuid,text,text)
  rename to settle_customer_tab_legacy;

create or replace function public.settle_customer_tab(
  p_customer_id uuid,
  p_amount_millimes bigint,
  p_shift_id uuid,
  p_payment_method text default 'cash',
  p_note text default null,
  p_idempotency_key uuid default null
)
returns public.tabs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  recorded_actor uuid;
  recorded_response jsonb;
  inserted_rows integer;
  result public.tabs%rowtype;
begin
  if p_idempotency_key is null then
    return public.settle_customer_tab_legacy(
      p_customer_id,
      p_amount_millimes,
      p_shift_id,
      p_payment_method,
      p_note
    );
  end if;

  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  insert into public.tab_settlement_idempotency_keys (idempotency_key, actor_id)
  values (p_idempotency_key, actor_id)
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    select key.actor_id, key.response
    into recorded_actor, recorded_response
    from public.tab_settlement_idempotency_keys key
    where key.idempotency_key = p_idempotency_key;
    if recorded_actor is distinct from actor_id then
      raise exception 'This settlement idempotency key belongs to another account.' using errcode = '42501';
    end if;
    if recorded_response is null then
      raise exception 'The original tab payment request is still being processed.';
    end if;
    return jsonb_populate_record(null::public.tabs, recorded_response);
  end if;

  result := public.settle_customer_tab_legacy(
    p_customer_id,
    p_amount_millimes,
    p_shift_id,
    p_payment_method,
    p_note
  );
  update public.tab_settlement_idempotency_keys
  set response = to_jsonb(result)
  where idempotency_key = p_idempotency_key;
  return result;
end
$$;

revoke all on function public.settle_customer_tab(uuid,bigint,uuid,text,text,uuid) from public, anon;
grant execute on function public.settle_customer_tab(uuid,bigint,uuid,text,text,uuid) to authenticated;
