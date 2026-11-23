create or replace function public.get_customers_credit_status(p_store_id uuid)
returns table(customer_id uuid, balance_millimes bigint, credit_limit_millimes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(p_store_id)
      or public.has_store_permission('customers_view')
      or public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    ) then
    raise exception 'Not authorized to view customer credit status.' using errcode = '42501';
  end if;

  return query
  with order_balances as (
    select o.customer_id, sum(o.total_millimes)::bigint as amount_millimes
    from public.orders as o
    where o.store_id = p_store_id
      and o.customer_id is not null
      and o.payment_method = 'tab'
      and o.status = 'done'
    group by o.customer_id
  ),
  legacy_tab_balances as (
    select t.customer_id,
      sum(case when t.kind = 'settled' then -t.amount_millimes else t.amount_millimes end)::bigint as amount_millimes
    from public.tabs as t
    where t.store_id = p_store_id
      and (t.kind <> 'issued' or t.order_id is null)
    group by t.customer_id
  )
  select c.id,
    coalesce(ob.amount_millimes, 0) + coalesce(ltb.amount_millimes, 0),
    c.credit_limit_millimes
  from public.customers as c
  left join order_balances as ob on ob.customer_id = c.id
  left join legacy_tab_balances as ltb on ltb.customer_id = c.id
  where c.store_id = p_store_id;
end
$$;

revoke all on function public.get_customers_credit_status(uuid) from public, anon;
grant execute on function public.get_customers_credit_status(uuid) to authenticated;

update public.app_schema_version
set version = 20261121161114,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
