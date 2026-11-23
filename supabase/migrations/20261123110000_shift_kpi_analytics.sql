create or replace function public.get_shift_kpi_analytics(
  p_store_id uuid,
  p_from date,
  p_to date,
  p_previous_from date,
  p_previous_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  store_timezone text;
  store_created_at timestamptz;
  period_summaries jsonb;
  series jsonb;
  series_bucket text;
  series_bucket_count integer;
  date_span integer;
begin
  if p_store_id is distinct from (select public.current_store_id())
    or not public.is_store_owner(p_store_id) then
    raise exception 'Not authorized to view shift KPI analytics.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_previous_from is null or p_previous_to is null
    or p_from > p_to or p_previous_from > p_previous_to then
    raise exception 'Invalid shift KPI analytics period.' using errcode = '22023';
  end if;

  select store.timezone, store.created_at
  into store_timezone, store_created_at
  from public.stores store
  where store.store_id = p_store_id;
  if store_timezone is null then
    raise exception 'Store could not be found.' using errcode = 'P0002';
  end if;

  date_span := p_to - p_from;
  if date_span = 0 then
    series_bucket := 'hour';
    series_bucket_count := 23;
  elsif date_span > 365 then
    series_bucket := 'month';
    series_bucket_count :=
      (extract(year from p_to)::integer - extract(year from p_from)::integer) * 12
      + extract(month from p_to)::integer - extract(month from p_from)::integer;
  elsif date_span > 90 then
    series_bucket := 'week';
    series_bucket_count := date_span / 7;
  else
    series_bucket := 'day';
    series_bucket_count := date_span;
  end if;

  with periods(period_name, period_from, period_to) as (
    values
      ('current'::text, p_from, p_to),
      ('previous'::text, p_previous_from, p_previous_to)
  ),
  order_totals as (
    select period.period_name,
      coalesce(sum(order_record.total_millimes) filter (where order_record.status = 'done'), 0)::bigint as sales,
      count(*) filter (where order_record.status = 'done')::bigint as transactions,
      coalesce(sum(order_record.total_millimes) filter (
        where order_record.status = 'done' and order_record.payment_method = 'cash'
      ), 0)::bigint as cash,
      coalesce(sum(order_record.total_millimes) filter (
        where order_record.status = 'done' and order_record.payment_method = 'card'
      ), 0)::bigint as card,
      coalesce(sum(order_record.total_millimes) filter (
        where order_record.status = 'done' and order_record.payment_method = 'other'
      ), 0)::bigint as other
    from periods period
    left join public.orders order_record
      on order_record.store_id = p_store_id
      and order_record.created_at >= (period.period_from::timestamp at time zone store_timezone)
      and order_record.created_at < ((period.period_to + 1)::timestamp at time zone store_timezone)
    group by period.period_name
  ),
  tab_totals as (
    select period.period_name,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'cash'), 0)::bigint as cash,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'card'), 0)::bigint as card,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'other'), 0)::bigint as other
    from periods period
    left join public.tabs tab
      on tab.store_id = p_store_id
      and tab.kind in ('settled', 'reversal')
      and tab.created_at >= (period.period_from::timestamp at time zone store_timezone)
      and tab.created_at < ((period.period_to + 1)::timestamp at time zone store_timezone)
    group by period.period_name
  ),
  expense_totals as (
    select period.period_name,
      coalesce(sum(expense.amount_millimes), 0)::bigint as expenses
    from periods period
    left join public.expenses expense
      on expense.store_id = p_store_id
      and expense.date between period.period_from and period.period_to
    group by period.period_name
  ),
  period_values as (
    select period.period_name,
      order_total.sales,
      order_total.transactions,
      order_total.cash + tab_total.cash as cash,
      order_total.card + tab_total.card as card,
      order_total.other + tab_total.other as other,
      expense_total.expenses
    from periods period
    join order_totals order_total using (period_name)
    join tab_totals tab_total using (period_name)
    join expense_totals expense_total using (period_name)
  )
  select jsonb_object_agg(period_name, jsonb_build_object(
    'sales', sales,
    'transactions', transactions,
    'cash', cash,
    'cards', card,
    'other', other,
    'expenses', expenses,
    'netSales', cash + card + other - expenses
  ))
  into period_summaries
  from period_values;

  with buckets as (
    select bucket_index,
      case
        when series_bucket = 'hour' then p_from
        when series_bucket = 'month'
          then (date_trunc('month', p_from::timestamp) + bucket_index * interval '1 month')::date
        when series_bucket = 'week' then p_from + bucket_index * 7
        else p_from + bucket_index
      end as bucket_date
    from generate_series(0, series_bucket_count) as generated(bucket_index)
  ),
  order_buckets as (
    select case
        when series_bucket = 'hour'
          then extract(hour from order_record.created_at at time zone store_timezone)::integer
        when series_bucket = 'month'
          then (extract(year from (order_record.created_at at time zone store_timezone)::date)::integer
            - extract(year from p_from)::integer) * 12
            + extract(month from (order_record.created_at at time zone store_timezone)::date)::integer
            - extract(month from p_from)::integer
        when series_bucket = 'week'
          then ((order_record.created_at at time zone store_timezone)::date - p_from) / 7
        else (order_record.created_at at time zone store_timezone)::date - p_from
      end as bucket_index,
      coalesce(sum(order_record.total_millimes), 0)::bigint as sales,
      count(*)::bigint as transactions,
      coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'cash'), 0)::bigint as cash,
      coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'card'), 0)::bigint as card,
      coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'other'), 0)::bigint as other
    from public.orders order_record
    where order_record.store_id = p_store_id
      and order_record.status = 'done'
      and order_record.created_at >= (p_from::timestamp at time zone store_timezone)
      and order_record.created_at < ((p_to + 1)::timestamp at time zone store_timezone)
    group by bucket_index
  ),
  tab_buckets as (
    select case
        when series_bucket = 'hour'
          then extract(hour from tab.created_at at time zone store_timezone)::integer
        when series_bucket = 'month'
          then (extract(year from (tab.created_at at time zone store_timezone)::date)::integer
            - extract(year from p_from)::integer) * 12
            + extract(month from (tab.created_at at time zone store_timezone)::date)::integer
            - extract(month from p_from)::integer
        when series_bucket = 'week'
          then ((tab.created_at at time zone store_timezone)::date - p_from) / 7
        else (tab.created_at at time zone store_timezone)::date - p_from
      end as bucket_index,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'cash'), 0)::bigint as cash,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'card'), 0)::bigint as card,
      coalesce(sum(case
        when tab.kind = 'settled' then tab.amount_millimes
        when tab.kind = 'reversal'
          and public.get_tab_reversal_status(tab.id, tab.shift_id) <> 'ambiguous'
          then -tab.amount_millimes
        else 0
      end) filter (where tab.payment_method = 'other'), 0)::bigint as other
    from public.tabs tab
    where tab.store_id = p_store_id
      and tab.kind in ('settled', 'reversal')
      and tab.created_at >= (p_from::timestamp at time zone store_timezone)
      and tab.created_at < ((p_to + 1)::timestamp at time zone store_timezone)
    group by bucket_index
  ),
  expense_buckets as (
    select case
        when series_bucket = 'hour' then 0
        when series_bucket = 'month'
          then (extract(year from expense.date)::integer - extract(year from p_from)::integer) * 12
            + extract(month from expense.date)::integer - extract(month from p_from)::integer
        when series_bucket = 'week' then (expense.date - p_from) / 7
        else expense.date - p_from
      end as bucket_index,
      coalesce(sum(expense.amount_millimes), 0)::bigint as expenses
    from public.expenses expense
    where expense.store_id = p_store_id
      and expense.date between p_from and p_to
    group by bucket_index
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', case
      when series_bucket = 'hour' then lpad(buckets.bucket_index::text, 2, '0') || ':00'
      when series_bucket = 'month' then to_char(buckets.bucket_date, 'YYYY-MM')
      else to_char(buckets.bucket_date, 'YYYY-MM-DD')
    end,
    'sales', coalesce(order_bucket.sales, 0),
    'transactions', coalesce(order_bucket.transactions, 0),
    'cash', coalesce(order_bucket.cash, 0) + coalesce(tab_bucket.cash, 0),
    'cards', coalesce(order_bucket.card, 0) + coalesce(tab_bucket.card, 0),
    'other', coalesce(order_bucket.other, 0) + coalesce(tab_bucket.other, 0),
    'expenses', coalesce(expense_bucket.expenses, 0),
    'netSales', coalesce(order_bucket.cash, 0) + coalesce(tab_bucket.cash, 0)
      + coalesce(order_bucket.card, 0) + coalesce(tab_bucket.card, 0)
      + coalesce(order_bucket.other, 0) + coalesce(tab_bucket.other, 0)
      - coalesce(expense_bucket.expenses, 0)
  ) order by buckets.bucket_index), '[]'::jsonb)
  into series
  from buckets
  left join order_buckets order_bucket using (bucket_index)
  left join tab_buckets tab_bucket using (bucket_index)
  left join expense_buckets expense_bucket using (bucket_index);

  return jsonb_build_object(
    'current', period_summaries->'current',
    'previous', period_summaries->'previous',
    'comparisonAvailable',
      store_created_at <= (p_previous_from::timestamp at time zone store_timezone),
    'series', series
  );
end
$$;

revoke all on function public.get_shift_kpi_analytics(uuid, date, date, date, date) from public, anon;
grant execute on function public.get_shift_kpi_analytics(uuid, date, date, date, date) to authenticated;

notify pgrst, 'reload schema';
