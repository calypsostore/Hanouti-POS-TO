create function public.get_checkout_fiscal_profile(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.fiscal_profiles%rowtype;
begin
  if p_store_id is null
    or p_store_id is distinct from public.current_store_id()
    or not (public.current_user_role() = 'owner' or public.has_store_permission('take_orders')) then
    raise exception 'Not authorized to read checkout fiscal settings.' using errcode = '42501';
  end if;
  select * into profile_row
  from public.fiscal_profiles
  where store_id = p_store_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'storeId', profile_row.store_id,
    'reviewStatus', profile_row.review_status,
    'requiredTaxTypes', coalesce(profile_row.data->'requiredTaxTypes', '[]'::jsonb),
    'pricingMode', profile_row.data->'pricingMode',
    'updatedAt', profile_row.updated_at
  );
end
$$;

create function public.calculate_fiscal_line_components(
  p_net_amount_millimes bigint,
  p_quantity integer,
  p_rules jsonb,
  p_treatments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_row jsonb;
  treatment_row jsonb;
  components jsonb := '[]'::jsonb;
  taxable_base numeric;
  tax_amount numeric;
  tax_total numeric := 0;
  prior_taxes numeric := 0;
  amount numeric;
begin
  for rule_row in
    select value
    from jsonb_array_elements(p_rules)
    order by (value->>'priority')::integer
  loop
    if rule_row->>'treatment' not in ('taxable', 'special') then
      raise exception 'Tax rule % conflicts with its treatment.', rule_row->>'id';
    end if;
    taxable_base := p_net_amount_millimes;
    if coalesce((rule_row->>'compoundWithPriorTaxes')::boolean, false) then
      taxable_base := taxable_base + prior_taxes;
    end if;
    if taxable_base > 9000000000000000 then
      raise exception 'Fiscal taxable base exceeds the supported money range.';
    end if;
    if rule_row->>'calculationMethod' = 'percentage' then
      tax_amount := floor((
        taxable_base * (rule_row->>'ratePpm')::numeric + 500000
      ) / 1000000);
    elsif rule_row->>'calculationMethod' = 'fixed' then
      tax_amount := (rule_row->>'fixedAmountMillimes')::numeric *
        case when coalesce((rule_row->>'fixedAmountPerUnit')::boolean, true) then p_quantity else 1 end;
    else
      raise exception 'Tax rule % uses an unsupported calculation method.', rule_row->>'id';
    end if;
    prior_taxes := prior_taxes + tax_amount;
    if prior_taxes > 9000000000000000 then
      raise exception 'Fiscal tax total exceeds the supported money range.';
    end if;
    components := components || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'taxType', rule_row->'taxType',
      'treatment', rule_row->'treatment',
      'ruleId', rule_row->'id',
      'ruleVersion', rule_row->'version',
      'ruleName', rule_row->'name',
      'calculationMethod', rule_row->'calculationMethod',
      'ratePpm', rule_row->'ratePpm',
      'fixedAmountMillimes', rule_row->'fixedAmountMillimes',
      'taxableBaseMillimes', taxable_base,
      'amountMillimes', tax_amount,
      'legalReference', rule_row->'legalReference',
      'evidenceReference', rule_row->'evidenceReference'
    )));
  end loop;

  for treatment_row in select value from jsonb_array_elements(p_treatments) loop
    if treatment_row->>'treatment' not in ('taxable', 'special') then
      components := components || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'taxType', treatment_row->'taxType',
        'treatment', treatment_row->'treatment',
        'taxableBaseMillimes', p_net_amount_millimes,
        'amountMillimes', 0,
        'legalReference', treatment_row->'legalReference',
        'evidenceReference', treatment_row->'evidenceReference'
      )));
    end if;
  end loop;
  tax_total := prior_taxes;
  amount := p_net_amount_millimes + tax_total;
  if amount > 9000000000000000 then
    raise exception 'Fiscal line total exceeds the supported money range.';
  end if;
  return jsonb_build_object(
    'components', components,
    'totalTaxMillimes', tax_total,
    'totalAmountMillimes', amount
  );
end
$$;

create function public.calculate_fiscal_order_snapshot(
  p_store_id uuid,
  p_transaction_date date,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.fiscal_profiles%rowtype;
  assignment_row public.catalog_item_tax_assignments%rowtype;
  rule_row public.fiscal_tax_rules%rowtype;
  line_row jsonb;
  required_tax_types text[];
  selected_tax_type text;
  treatments jsonb;
  resolved_rules jsonb;
  line_snapshots jsonb := '[]'::jsonb;
  calculated jsonb;
  net_amount numeric;
  tax_amount numeric;
  gross_amount numeric;
  line_target numeric;
  line_net numeric;
  line_tax numeric;
  line_gross numeric;
  low_value bigint;
  high_value bigint;
  middle_value bigint;
  match_count integer;
  line_index integer := 0;
  price_mode text;
begin
  if p_store_id is null or p_transaction_date is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0 then
    raise exception 'Fiscal checkout requires a store, transaction date, and order lines.';
  end if;
  select * into profile_row
  from public.fiscal_profiles
  where store_id = p_store_id;
  if not found then
    if exists (
      select 1 from public.fiscal_tax_rules
      where store_id = p_store_id and status = 'active' and legal_reviewed
        and effective_from <= p_transaction_date
        and (effective_through is null or effective_through >= p_transaction_date)
    ) then
      raise exception 'Effective fiscal rules exist, but the store fiscal profile is missing.';
    end if;
    return null;
  end if;
  if jsonb_typeof(profile_row.data->'requiredTaxTypes') = 'array' then
    select coalesce(array_agg(value order by ordinal), array[]::text[])
    into required_tax_types
    from jsonb_array_elements_text(profile_row.data->'requiredTaxTypes') with ordinality as values_by_position(value, ordinal);
  else
    required_tax_types := array[]::text[];
  end if;
  if cardinality(required_tax_types) = 0 then
    if exists (
      select 1 from public.fiscal_tax_rules
      where store_id = p_store_id and status = 'active' and legal_reviewed
        and effective_from <= p_transaction_date
        and (effective_through is null or effective_through >= p_transaction_date)
    ) then
      raise exception 'Effective fiscal rules exist, but the store has no configured line-tax types.';
    end if;
    return null;
  end if;
  if profile_row.review_status <> 'confirmed' then
    raise exception 'Confirm the store fiscal profile before applying configured line taxes.';
  end if;
  if exists (
    select 1
    from unnest(required_tax_types) as selected(tax_type)
    where selected.tax_type not in ('vat', 'consumption', 'other')
  ) or cardinality(required_tax_types) <> (
    select count(distinct selected.tax_type) from unnest(required_tax_types) as selected(tax_type)
  ) then
    raise exception 'Configured line taxes contain duplicate or unsupported tax types.';
  end if;
  price_mode := profile_row.data->>'pricingMode';
  if price_mode not in ('inclusive', 'exclusive') then
    raise exception 'Store fiscal profile needs an explicit displayed price mode.';
  end if;

  for line_row in
    select value from jsonb_array_elements(p_lines)
  loop
    line_index := line_index + 1;
    treatments := '[]'::jsonb;
    resolved_rules := '[]'::jsonb;
    for selected_tax_type in select unnest(required_tax_types) loop
      select count(*) into match_count
      from public.catalog_item_tax_assignments assignment
      where assignment.store_id = p_store_id
        and assignment.tax_type = selected_tax_type
        and assignment.item_id = (line_row->>'item_id')::uuid
        and assignment.effective_from <= p_transaction_date
        and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
      if match_count = 0 then
        select count(*) into match_count
        from public.catalog_item_tax_assignments assignment
        where assignment.store_id = p_store_id
          and assignment.tax_type = selected_tax_type
          and assignment.category_id = (line_row->>'category_id')::uuid
          and assignment.effective_from <= p_transaction_date
          and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
        if match_count <> 1 then
          raise exception 'Order line % needs one effective % classification.', line_index, selected_tax_type;
        end if;
        select * into assignment_row
        from public.catalog_item_tax_assignments assignment
        where assignment.store_id = p_store_id
          and assignment.tax_type = selected_tax_type
          and assignment.category_id = (line_row->>'category_id')::uuid
          and assignment.effective_from <= p_transaction_date
          and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
      elsif match_count = 1 then
        select * into assignment_row
        from public.catalog_item_tax_assignments assignment
        where assignment.store_id = p_store_id
          and assignment.tax_type = selected_tax_type
          and assignment.item_id = (line_row->>'item_id')::uuid
          and assignment.effective_from <= p_transaction_date
          and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
      else
        raise exception 'Order line % has ambiguous item-level % classifications.', line_index, selected_tax_type;
      end if;
      if assignment_row.treatment = 'unconfigured' then
        raise exception 'Order line % has an unconfigured % treatment.', line_index, selected_tax_type;
      end if;
      if assignment_row.treatment in ('exempt', 'outside_scope', 'suspended', 'special')
        and nullif(btrim(coalesce(assignment_row.legal_reference, '')), '') is null
        and nullif(btrim(coalesce(assignment_row.evidence_reference, '')), '') is null then
        raise exception 'Order line % needs evidence for its % treatment.', line_index, selected_tax_type;
      end if;
      treatments := treatments || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'taxType', selected_tax_type,
        'treatment', assignment_row.treatment,
        'legalReference', assignment_row.legal_reference,
        'evidenceReference', assignment_row.evidence_reference
      )));
      if assignment_row.treatment in ('taxable', 'special') then
        select * into rule_row
        from public.fiscal_tax_rules rule
        where rule.store_id = p_store_id
          and rule.rule_id = assignment_row.rule_id
          and rule.version = assignment_row.rule_version;
        if not found or rule_row.tax_type <> selected_tax_type or rule_row.status <> 'active'
          or not rule_row.legal_reviewed
          or rule_row.effective_from > p_transaction_date
          or (rule_row.effective_through is not null and rule_row.effective_through < p_transaction_date) then
          raise exception 'Order line % references an inactive or ineffective % rule version.', line_index, selected_tax_type;
        end if;
        resolved_rules := resolved_rules || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', rule_row.rule_id,
          'version', rule_row.version,
          'name', rule_row.name,
          'taxType', rule_row.tax_type,
          'treatment', assignment_row.treatment,
          'calculationMethod', rule_row.calculation_method,
          'ratePpm', rule_row.rate_ppm,
          'fixedAmountMillimes', rule_row.fixed_amount_millimes,
          'fixedAmountPerUnit', rule_row.fixed_amount_per_unit,
          'compoundWithPriorTaxes', rule_row.compound_with_prior_taxes,
          'priority', rule_row.priority,
          'legalReference', rule_row.legal_reference,
          'evidenceReference', assignment_row.evidence_reference
        )));
      end if;
    end loop;

    if (select count(*) from jsonb_array_elements(resolved_rules)) <>
      (select count(distinct (value->>'priority')::integer) from jsonb_array_elements(resolved_rules)) then
      raise exception 'Order line % has ambiguous tax rule priorities.', line_index;
    end if;
    if (line_row->>'quantity') !~ '^[1-9][0-9]*$'
      or (line_row->>'unit_price_millimes') !~ '^[0-9]+$' then
      raise exception 'Order line % has invalid quantity or price.', line_index;
    end if;
    if (line_row->>'unit_price_millimes')::numeric * (line_row->>'quantity')::numeric > 9000000000000000 then
      raise exception 'Order line % exceeds the supported price range.', line_index;
    end if;
    line_target := (line_row->>'unit_price_millimes')::numeric * (line_row->>'quantity')::numeric;
    line_net := line_target;
    if price_mode = 'inclusive' then
      low_value := 0;
      high_value := line_target::bigint;
      while low_value < high_value loop
        middle_value := low_value + ((high_value - low_value) / 2);
        calculated := public.calculate_fiscal_line_components(
          middle_value, (line_row->>'quantity')::integer, resolved_rules, treatments
        );
        if (calculated->>'totalAmountMillimes')::numeric >= line_target then
          high_value := middle_value;
        else
          low_value := middle_value + 1;
        end if;
      end loop;
      line_net := low_value;
    end if;
    calculated := public.calculate_fiscal_line_components(
      line_net::bigint, (line_row->>'quantity')::integer, resolved_rules, treatments
    );
    line_tax := (calculated->>'totalTaxMillimes')::numeric;
    line_gross := (calculated->>'totalAmountMillimes')::numeric;
    if price_mode = 'inclusive' and line_gross <> line_target then
      raise exception 'Order line % inclusive price cannot be reconciled to its effective tax rules.', line_index;
    end if;
    line_snapshots := line_snapshots || jsonb_build_array(jsonb_build_object(
      'lineId', 'line-' || line_index,
      'itemId', line_row->>'item_id',
      'categoryId', line_row->>'category_id',
      'quantity', (line_row->>'quantity')::integer,
      'unitAmountMillimes', (line_row->>'unit_price_millimes')::bigint,
      'discountMillimes', 0,
      'priceMode', price_mode,
      'netAmountMillimes', line_net,
      'taxes', calculated->'components',
      'totalTaxMillimes', line_tax,
      'totalAmountMillimes', line_gross
    ));
    net_amount := coalesce(net_amount, 0) + line_net;
    tax_amount := coalesce(tax_amount, 0) + line_tax;
    gross_amount := coalesce(gross_amount, 0) + line_gross;
    if gross_amount > 9000000000000000 then
      raise exception 'Fiscal order total exceeds the supported money range.';
    end if;
  end loop;
  if net_amount + tax_amount <> gross_amount then
    raise exception 'Fiscal order totals do not reconcile.';
  end if;
  return jsonb_build_object(
    'schemaVersion', 1,
    'calculationVersion', 'millime-tax-v1',
    'currency', 'TND',
    'storeId', p_store_id,
    'transactionDate', p_transaction_date,
    'roundingPolicy', 'nearest-millime-half-up',
    'lines', line_snapshots,
    'netAmountMillimes', net_amount,
    'totalTaxMillimes', tax_amount,
    'totalAmountMillimes', gross_amount
  );
end
$$;

revoke all on function public.calculate_fiscal_line_components(bigint, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.calculate_fiscal_order_snapshot(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.get_checkout_fiscal_profile(uuid) from public, anon, authenticated;
grant execute on function public.get_checkout_fiscal_profile(uuid) to authenticated;

do $$
declare
  definition text;
  original_definition text;
begin
  original_definition := replace(
    pg_get_functiondef(
      'public.create_order(uuid,jsonb,text,uuid,text,text,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  definition := replace(
    original_definition,
    '  line_rows jsonb;',
    '  line_rows jsonb;' || E'\n' ||
    '  supplied_fiscal_snapshot jsonb;' || E'\n' ||
    '  fiscal_snapshot jsonb;' || E'\n' ||
    '  has_pinned_fiscal_snapshot boolean;' || E'\n' ||
    '  fiscal_date date;'
  );
  definition := replace(
    definition,
    E'  for item_line in select value from jsonb_array_elements(p_items) as input(value) loop',
    E'  has_pinned_fiscal_snapshot := (p_items->0) ? ''fiscalSnapshot'';' || E'\n' ||
    E'  supplied_fiscal_snapshot := p_items->0->''fiscalSnapshot'';' || E'\n' ||
    E'  if supplied_fiscal_snapshot = ''null''::jsonb then supplied_fiscal_snapshot := null; end if;' || E'\n' ||
    E'  if supplied_fiscal_snapshot is not null and (' ||
    E'jsonb_typeof(supplied_fiscal_snapshot) <> ''object'' or ' ||
    E'supplied_fiscal_snapshot->>''storeId'' <> actor.store_id::text) then' || E'\n' ||
    E'    raise exception ''Offline fiscal snapshot belongs to another store or is invalid.'';' || E'\n' ||
    E'  end if;' || E'\n' ||
    E'  for item_line in select value from jsonb_array_elements(p_items) as input(value) loop'
  );
  definition := replace(
    definition,
    E'  end loop;' || E'\n\n' ||
    E'  if effective_payment = ''tab'' and target_customer.credit_limit_millimes is not null then',
    E'  end loop;' || E'\n\n' ||
    E'  fiscal_date := coalesce((supplied_fiscal_snapshot->>''transactionDate'')::date, business_day);' || E'\n' ||
    E'  if fiscal_date > business_day or fiscal_date < (target_shift.opened_at at time zone target_store.timezone)::date then' || E'\n' ||
    E'    raise exception ''Fiscal transaction date is outside the open shift business period.'';' || E'\n' ||
    E'  end if;' || E'\n' ||
    E'  fiscal_snapshot := public.calculate_fiscal_order_snapshot(actor.store_id, fiscal_date, prepared_lines);' || E'\n' ||
    E'  if has_pinned_fiscal_snapshot and supplied_fiscal_snapshot is null and fiscal_snapshot is not null then' || E'\n' ||
    E'    raise exception ''Checkout preview differs from current fiscal configuration; refresh POS and retry.'';' || E'\n' ||
    E'  end if;' || E'\n' ||
    E'  if supplied_fiscal_snapshot is not null and (fiscal_snapshot is null or ' ||
    E'jsonb_strip_nulls(fiscal_snapshot) is distinct from jsonb_strip_nulls(supplied_fiscal_snapshot)) then' || E'\n' ||
    E'    raise exception ''Offline fiscal snapshot no longer matches the effective store rules; order needs attention.'';' || E'\n' ||
    E'  end if;' || E'\n' ||
    E'  if fiscal_snapshot is not null then' || E'\n' ||
    E'    total := (fiscal_snapshot->>''totalAmountMillimes'')::bigint;' || E'\n' ||
    E'    select jsonb_agg(jsonb_set(prepared.value, ''{line_total_millimes}'', fiscal.value->''totalAmountMillimes'') order by prepared.ordinality)' || E'\n' ||
    E'    into prepared_lines' || E'\n' ||
    E'    from jsonb_array_elements(prepared_lines) with ordinality as prepared(value, ordinality)' || E'\n' ||
    E'    join jsonb_array_elements(fiscal_snapshot->''lines'') with ordinality as fiscal(value, ordinality)' || E'\n' ||
    E'      on fiscal.ordinality = prepared.ordinality;' || E'\n' ||
    E'  end if;' || E'\n\n' ||
    E'  if effective_payment = ''tab'' and target_customer.credit_limit_millimes is not null then'
  );
  definition := replace(
    definition,
    E'    payment_method, customer_id, note, total_millimes' || E'\n' ||
    E'  ) values (',
    E'    payment_method, customer_id, note, total_millimes, fiscal_snapshot' || E'\n' ||
    E'  ) values ('
  );
  definition := replace(
    definition,
    E'    nullif(btrim(p_note), ''''), total' || E'\n' ||
    E'  ) returning * into order_row;',
    E'    nullif(btrim(p_note), ''''), total, fiscal_snapshot' || E'\n' ||
    E'  ) returning * into order_row;'
  );
  if definition = original_definition
    or position('calculate_fiscal_order_snapshot(actor.store_id' in definition) = 0
    or position('total_millimes, fiscal_snapshot' in definition) = 0 then
    raise exception 'Could not safely extend create_order with atomic fiscal calculation.';
  end if;
  execute definition;
end
$$;

update public.app_schema_version
set version = 20261125120000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
