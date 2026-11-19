alter table public.orders
  drop constraint orders_voided_by_fkey;

alter table public.orders
  alter column voided_by type text using voided_by::text;

create or replace function public.resolve_order_void(
  p_order_id uuid,
  p_decision text,
  p_reason text,
  p_pin text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.orders%rowtype;
  result public.orders%rowtype;
  cleaned_reason text;
  line public.order_lines%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target from public.orders where id = p_order_id for update;
  if actor.id is null or not public.is_store_owner(target.store_id)
    or target.store_id <> actor.store_id then
    raise exception 'Only this store owner can resolve a void request.' using errcode = '42501';
  end if;
  if target.status <> 'pending_void' or p_decision not in ('approve', 'reject') then
    raise exception 'This order cannot be resolved.';
  end if;
  cleaned_reason := nullif(pg_catalog.btrim(p_reason), '');
  if p_decision = 'approve' and cleaned_reason is null then
    raise exception 'A reason is required to void an order.';
  end if;

  update public.orders
  set status = case when p_decision = 'approve' then 'voided' else 'done' end,
      voided_at = case when p_decision = 'approve' then now() else null end,
      voided_by = case when p_decision = 'approve' then 'owner' else null end,
      voided_by_user_id = case when p_decision = 'approve' then actor.id else null end,
      void_reason = case when p_decision = 'approve' then cleaned_reason else null end,
      void_requested_at = null
  where id = target.id
  returning * into result;

  if p_decision = 'approve' then
    for line in select * from public.order_lines where order_id = target.id loop
      update public.catalog_items
      set stock_count = stock_count + line.quantity,
          out_of_stock = false,
          out_of_stock_by = null,
          out_of_stock_at = null
      where id = line.item_id
        and store_id = target.store_id
        and stock_count is not null;
    end loop;
    if exists (select 1 from public.shifts where id = target.shift_id and status = 'closed') then
      insert into public.shift_void_adjustments (
        store_id, shift_id, order_id, order_number, amount_millimes
      ) values (
        target.store_id, target.shift_id, target.id, target.number, -target.total_millimes
      )
      on conflict (shift_id, order_id) do nothing;
    end if;
  end if;

  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target.store_id, actor.id, actor.name, actor.role,
    case when p_decision = 'approve' then 'order.voided' else 'order.void_rejected' end,
    case when p_decision = 'approve'
      then 'Approved void for order #' || target.number || '. ' || cleaned_reason
      else 'Rejected void request for order #' || target.number || '.'
    end,
    'order', target.id::text,
    jsonb_build_object('before', jsonb_build_object('status', target.status, 'voidReason', target.void_reason),
      'after', jsonb_build_object('status', result.status, 'voidReason', result.void_reason))
  );
  return result;
end
$$;

create or replace function public.void_order_with_pin(p_order_id uuid, p_reason text, p_pin text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.orders%rowtype;
  result public.orders%rowtype;
  cleaned_reason text;
  line public.order_lines%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target
  from public.orders
  where id = p_order_id
  for update;
  if actor.id is null
    or actor.store_id is distinct from target.store_id
    or not (public.is_store_owner(target.store_id) or public.has_store_permission('request_void')) then
    raise exception 'Not authorized to void this order.' using errcode = '42501';
  end if;
  if target.status <> 'done' then
    raise exception 'This order is not available to void.';
  end if;
  cleaned_reason := nullif(pg_catalog.btrim(p_reason), '');
  if cleaned_reason is null then
    raise exception 'A reason is required to void an order.';
  end if;
  if not public.verify_store_pin(target.store_id, p_pin, 'void') then
    raise exception 'Incorrect Admin PIN.';
  end if;

  update public.orders
  set status = 'voided',
      voided_at = now(),
      voided_by = 'pin',
      voided_by_user_id = actor.id,
      void_reason = cleaned_reason
  where id = target.id
  returning * into result;

  for line in select * from public.order_lines where order_id = target.id loop
    update public.catalog_items
    set stock_count = stock_count + line.quantity,
        out_of_stock = false,
        out_of_stock_by = null,
        out_of_stock_at = null
    where id = line.item_id
      and store_id = target.store_id
      and stock_count is not null;
  end loop;
  if exists (select 1 from public.shifts where id = target.shift_id and status = 'closed') then
    insert into public.shift_void_adjustments (
      store_id, shift_id, order_id, order_number, amount_millimes
    ) values (
      target.store_id, target.shift_id, target.id, target.number, -target.total_millimes
    )
    on conflict (shift_id, order_id) do nothing;
  end if;
  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target.store_id, actor.id, actor.name, actor.role, 'order.voided',
    'Voided order #' || target.number || '. ' || cleaned_reason,
    'order', target.id::text,
    jsonb_build_object('before', jsonb_build_object('status', target.status),
      'after', jsonb_build_object('status', result.status, 'voidReason', cleaned_reason))
  );
  return result;
end
$$;

create or replace function public.get_next_order_number()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_store uuid := (select public.current_store_id());
  business_day date;
  result integer;
begin
  if current_store is null
    or not (public.current_user_role() = 'owner' or public.has_store_permission('take_orders')) then
    raise exception 'Not authorized to read order numbers.' using errcode = '42501';
  end if;
  select (now() at time zone s.timezone)::date into business_day
  from public.stores s
  where s.store_id = current_store;
  select c.next_number into result
  from public.order_counters c
  where c.store_id = current_store
    and c.business_date = business_day;
  return coalesce(result, 1);
end
$$;

create or replace function public.track_order_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.orders%rowtype;
begin
  select * into target from public.orders where id = new.id;
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then return new; end if;

  if tg_op = 'INSERT' then
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      target.store_id, actor.id, actor.name, actor.role, 'order.created',
      'Created order #' || target.number || ' for ' || target.total_millimes || ' millimes.',
      'order', target.id::text,
      jsonb_build_object('after', jsonb_build_object(
        'number', target.number,
        'paymentMethod', target.payment_method,
        'totalMillimes', target.total_millimes,
        'customerId', target.customer_id
      ))
    );
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'pending_void' then
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      target.store_id, actor.id, actor.name, actor.role, 'order.void_requested',
      'Requested a void for order #' || target.number || '. ' || coalesce(target.void_reason, ''),
      'order', target.id::text,
      jsonb_build_object('before', jsonb_build_object('status', old.status),
        'after', jsonb_build_object('status', new.status, 'voidReason', new.void_reason))
    );
    insert into public.notifications (
      store_id, target_role, type, title, body, entity_type, entity_id
    ) values (
      target.store_id, 'owner', 'void_requested', 'Void request awaiting review',
      actor.name || ' requested to void order #' || target.number || '.',
      'order', target.id::text
    );
  elsif old.status is distinct from new.status
    and old.status = 'pending_void'
    and new.status in ('done', 'voided') then
    insert into public.notifications (
      store_id, user_id, type, title, body, entity_type, entity_id
    ) values (
      target.store_id,
      target.staff_id,
      case when new.status = 'voided' then 'void_approved' else 'void_rejected' end,
      case when new.status = 'voided' then 'Void request approved' else 'Void request rejected' end,
      case when new.status = 'voided'
        then 'Your request to void order #' || target.number || ' was approved.'
        else 'Your request to void order #' || target.number || ' was rejected.'
      end,
      'order', target.id::text
    );
  end if;
  return new;
end
$$;

create trigger orders_track_activity
after insert or update of status on public.orders
for each row execute function public.track_order_activity();

revoke all on function public.void_order_with_pin(uuid, text, text) from public, anon;
revoke all on function public.get_next_order_number() from public, anon;
grant execute on function public.void_order_with_pin(uuid, text, text) to authenticated;
grant execute on function public.get_next_order_number() to authenticated;
