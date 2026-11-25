create or replace function public.get_fiscal_arbitrary_report(
  p_store_id uuid,
  p_period_start date,
  p_period_end_exclusive date,
  p_timezone text default 'Africa/Tunis'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := coalesce(nullif(btrim(p_timezone), ''), 'Africa/Tunis');
  start_at timestamptz;
  end_at timestamptz;
  store_row public.stores%rowtype;
  profile_row public.fiscal_profiles%rowtype;
  result jsonb;
begin
  if p_store_id is null or not public.is_store_owner(p_store_id) then
    raise exception 'Only the store owner can access fiscal reports.' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end_exclusive is null or p_period_end_exclusive <= p_period_start then
    raise exception 'Fiscal report period boundaries are invalid.';
  end if;
  begin
    perform now() at time zone tz;
  exception when others then
    raise exception 'Fiscal report timezone is invalid.';
  end;
  start_at := (p_period_start::text || ' 00:00:00')::timestamp at time zone tz;
  end_at := (p_period_end_exclusive::text || ' 00:00:00')::timestamp at time zone tz;
  select * into store_row from public.stores where store_id = p_store_id;
  if not found then raise exception 'Store not found.'; end if;
  select * into profile_row from public.fiscal_profiles where store_id = p_store_id;

  with selected_orders as (
    select o.*,
      case when o.status = 'voided' then -1 else 1 end as sign,
      case when o.status = 'voided' then o.voided_at else o.created_at end as period_at
    from public.orders o
    where o.store_id = p_store_id
      and (
        (o.status = 'done' and o.created_at >= start_at and o.created_at < end_at)
        or (o.status = 'voided' and o.voided_at is not null
            and o.voided_at >= start_at and o.voided_at < end_at)
      )
  ),
  totals as (
    select
      count(*) filter (where status = 'done')::integer as completed_count,
      count(*) filter (where status = 'voided')::integer as voided_count,
      count(*) filter (where fiscal_snapshot is null)::integer as missing_snapshot_count,
      coalesce(sum(case when fiscal_snapshot is not null
        then sign * ((fiscal_snapshot->>'netAmountMillimes')::bigint) else 0 end), 0)::bigint as net_millimes,
      coalesce(sum(case when fiscal_snapshot is not null
        then sign * ((fiscal_snapshot->>'totalTaxMillimes')::bigint) else 0 end), 0)::bigint as vat_millimes,
      coalesce(sum(case when fiscal_snapshot is not null
        then sign * ((fiscal_snapshot->>'totalAmountMillimes')::bigint) else 0 end), 0)::bigint as gross_millimes,
      coalesce(sum(case when status = 'voided' and fiscal_snapshot is not null
        then (fiscal_snapshot->>'totalAmountMillimes')::bigint else 0 end), 0)::bigint as void_gross_millimes
    from selected_orders
  ),
  tax_components as (
    select
      tax.value->>'taxType' as tax_type,
      tax.value->>'treatment' as treatment,
      nullif(tax.value->>'ruleId', '') as rule_id,
      nullif(tax.value->>'ruleVersion', '')::integer as rule_version,
      nullif(tax.value->>'ruleName', '') as rule_name,
      nullif(tax.value->>'ratePpm', '')::integer as rate_ppm,
      o.id as order_id,
      o.sign,
      (tax.value->>'taxableBaseMillimes')::bigint as taxable_base,
      (tax.value->>'amountMillimes')::bigint as tax_amount
    from selected_orders o
    cross join lateral jsonb_array_elements(o.fiscal_snapshot->'lines') line
    cross join lateral jsonb_array_elements(line.value->'taxes') tax
    where o.fiscal_snapshot is not null
  ),
  vat_breakdown as (
    select
      tax_type,
      treatment,
      rule_id,
      rule_version,
      rule_name,
      rate_ppm,
      sum(sign * taxable_base)::bigint as taxable_ht_millimes,
      sum(sign * tax_amount)::bigint as vat_millimes,
      sum(sign * (taxable_base + tax_amount))::bigint as ttc_millimes,
      count(distinct order_id)::integer as transaction_count,
      coalesce(jsonb_agg(distinct order_id::text), '[]'::jsonb) as transaction_ids
    from tax_components
    group by tax_type, treatment, rule_id, rule_version, rule_name, rate_ppm
  ),
  sales_payments as (
    select
      coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'cash'), 0)::bigint
        - coalesce(sum(total_millimes) filter (where status = 'voided' and payment_method = 'cash'), 0)::bigint as cash,
      coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'card'), 0)::bigint
        - coalesce(sum(total_millimes) filter (where status = 'voided' and payment_method = 'card'), 0)::bigint as card,
      coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'other'), 0)::bigint
        - coalesce(sum(total_millimes) filter (where status = 'voided' and payment_method = 'other'), 0)::bigint as other,
      coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'tab'), 0)::bigint
        - coalesce(sum(total_millimes) filter (where status = 'voided' and payment_method = 'tab'), 0)::bigint as tab
    from selected_orders
  ),
  tab_collections as (
    select
      coalesce(sum(amount_millimes) filter (where kind = 'settled' and payment_method = 'cash'), 0)
        - coalesce(sum(amount_millimes) filter (where kind = 'reversal' and payment_method = 'cash'), 0) as cash,
      coalesce(sum(amount_millimes) filter (where kind = 'settled' and payment_method = 'card'), 0)
        - coalesce(sum(amount_millimes) filter (where kind = 'reversal' and payment_method = 'card'), 0) as card,
      coalesce(sum(amount_millimes) filter (where kind = 'settled' and payment_method = 'other'), 0)
        - coalesce(sum(amount_millimes) filter (where kind = 'reversal' and payment_method = 'other'), 0) as other,
      coalesce(sum(amount_millimes) filter (where kind = 'reversal'), 0) as reversed
    from public.tabs
    where store_id = p_store_id and created_at >= start_at and created_at < end_at
  ),
  cash_movements as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'kind', kind,
        'reason', reason,
        'amountMillimes', amount_millimes,
        'note', note,
        'createdAt', created_at
      ) order by created_at), '[]'::jsonb) as entries,
      coalesce(sum(case when kind = 'in' then amount_millimes else -amount_millimes end), 0)::bigint as net_millimes
    from public.cash_movements
    where store_id = p_store_id and created_at >= start_at and created_at < end_at
  ),
  void_adjustments as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'orderId', order_id,
        'orderNumber', order_number,
        'amountMillimes', amount_millimes,
        'createdAt', created_at
      ) order by created_at), '[]'::jsonb) as entries,
      coalesce(sum(amount_millimes), 0)::bigint as total_millimes
    from public.shift_void_adjustments
    where store_id = p_store_id and created_at >= start_at and created_at < end_at
  ),
  transactions as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'number', o.number,
      'businessDate', o.business_date,
      'createdAt', o.period_at,
      'customer', c.name,
      'staff', p.name,
      'paymentMethod', o.payment_method,
      'paymentStatus', case when o.payment_method = 'tab' then 'outstanding' else 'paid' end,
      'status', o.status,
      'voidedAt', o.voided_at,
      'voidReason', o.void_reason,
      'snapshot', o.fiscal_snapshot,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', ol.name,
          'quantity', ol.quantity,
          'unitPriceMillimes', ol.unit_price_millimes,
          'lineTotalMillimes', ol.line_total_millimes
        ))
        from public.order_lines ol
        where ol.store_id = p_store_id and ol.order_id = o.id
      ), '[]'::jsonb)
    ) order by o.period_at desc, o.number desc), '[]'::jsonb) as entries
    from selected_orders o
    left join public.customers c on c.id = o.customer_id
    left join public.profiles p on p.id = o.staff_id
  )
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', store_row.store_id,
      'name', store_row.name,
      'timezone', coalesce(store_row.timezone, tz),
      'address', store_row.address,
      'phone', store_row.phone,
      'taxId', store_row.tax_id
    ),
    'period', jsonb_build_object(
      'startDate', p_period_start,
      'endDateExclusive', p_period_end_exclusive,
      'timezone', tz
    ),
    'generatedAt', now(),
    'profile', case when profile_row.store_id is null then null else jsonb_build_object(
      'legalName', profile_row.data->>'legalName',
      'tradingName', profile_row.data->>'tradingName',
      'taxId', profile_row.data->>'taxId',
      'pricingMode', profile_row.data->>'pricingMode',
      'reviewStatus', profile_row.review_status
    ) end,
    'summary', jsonb_build_object(
      'transactionCount', totals.completed_count,
      'voidedTransactionCount', totals.voided_count,
      'netAmountMillimes', totals.net_millimes,
      'vatAmountMillimes', totals.vat_millimes,
      'grossAmountMillimes', totals.gross_millimes,
      'payableAmountMillimes', totals.gross_millimes,
      'missingSnapshotCount', totals.missing_snapshot_count,
      'reconciliationValid', totals.net_millimes + totals.vat_millimes = totals.gross_millimes
    ),
    'vatBreakdown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taxType', vb.tax_type,
        'treatment', vb.treatment,
        'ruleId', vb.rule_id,
        'ruleVersion', vb.rule_version,
        'ruleName', vb.rule_name,
        'ratePpm', vb.rate_ppm,
        'taxableHTMillimes', vb.taxable_ht_millimes,
        'vatMillimes', vb.vat_millimes,
        'ttcMillimes', vb.ttc_millimes,
        'transactionCount', vb.transaction_count,
        'transactionIds', vb.transaction_ids
      ) order by vb.tax_type, vb.treatment, coalesce(vb.rate_ppm, 0), coalesce(vb.rule_id, ''))
      from vat_breakdown vb
    ), '[]'::jsonb),
    'payments', jsonb_build_object(
      'sales', jsonb_build_object(
        'cash', sales_payments.cash,
        'card', sales_payments.card,
        'other', sales_payments.other,
        'tab', sales_payments.tab
      ),
      'collected', jsonb_build_object(
        'cash', sales_payments.cash + tab_collections.cash,
        'card', sales_payments.card + tab_collections.card,
        'other', sales_payments.other + tab_collections.other,
        'tab', sales_payments.tab
      ),
      'tabSettlements', jsonb_build_object(
        'cash', tab_collections.cash,
        'card', tab_collections.card,
        'other', tab_collections.other,
        'reversed', tab_collections.reversed
      )
    ),
    'adjustments', jsonb_build_object(
      'voidedCount', totals.voided_count,
      'voidedGrossMillimes', totals.void_gross_millimes,
      'cashMovements', cash_movements.entries,
      'cashMovementsNetMillimes', cash_movements.net_millimes,
      'voidAdjustments', void_adjustments.entries,
      'voidAdjustmentsTotalMillimes', void_adjustments.total_millimes,
      'refundsAvailable', false,
      'refundsMillimes', null,
      'creditNotesAvailable', false
    ),
    'transactions', transactions.entries
  )
  into result
  from totals, sales_payments, tab_collections, cash_movements, void_adjustments, transactions;

  return result;
end;
$$;

grant execute on function public.get_fiscal_arbitrary_report(uuid, date, date, text) to authenticated;

update public.app_schema_version
set version = 20261125190000,
    updated_at = now()
where singleton;
