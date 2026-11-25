alter function public.get_fiscal_arbitrary_report(uuid, date, date, text)
  rename to get_fiscal_arbitrary_report_before_item_link;

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
  transaction_rows jsonb;
begin
  if p_store_id is null or not public.is_store_owner(p_store_id) then
    raise exception 'Only the store owner can access fiscal reports.' using errcode = '42501';
  end if;
  report := public.get_fiscal_arbitrary_report_before_item_link(
    p_store_id, p_period_start, p_period_end_exclusive, p_timezone
  );
  if report is null then raise exception 'Fiscal report could not be generated.'; end if;

  select coalesce(jsonb_agg(
    transaction.value || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'itemId', line.item_id,
          'name', line.name,
          'quantity', line.quantity,
          'unitPriceMillimes', line.unit_price_millimes,
          'lineTotalMillimes', line.line_total_millimes
        ) order by line.id)
        from public.order_lines line
        where line.store_id = p_store_id
          and line.order_id = (transaction.value->>'id')::uuid
      ), '[]'::jsonb)
    ) order by transaction.ordinality
  ), '[]'::jsonb)
  into transaction_rows
  from jsonb_array_elements(report->'transactions') with ordinality as transaction(value, ordinality);

  report := jsonb_set(report, '{transactions}', transaction_rows);
  return report;
end;
$$;

grant execute on function public.get_fiscal_arbitrary_report(uuid, date, date, text) to authenticated;

update public.app_schema_version
set version = 20261125210000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
