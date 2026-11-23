create table public.order_idempotency_keys (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now()
);

revoke all on table public.order_idempotency_keys from public, anon, authenticated;

create or replace function public.create_order_idempotent(
  p_idempotency_key uuid,
  p_shift_id uuid,
  p_items jsonb,
  p_payment_method text default 'cash',
  p_customer_id uuid default null,
  p_location text default null,
  p_note text default null,
  p_admin_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  recorded_actor_id uuid;
  recorded_response jsonb;
  inserted_rows integer;
begin
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required.';
  end if;
  if current_actor_id is null or not exists (
    select 1 from public.profiles
    where id = current_actor_id and is_active
  ) then
    raise exception 'Not authorized to create orders.' using errcode = '42501';
  end if;

  insert into public.order_idempotency_keys (idempotency_key, actor_id)
  values (p_idempotency_key, current_actor_id)
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    select actor_id, response
    into recorded_actor_id, recorded_response
    from public.order_idempotency_keys
    where idempotency_key = p_idempotency_key;
    if recorded_actor_id <> current_actor_id then
      raise exception 'This idempotency key belongs to another account.' using errcode = '42501';
    end if;
    if recorded_response is null then
      raise exception 'The original order request is still being processed.';
    end if;
    return recorded_response;
  end if;

  recorded_response := public.create_order(
    p_shift_id,
    p_items,
    p_payment_method,
    p_customer_id,
    p_location,
    p_note,
    p_admin_pin
  );
  update public.order_idempotency_keys
  set response = recorded_response
  where idempotency_key = p_idempotency_key;
  return recorded_response;
end
$$;

revoke all on function public.create_order_idempotent(uuid, uuid, jsonb, text, uuid, text, text, text) from public, anon;
grant execute on function public.create_order_idempotent(uuid, uuid, jsonb, text, uuid, text, text, text) to authenticated;
