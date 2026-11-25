do $$
declare
  original_definition text;
  definition text;
begin
  original_definition := replace(
    pg_get_functiondef(
      'public.calculate_fiscal_order_snapshot(uuid,date,jsonb)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  definition := replace(original_definition, '  tax_type text;', '  selected_tax_type text;');
  definition := replace(
    definition,
    'for tax_type in select unnest(required_tax_types) loop',
    'for selected_tax_type in select unnest(required_tax_types) loop'
  );
  definition := replace(
    definition,
    'assignment.tax_type = tax_type',
    'assignment.tax_type = selected_tax_type'
  );
  definition := replace(definition, 'line_index, tax_type', 'line_index, selected_tax_type');
  definition := replace(
    definition,
    E'''taxType'', tax_type,',
    E'''taxType'', selected_tax_type,'
  );
  definition := replace(
    definition,
    'rule_row.tax_type <> tax_type',
    'rule_row.tax_type <> selected_tax_type'
  );

  if definition = original_definition
    or position('for selected_tax_type in select unnest(required_tax_types) loop' in definition) = 0
    or position('  tax_type text;' in definition) > 0
    or position('assignment.tax_type = tax_type' in definition) > 0
    or position('line_index, tax_type' in definition) > 0
    or position(E'''taxType'', tax_type,' in definition) > 0
    or position('rule_row.tax_type <> tax_type' in definition) > 0 then
    if position('  selected_tax_type text;' in original_definition) = 0 then
      raise exception 'Could not safely disambiguate fiscal tax type resolution.';
    end if;
  else
    execute definition;
  end if;
end
$$;

update public.app_schema_version
set version = 20261125130000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
