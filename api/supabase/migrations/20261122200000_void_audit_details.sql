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
      jsonb_build_object(
        'orderNumber', target.number,
        'shiftId', target.shift_id,
        'amountMillimes', target.total_millimes,
        'paymentMethod', target.payment_method,
        'requestedAt', target.void_requested_at,
        'reason', target.void_reason,
        'before', jsonb_build_object('status', old.status, 'voidReason', old.void_reason),
        'after', jsonb_build_object('status', new.status, 'voidReason', new.void_reason)
      )
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
  if actor.role = 'staff'
    and target.staff_id <> actor.id
    and not public.has_store_permission('view_all_orders') then
    raise exception 'You can only void an order you can access.' using errcode = '42501';
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

  if exists (
    select 1 from public.shifts where id = target.shift_id and status = 'closed'
  ) and target.payment_method = 'cash' then
    insert into public.shift_void_adjustments (
      store_id, shift_id, order_id, order_number, kind, amount_millimes
    ) values (
      target.store_id, target.shift_id, target.id, target.number, 'approved', -target.total_millimes
    )
    on conflict (shift_id, order_id, kind) do nothing;
  end if;

  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target.store_id, actor.id, actor.name, actor.role, 'order.voided',
    'Voided order #' || target.number || '. ' || cleaned_reason,
    'order', target.id::text,
    jsonb_build_object(
      'orderNumber', target.number,
      'shiftId', target.shift_id,
      'amountMillimes', target.total_millimes,
      'paymentMethod', target.payment_method,
      'authorizationMethod', 'admin_pin',
      'actorId', actor.id,
      'voidedAt', result.voided_at,
      'reason', cleaned_reason,
      'before', jsonb_build_object('status', target.status),
      'after', jsonb_build_object('status', result.status, 'voidReason', cleaned_reason)
    )
  );
  return result;
end
$$;

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
  target_shift public.shifts%rowtype;
  result public.orders%rowtype;
  cleaned_reason text;
  line public.order_lines%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target from public.orders where id = p_order_id for update;
  if actor.id is null or target.id is null or not public.is_store_owner(target.store_id)
    or target.store_id <> actor.store_id then
    raise exception 'Only this store owner can resolve a void request.' using errcode = '42501';
  end if;
  if target.status <> 'pending_void' or p_decision is null or p_decision not in ('approve', 'reject') then
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
  elsif target.payment_method = 'cash' then
    select * into target_shift
    from public.shifts
    where id = target.shift_id;
    if target_shift.status = 'closed' then
      insert into public.shift_void_adjustments (
        store_id, shift_id, order_id, order_number, kind, amount_millimes
      ) values (
        target.store_id, target.shift_id, target.id, target.number, 'rejected', target.total_millimes
      )
      on conflict (shift_id, order_id, kind) do nothing;
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
    jsonb_build_object(
      'orderNumber', target.number,
      'shiftId', target.shift_id,
      'amountMillimes', target.total_millimes,
      'paymentMethod', target.payment_method,
      'authorizationMethod', 'owner_approval',
      'actorId', actor.id,
      'requestedAt', target.void_requested_at,
      'resolvedAt', coalesce(result.voided_at, now()),
      'resolutionReason', cleaned_reason,
      'before', jsonb_build_object('status', target.status, 'voidReason', target.void_reason),
      'after', jsonb_build_object('status', result.status, 'voidReason', result.void_reason)
    )
  );
  return result;
end
$$;

alter function public.get_dashboard_summary(uuid, timestamptz, timestamptz, boolean)
  rename to get_dashboard_summary_pre_void_attribution;

revoke all on function public.get_dashboard_summary_pre_void_attribution(uuid, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

create function public.get_dashboard_summary(
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
  attributed_voids jsonb;
begin
  result := public.get_dashboard_summary_pre_void_attribution(
    p_store_id,
    p_from,
    p_to,
    p_use_expense_creation_period
  );

  select coalesce(jsonb_agg(
    entry.value || jsonb_build_object(
      'staffId', attribution.staff_id,
      'staffName', attribution.staff_name,
      'shiftId', attribution.shift_id,
      'voidedAt', attribution.voided_at
    )
    order by entry.ordinality
  ), '[]'::jsonb)
  into attributed_voids
  from jsonb_array_elements(coalesce(result #> '{voids,orders}', '[]'::jsonb))
    with ordinality as entry(value, ordinality)
  left join lateral (
    select order_record.staff_id,
      staff.name as staff_name,
      order_record.shift_id,
      order_record.voided_at
    from public.orders order_record
    left join public.profiles staff on staff.id = order_record.staff_id
    where order_record.store_id = p_store_id
      and order_record.number = (entry.value->>'ticketNumber')::integer
      and order_record.total_millimes = (entry.value->>'totalMillimes')::bigint
      and coalesce(order_record.void_reason, '') = coalesce(entry.value->>'reason', '')
      and order_record.status = 'voided'
      and order_record.voided_at between p_from and p_to
    order by order_record.voided_at
    limit 1
  ) attribution on true;

  return jsonb_set(result, '{voids,orders}', attributed_voids, true);
end
$$;

revoke all on function public.get_dashboard_summary(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.get_dashboard_summary(uuid, timestamptz, timestamptz, boolean) to authenticated;
