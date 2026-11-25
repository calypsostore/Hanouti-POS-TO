create function public.initialize_store_fiscal_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fiscal_profiles (
    store_id,
    review_status,
    data,
    updated_at
  )
  values (
    new.store_id,
    'unconfigured',
    jsonb_build_object(
      'pricingMode', 'inclusive',
      'defaultVatRatePpm', 190000,
      'requiredTaxTypes', '[]'::jsonb,
      'vatStatus', 'unknown',
      'declarationPeriod', 'unknown'
    ),
    now()
  )
  on conflict (store_id) do nothing;
  return new;
end;
$$;

drop trigger if exists stores_initialize_fiscal_defaults on public.stores;
create trigger stores_initialize_fiscal_defaults
after insert on public.stores
for each row execute function public.initialize_store_fiscal_defaults();

insert into public.fiscal_profiles (store_id, review_status, data, updated_at)
select
  s.store_id,
  'unconfigured',
  jsonb_build_object(
    'pricingMode', 'inclusive',
    'defaultVatRatePpm', 190000,
    'requiredTaxTypes', '[]'::jsonb,
    'vatStatus', 'unknown',
    'declarationPeriod', 'unknown'
  ),
  now()
from public.stores s
left join public.fiscal_profiles fp on fp.store_id = s.store_id
where fp.store_id is null
on conflict (store_id) do nothing;

create or replace function public.reject_immutable_fiscal_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft'
    and new.status = 'active'
    and new.legal_reviewed
    and length(trim(coalesce(new.legal_reference, ''))) > 0
    and old.store_id = new.store_id
    and old.rule_id = new.rule_id
    and old.version = new.version
    and old.name = new.name
    and old.tax_type = new.tax_type
    and old.calculation_method = new.calculation_method
    and old.rate_ppm is not distinct from new.rate_ppm
    and old.fixed_amount_millimes is not distinct from new.fixed_amount_millimes
    and old.fixed_amount_per_unit is not distinct from new.fixed_amount_per_unit
    and old.compound_with_prior_taxes is not distinct from new.compound_with_prior_taxes
    and old.priority = new.priority
    and old.effective_from = new.effective_from
    and old.effective_through is not distinct from new.effective_through
    and old.created_by is not distinct from new.created_by
    and old.created_at is not distinct from new.created_at
  then
    return new;
  end if;
  raise exception 'Fiscal versions are immutable; create a new version instead.';
end;
$$;

create function public.confirm_fiscal_tax_rule(
  p_store_id uuid,
  p_rule_id text,
  p_version integer,
  p_legal_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_row public.fiscal_tax_rules%rowtype;
begin
  if p_store_id is null
    or p_store_id is distinct from public.current_store_id()
    or public.current_user_role() <> 'owner'
  then
    raise exception 'Only the store owner can confirm a fiscal tax rule.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_legal_reference, ''))) = 0 then
    raise exception 'A legal reference is required to activate a fiscal tax rule.';
  end if;
  select * into rule_row
  from public.fiscal_tax_rules
  where store_id = p_store_id
    and rule_id = p_rule_id
    and version = p_version
    and status = 'draft';
  if not found then
    raise exception 'The requested tax rule is not an available draft.';
  end if;
  update public.fiscal_tax_rules
  set status = 'active',
      legal_reviewed = true,
      legal_reference = btrim(p_legal_reference)
  where store_id = p_store_id
    and rule_id = p_rule_id
    and version = p_version
  returning * into rule_row;
  return jsonb_build_object(
    'storeId', rule_row.store_id,
    'ruleId', rule_row.rule_id,
    'version', rule_row.version,
    'status', rule_row.status,
    'legalReviewed', rule_row.legal_reviewed
  );
end;
$$;

revoke all on function public.confirm_fiscal_tax_rule(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.confirm_fiscal_tax_rule(uuid, text, integer, text) to authenticated;

create or replace function public.get_checkout_fiscal_profile(p_store_id uuid)
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
    return jsonb_build_object(
      'storeId', p_store_id,
      'reviewStatus', 'unconfigured',
      'requiredTaxTypes', '[]'::jsonb,
      'pricingMode', 'inclusive',
      'updatedAt', now()
    );
  end if;
  return jsonb_build_object(
    'storeId', profile_row.store_id,
    'reviewStatus', profile_row.review_status,
    'requiredTaxTypes', coalesce(profile_row.data->'requiredTaxTypes', '[]'::jsonb),
    'pricingMode', coalesce(profile_row.data->'pricingMode', '"inclusive"'::jsonb),
    'updatedAt', profile_row.updated_at
  );
end;
$$;

revoke all on function public.get_checkout_fiscal_profile(uuid) from public, anon, authenticated;
grant execute on function public.get_checkout_fiscal_profile(uuid) to authenticated;

do $$
declare
  definition text;
  original_definition text;
begin
  original_definition := replace(
    pg_get_functiondef(
      'public.calculate_fiscal_order_snapshot(uuid,date,jsonb)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  definition := replace(
    original_definition,
    '  price_mode text;',
    '  price_mode text;' || E'\n' ||
    '  combined_rate_ppm numeric := 0;' || E'\n' ||
    '  fixed_tax_millimes numeric := 0;' || E'\n' ||
    '  residual_tax numeric;' || E'\n' ||
    '  taxable_component_count integer;' || E'\n' ||
    '  taxable_component_index integer := 0;' || E'\n' ||
    '  rewritten_components jsonb := ''[]''::jsonb;' || E'\n' ||
    '  tax_component jsonb;'
  );
  definition := replace(
    definition,
    E'    line_net := line_target;' || E'\n' ||
    E'    if price_mode = ''inclusive'' then' || E'\n' ||
    E'      low_value := 0;' || E'\n' ||
    E'      high_value := line_target::bigint;' || E'\n' ||
    E'      while low_value < high_value loop' || E'\n' ||
    E'        middle_value := low_value + ((high_value - low_value) / 2);' || E'\n' ||
    E'        calculated := public.calculate_fiscal_line_components(' || E'\n' ||
    E'          middle_value, (line_row->>''quantity'')::integer, resolved_rules, treatments' || E'\n' ||
    E'        );' || E'\n' ||
    E'        if (calculated->>''totalAmountMillimes'')::numeric >= line_target then' || E'\n' ||
    E'          high_value := middle_value;' || E'\n' ||
    E'        else' || E'\n' ||
    E'          low_value := middle_value + 1;' || E'\n' ||
    E'        end if;' || E'\n' ||
    E'      end loop;' || E'\n' ||
    E'      line_net := low_value;' || E'\n' ||
    E'    end if;',
    E'    line_net := line_target;' || E'\n' ||
    E'    if price_mode = ''inclusive'' then' || E'\n' ||
    E'      combined_rate_ppm := 0;' || E'\n' ||
    E'      fixed_tax_millimes := 0;' || E'\n' ||
    E'      for tax_component in select value from jsonb_array_elements(resolved_rules) loop' || E'\n' ||
    E'        if tax_component->>''calculationMethod'' = ''percentage'' then' || E'\n' ||
    E'          combined_rate_ppm := combined_rate_ppm + coalesce((tax_component->>''ratePpm'')::numeric, 0);' || E'\n' ||
    E'        elsif tax_component->>''calculationMethod'' = ''fixed'' then' || E'\n' ||
    E'          fixed_tax_millimes := fixed_tax_millimes +' || E'\n' ||
    E'            (tax_component->>''fixedAmountMillimes'')::numeric *' || E'\n' ||
    E'            case when coalesce((tax_component->>''fixedAmountPerUnit'')::boolean, true)' || E'\n' ||
    E'              then (line_row->>''quantity'')::numeric else 1 end;' || E'\n' ||
    E'        end if;' || E'\n' ||
    E'      end loop;' || E'\n' ||
    E'      if combined_rate_ppm > 0 then' || E'\n' ||
    E'        line_net := floor((' || E'\n' ||
    E'          line_target * 1000000 + (1000000 + combined_rate_ppm) / 2' || E'\n' ||
    E'        ) / (1000000 + combined_rate_ppm))::bigint;' || E'\n' ||
    E'      elsif fixed_tax_millimes > 0 then' || E'\n' ||
    E'        line_net := greatest(line_target - fixed_tax_millimes, 0)::bigint;' || E'\n' ||
    E'      end if;' || E'\n' ||
    E'    end if;'
  );
  definition := replace(
    definition,
    E'    line_tax := (calculated->>''totalTaxMillimes'')::numeric;' || E'\n' ||
    E'    line_gross := (calculated->>''totalAmountMillimes'')::numeric;' || E'\n' ||
    E'    if price_mode = ''inclusive'' and line_gross <> line_target then' || E'\n' ||
    E'      raise exception ''Order line % inclusive price cannot be reconciled to its effective tax rules.'', line_index;' || E'\n' ||
    E'    end if;',
    E'    line_tax := (calculated->>''totalTaxMillimes'')::numeric;' || E'\n' ||
    E'    line_gross := (calculated->>''totalAmountMillimes'')::numeric;' || E'\n' ||
    E'    if price_mode = ''inclusive'' then' || E'\n' ||
    E'      residual_tax := line_target - line_net;' || E'\n' ||
    E'      line_tax := residual_tax;' || E'\n' ||
    E'      line_gross := line_target;' || E'\n' ||
    E'      select count(*) into taxable_component_count' || E'\n' ||
    E'      from jsonb_array_elements(calculated->''components'') component' || E'\n' ||
    E'      where component->>''treatment'' in (''taxable'', ''special'');' || E'\n' ||
    E'      taxable_component_index := 0;' || E'\n' ||
    E'      rewritten_components := ''[]''::jsonb;' || E'\n' ||
    E'      for tax_component in select value from jsonb_array_elements(calculated->''components'') loop' || E'\n' ||
    E'        if tax_component->>''treatment'' in (''taxable'', ''special'') then' || E'\n' ||
    E'          taxable_component_index := taxable_component_index + 1;' || E'\n' ||
    E'          if taxable_component_index = taxable_component_count then' || E'\n' ||
    E'            tax_component := jsonb_set(tax_component, ''{amountMillimes}'', to_jsonb(residual_tax));' || E'\n' ||
    E'          end if;' || E'\n' ||
    E'        end if;' || E'\n' ||
    E'        rewritten_components := rewritten_components || jsonb_build_array(tax_component);' || E'\n' ||
    E'      end loop;' || E'\n' ||
    E'    end if;'
  );
  definition := replace(
    definition,
    E'      ''taxes'', calculated->''components'',',
    E'      ''taxes'', case when price_mode = ''inclusive'' then rewritten_components else calculated->''components'' end,'
  );
  if definition = original_definition
    or position('combined_rate_ppm' in definition) = 0
    or position('rewritten_components' in definition) = 0 then
    raise exception 'Could not safely replace inclusive fiscal rounding in SQL.';
  end if;
  execute definition;
end;
$$;

update public.app_schema_version
set version = 20261125160000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
