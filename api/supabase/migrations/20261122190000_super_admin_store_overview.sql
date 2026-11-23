create or replace function public.get_super_admin_store_overview(
  p_search text default '',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  store_id uuid,
  owner_id uuid,
  code text,
  name text,
  is_active boolean,
  archived_at timestamptz,
  subscription_paid_until date,
  today_order_count bigint,
  today_sales_millimes bigint,
  open_shift_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_stores as (
    select s.store_id, s.owner_id, s.code, s.name, s.is_active, s.archived_at,
           s.subscription_paid_until, s.timezone
    from public.stores s
    where public.is_super_admin()
      and s.archived_at is null
      and (
        coalesce(btrim(p_search), '') = ''
        or s.name ilike '%' || btrim(p_search) || '%'
        or s.code ilike '%' || btrim(p_search) || '%'
      )
  ),
  filtered as (
    select *
    from allowed_stores
    order by name asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  totals as (
    select count(*)::bigint as total_count
    from allowed_stores
  ),
  daily as (
    select o.store_id,
           count(*)::bigint as today_order_count,
           coalesce(sum(o.total_millimes) filter (where o.status = 'done'), 0)::bigint as today_sales_millimes
    from public.orders o
    join filtered f on f.store_id = o.store_id
    where o.business_date = (date(now() at time zone f.timezone))
    group by o.store_id
  ),
  open_shifts as (
    select sh.store_id, count(*)::bigint as open_shift_count
    from public.shifts sh
    join filtered f on f.store_id = sh.store_id
    where sh.status = 'open'
    group by sh.store_id
  )
  select f.store_id, f.owner_id, f.code, f.name, f.is_active, f.archived_at,
         f.subscription_paid_until,
         coalesce(d.today_order_count, 0),
         coalesce(d.today_sales_millimes, 0),
         coalesce(os.open_shift_count, 0),
         totals.total_count
  from filtered f
  cross join totals
  left join daily d on d.store_id = f.store_id
  left join open_shifts os on os.store_id = f.store_id;
$$;

revoke all on function public.get_super_admin_store_overview(text, integer, integer) from public, anon;
grant execute on function public.get_super_admin_store_overview(text, integer, integer) to authenticated;

create index if not exists orders_store_business_status_idx
  on public.orders (store_id, business_date, status);
create index if not exists shifts_store_status_idx
  on public.shifts (store_id, status);

update public.app_schema_version
set version = 20261122190000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
