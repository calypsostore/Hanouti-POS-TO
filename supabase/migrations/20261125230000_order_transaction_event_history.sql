alter table public.orders
  add column void_request_id uuid;

create table public.order_transaction_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  event_type text not null check (
    event_type in ('sale_created', 'void_requested', 'void_approved', 'void_rejected')
  ),
  operation_id uuid not null,
  original_sale_event_id uuid,
  actor_id uuid not null,
  actor_name text not null,
  actor_role text not null,
  occurred_at timestamptz not null default now(),
  reason text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  constraint order_transaction_events_sale_operation_check
    check (event_type <> 'sale_created' or operation_id = order_id),
  constraint order_transaction_events_original_sale_check
    check (
      (event_type = 'sale_created' and original_sale_event_id is null)
      or event_type <> 'sale_created'
    ),
  constraint order_transaction_events_order_operation_key
    unique (order_id, event_type, operation_id),
  constraint order_transaction_events_id_order_store_key
    unique (id, order_id, store_id),
  constraint order_transaction_events_order_store_fkey
    foreign key (store_id, order_id)
    references public.orders(store_id, id)
    on delete restrict,
  constraint order_transaction_events_original_sale_fkey
    foreign key (original_sale_event_id, order_id, store_id)
    references public.order_transaction_events(id, order_id, store_id)
    on delete restrict
);

create index order_transaction_events_store_order_time_idx
  on public.order_transaction_events (store_id, order_id, occurred_at, id);

alter table public.order_transaction_events enable row level security;

create policy order_transaction_events_read
  on public.order_transaction_events
  for select
  to authenticated
  using (
    store_id = (select public.current_store_id())
    and public.can_read_order(order_id)
  );

revoke all on table public.order_transaction_events from public, anon, authenticated;
grant select on table public.order_transaction_events to authenticated;

create function public.validate_order_transaction_event_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type <> 'sale_created'
    and new.original_sale_event_id is not null
    and not exists (
      select 1
      from public.order_transaction_events sale_event
      where sale_event.id = new.original_sale_event_id
        and sale_event.order_id = new.order_id
        and sale_event.store_id = new.store_id
        and sale_event.event_type = 'sale_created'
    ) then
    raise exception 'Transaction lifecycle events must reference their original sale event.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger order_transaction_events_validate_reference
  before insert on public.order_transaction_events
  for each row execute function public.validate_order_transaction_event_reference();

create function public.reject_order_transaction_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Order transaction events are append-only.'
    using errcode = '55000';
end
$$;

create trigger order_transaction_events_no_row_mutation
  before update or delete on public.order_transaction_events
  for each row execute function public.reject_order_transaction_event_mutation();

create trigger order_transaction_events_no_truncate
  before truncate on public.order_transaction_events
  for each statement execute function public.reject_order_transaction_event_mutation();

create function public.set_order_void_request_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status = 'pending_void' then
    new.void_request_id := pg_catalog.gen_random_uuid();
  elsif new.status is distinct from old.status
    and new.status = 'voided'
    and old.status = 'done' then
    new.void_request_id := pg_catalog.gen_random_uuid();
  elsif new.status is distinct from old.status
    and old.status = 'pending_void'
    and new.status in ('done', 'voided') then
    new.void_request_id := coalesce(old.void_request_id, pg_catalog.gen_random_uuid());
  end if;
  return new;
end
$$;

create trigger orders_assign_void_request_id
  before update of status on public.orders
  for each row execute function public.set_order_void_request_id();

create function public.order_transaction_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', order_record.id,
    'storeId', order_record.store_id,
    'number', order_record.number,
    'businessDate', order_record.business_date,
    'staffId', order_record.staff_id,
    'shiftId', order_record.shift_id,
    'location', order_record.location,
    'status', order_record.status,
    'paymentMethod', order_record.payment_method,
    'customerId', order_record.customer_id,
    'note', order_record.note,
    'totalMillimes', order_record.total_millimes,
    'createdAt', order_record.created_at,
    'fiscalSnapshot', order_record.fiscal_snapshot,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', line.id,
          'itemId', line.item_id,
          'categoryId', line.category_id,
          'categoryName', line.category_name,
          'name', line.name,
          'quantity', line.quantity,
          'unitPriceMillimes', line.unit_price_millimes,
          'lineTotalMillimes', line.line_total_millimes,
          'modifiers', line.modifiers
        )
        order by line.id
      )
      from public.order_lines line
      where line.order_id = order_record.id
        and line.store_id = order_record.store_id
    ), '[]'::jsonb)
  )
  from public.orders order_record
  where order_record.id = p_order_id
$$;

create or replace function public.capture_order_transaction_sale_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_order record;
  event_actor_id uuid;
  event_actor_name text;
  event_actor_role text;
begin
  for inserted_order in
    select distinct inserted_lines.store_id, inserted_lines.order_id
    from inserted_order_lines inserted_lines
    join public.orders order_record
      on order_record.id = inserted_lines.order_id
      and order_record.store_id = inserted_lines.store_id
  loop
    select profile.id, profile.name, profile.role
    into event_actor_id, event_actor_name, event_actor_role
    from public.orders order_record
    join public.profiles profile
      on profile.id = order_record.staff_id
      and profile.store_id = order_record.store_id
    where order_record.id = inserted_order.order_id
      and order_record.store_id = inserted_order.store_id;

    insert into public.order_transaction_events (
      store_id, order_id, event_type, operation_id, original_sale_event_id,
      actor_id, actor_name, actor_role, occurred_at, payload
    )
    select order_record.store_id, order_record.id, 'sale_created', order_record.id,
      null, event_actor_id, event_actor_name, event_actor_role, order_record.created_at,
      jsonb_build_object('order', public.order_transaction_snapshot(order_record.id))
    from public.orders order_record
    where order_record.id = inserted_order.order_id
      and order_record.store_id = inserted_order.store_id
    on conflict on constraint order_transaction_events_order_operation_key do nothing;
  end loop;

  return null;
end
$$;

create or replace function public.capture_order_transaction_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_id uuid;
  event_type text;
  event_actor_id uuid;
  event_actor_name text;
  event_actor_role text;
  event_reason text;
  event_time timestamptz;
  transition_payload jsonb;
  sale_event_id uuid;
begin
  if tg_op <> 'UPDATE' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pending_void' then
    event_type := 'void_requested';
    operation_id := new.void_request_id;
    event_reason := new.void_reason;
    event_time := coalesce(new.void_requested_at, clock_timestamp());
    transition_payload := jsonb_build_object(
      'fromStatus', old.status,
      'toStatus', new.status,
      'requestedAt', event_time
    );
  elsif new.status = 'voided' then
    event_type := 'void_approved';
    operation_id := new.void_request_id;
    event_reason := new.void_reason;
    event_time := coalesce(new.voided_at, clock_timestamp());
    transition_payload := jsonb_build_object(
      'fromStatus', old.status,
      'toStatus', new.status,
      'requestedAt', old.void_requested_at,
      'resolvedAt', event_time,
      'authorizationMethod', new.voided_by
    );
  else
    return new;
  end if;

  event_actor_id := coalesce((select auth.uid()), new.voided_by_user_id);
  select profile.name, profile.role
  into event_actor_name, event_actor_role
  from public.profiles profile
  where profile.id = event_actor_id
    and profile.store_id = new.store_id;

  select sale_event.id
  into sale_event_id
  from public.order_transaction_events sale_event
  where sale_event.order_id = new.id
    and sale_event.store_id = new.store_id
    and sale_event.event_type = 'sale_created';

  insert into public.order_transaction_events (
    store_id, order_id, event_type, operation_id, original_sale_event_id,
    actor_id, actor_name, actor_role, occurred_at, reason, payload
  ) values (
    new.store_id, new.id, event_type, operation_id, sale_event_id,
    event_actor_id, event_actor_name, event_actor_role, event_time, event_reason,
    jsonb_build_object(
      'originalSaleEventId', sale_event_id,
      'order', public.order_transaction_snapshot(new.id),
      'transition', transition_payload
    )
  )
  on conflict on constraint order_transaction_events_order_operation_key do nothing;

  return new;
end
$$;

create trigger order_lines_capture_sale_events
  after insert on public.order_lines
  referencing new table as inserted_order_lines
  for each statement execute function public.capture_order_transaction_sale_events();

create trigger orders_capture_void_events
  after update of status on public.orders
  for each row execute function public.capture_order_transaction_event();

create or replace function public.capture_rejected_void_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  event_reason text;
  requested_at timestamptz;
  resolved_at timestamptz;
  sale_event_id uuid;
begin
  if new.action <> 'order.void_rejected'
    or new.entity_type <> 'order'
    or new.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  select * into target
  from public.orders
  where id = new.entity_id::uuid
    and store_id = new.store_id;
  if not found or target.status <> 'done' or target.void_request_id is null then
    return new;
  end if;

  event_reason := nullif(new.meta->>'resolutionReason', '');
  requested_at := nullif(new.meta->>'requestedAt', '')::timestamptz;
  resolved_at := coalesce(
    nullif(new.meta->>'resolvedAt', '')::timestamptz,
    new.created_at
  );

  select sale_event.id
  into sale_event_id
  from public.order_transaction_events sale_event
  where sale_event.order_id = target.id
    and sale_event.store_id = target.store_id
    and sale_event.event_type = 'sale_created';

  insert into public.order_transaction_events (
    store_id, order_id, event_type, operation_id, original_sale_event_id,
    actor_id, actor_name, actor_role, occurred_at, reason, payload
  ) values (
    target.store_id, target.id, 'void_rejected', target.void_request_id, sale_event_id,
    new.actor_id, new.actor_name, new.actor_role, resolved_at, event_reason,
    jsonb_build_object(
      'originalSaleEventId', sale_event_id,
      'order', public.order_transaction_snapshot(target.id),
      'transition', jsonb_build_object(
        'fromStatus', 'pending_void',
        'toStatus', 'done',
        'requestedAt', requested_at,
        'resolvedAt', resolved_at
      )
    )
  )
  on conflict on constraint order_transaction_events_order_operation_key do nothing;

  return new;
end
$$;

create trigger activity_logs_capture_rejected_void
  after insert on public.activity_logs
  for each row execute function public.capture_rejected_void_event();

revoke all on function public.reject_order_transaction_event_mutation() from public, anon, authenticated;
revoke all on function public.validate_order_transaction_event_reference() from public, anon, authenticated;
revoke all on function public.set_order_void_request_id() from public, anon, authenticated;
revoke all on function public.order_transaction_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.capture_order_transaction_sale_events() from public, anon, authenticated;
revoke all on function public.capture_order_transaction_event() from public, anon, authenticated;
revoke all on function public.capture_rejected_void_event() from public, anon, authenticated;
