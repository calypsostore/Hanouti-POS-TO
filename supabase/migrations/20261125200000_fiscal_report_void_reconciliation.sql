alter function public.get_fiscal_arbitrary_report(uuid, date, date, text)
  rename to get_fiscal_arbitrary_report_before_reconciliation;

create function public.get_fiscal_arbitrary_report(
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
  report jsonb;
  sales jsonb;
  collected jsonb;
  summary jsonb;
  vat_breakdown jsonb;
  void_cash bigint;
  void_card bigint;
  void_other bigint;
  void_tab bigint;
  void_net bigint;
  void_tax bigint;
  void_gross bigint;
begin
  if p_store_id is null or not public.is_store_owner(p_store_id) then
    raise exception 'Only the store owner can access fiscal reports.' using errcode = '42501';
  end if;
  report := public.get_fiscal_arbitrary_report_before_reconciliation(
    p_store_id, p_period_start, p_period_end_exclusive, p_timezone
  );
  if report is null then raise exception 'Fiscal report could not be generated.'; end if;

  select
    coalesce(sum((t.value->'snapshot'->>'totalAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided' and t.value->>'paymentMethod' = 'cash'), 0),
    coalesce(sum((t.value->'snapshot'->>'totalAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided' and t.value->>'paymentMethod' = 'card'), 0),
    coalesce(sum((t.value->'snapshot'->>'totalAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided' and t.value->>'paymentMethod' = 'other'), 0),
    coalesce(sum((t.value->'snapshot'->>'totalAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided' and t.value->>'paymentMethod' = 'tab'), 0),
    coalesce(sum((t.value->'snapshot'->>'netAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided'), 0),
    coalesce(sum((t.value->'snapshot'->>'totalTaxMillimes')::bigint)
      filter (where t.value->>'status' = 'voided'), 0),
    coalesce(sum((t.value->'snapshot'->>'totalAmountMillimes')::bigint)
      filter (where t.value->>'status' = 'voided'), 0)
  into void_cash, void_card, void_other, void_tab, void_net, void_tax, void_gross
  from jsonb_array_elements(report->'transactions') t(value)
  where t.value->'snapshot' is not null;

  summary := report->'summary';
  summary := summary || jsonb_build_object(
    'netAmountMillimes', (summary->>'netAmountMillimes')::bigint + void_net,
    'vatAmountMillimes', (summary->>'vatAmountMillimes')::bigint + void_tax,
    'grossAmountMillimes', (summary->>'grossAmountMillimes')::bigint + void_gross,
    'payableAmountMillimes', (summary->>'payableAmountMillimes')::bigint + void_gross,
    'reconciliationValid',
      (summary->>'netAmountMillimes')::bigint + void_net
      + (summary->>'vatAmountMillimes')::bigint + void_tax
      = (summary->>'grossAmountMillimes')::bigint + void_gross
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'taxType', grouped.tax_type,
    'treatment', grouped.treatment,
    'ruleId', grouped.rule_id,
    'ruleVersion', grouped.rule_version,
    'ruleName', grouped.rule_name,
    'ratePpm', grouped.rate_ppm,
    'taxableHTMillimes', grouped.taxable_ht,
    'vatMillimes', grouped.tax_amount,
    'ttcMillimes', grouped.taxable_ht + grouped.tax_amount,
    'transactionCount', grouped.transaction_count,
    'transactionIds', grouped.transaction_ids
  ) order by grouped.tax_type, grouped.treatment, coalesce(grouped.rate_ppm, 0), coalesce(grouped.rule_id, '')), '[]'::jsonb)
  into vat_breakdown
  from (
    select
      tax.value->>'taxType' as tax_type,
      tax.value->>'treatment' as treatment,
      nullif(tax.value->>'ruleId', '') as rule_id,
      nullif(tax.value->>'ruleVersion', '')::integer as rule_version,
      nullif(tax.value->>'ruleName', '') as rule_name,
      nullif(tax.value->>'ratePpm', '')::integer as rate_ppm,
      sum((tax.value->>'taxableBaseMillimes')::bigint)::bigint as taxable_ht,
      sum((tax.value->>'amountMillimes')::bigint)::bigint as tax_amount,
      count(distinct t.value->>'id')::integer as transaction_count,
      jsonb_agg(distinct t.value->>'id') as transaction_ids
    from jsonb_array_elements(report->'transactions') t(value)
    cross join lateral jsonb_array_elements(t.value->'snapshot'->'lines') line(value)
    cross join lateral jsonb_array_elements(line.value->'taxes') tax(value)
    where t.value->>'status' = 'done' and t.value->'snapshot' is not null
    group by tax.value->>'taxType', tax.value->>'treatment',
      nullif(tax.value->>'ruleId', ''),
      nullif(tax.value->>'ruleVersion', '')::integer,
      nullif(tax.value->>'ruleName', ''),
      nullif(tax.value->>'ratePpm', '')::integer
  ) grouped;

  sales := report->'payments'->'sales';
  collected := report->'payments'->'collected';
  sales := sales || jsonb_build_object(
    'cash', (sales->>'cash')::bigint + void_cash,
    'card', (sales->>'card')::bigint + void_card,
    'other', (sales->>'other')::bigint + void_other,
    'tab', (sales->>'tab')::bigint + void_tab
  );
  collected := collected || jsonb_build_object(
    'cash', (collected->>'cash')::bigint + void_cash,
    'card', (collected->>'card')::bigint + void_card,
    'other', (collected->>'other')::bigint + void_other,
    'tab', 0
  );

  report := jsonb_set(report, '{summary}', summary);
  report := jsonb_set(report, '{vatBreakdown}', vat_breakdown);
  report := jsonb_set(report, '{payments,sales}', sales);
  report := jsonb_set(report, '{payments,collected}', collected);
  return report;
end;
$$;

grant execute on function public.get_fiscal_arbitrary_report(uuid, date, date, text) to authenticated;

update public.app_schema_version
set version = 20261125200000,
    updated_at = now()
where singleton;
