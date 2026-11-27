do $migration$
declare
  target_constraint text;
begin
  select conname
  into target_constraint
  from pg_catalog.pg_constraint
  where conrelid = 'public.catalog_item_tax_assignments'::regclass
    and contype = 'c'
    and pg_catalog.pg_get_constraintdef(oid) ilike '%item_id is null%'
    and pg_catalog.pg_get_constraintdef(oid) ilike '%category_id is null%'
    and position('<>' in pg_catalog.pg_get_constraintdef(oid)) > 0;

  if target_constraint is null then
    raise exception 'Could not find the fiscal assignment item/category scope constraint.';
  end if;

  execute pg_catalog.format(
    'alter table public.catalog_item_tax_assignments drop constraint %I',
    target_constraint
  );
end
$migration$;

alter table public.catalog_item_tax_assignments
  add constraint catalog_item_tax_assignments_scope_check
  check (item_id is null or category_id is null);

do $migration$
declare
  original_definition text;
  definition text;
begin
  original_definition := pg_catalog.pg_get_functiondef(
    'public.calculate_fiscal_order_snapshot(uuid,date,jsonb)'::regprocedure
  );
  definition := original_definition;

  definition := replace(
    definition,
    $old_scope$
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
    $old_scope$,
    $new_scope$
      if match_count = 0 then
        select count(*) into match_count
        from public.catalog_item_tax_assignments assignment
        where assignment.store_id = p_store_id
          and assignment.tax_type = selected_tax_type
          and assignment.category_id = (line_row->>'category_id')::uuid
          and assignment.effective_from <= p_transaction_date
          and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
        if match_count = 0 then
          select count(*) into match_count
          from public.catalog_item_tax_assignments assignment
          where assignment.store_id = p_store_id
            and assignment.tax_type = selected_tax_type
            and assignment.item_id is null
            and assignment.category_id is null
            and assignment.effective_from <= p_transaction_date
            and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
          if match_count = 0 then
            return null;
          elsif match_count > 1 then
            raise exception 'Order line % has ambiguous all-products % classifications.', line_index, selected_tax_type;
          end if;
          select * into assignment_row
          from public.catalog_item_tax_assignments assignment
          where assignment.store_id = p_store_id
            and assignment.tax_type = selected_tax_type
            and assignment.item_id is null
            and assignment.category_id is null
            and assignment.effective_from <= p_transaction_date
            and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
        elsif match_count = 1 then
          select * into assignment_row
          from public.catalog_item_tax_assignments assignment
          where assignment.store_id = p_store_id
            and assignment.tax_type = selected_tax_type
            and assignment.category_id = (line_row->>'category_id')::uuid
            and assignment.effective_from <= p_transaction_date
            and (assignment.effective_through is null or assignment.effective_through >= p_transaction_date);
        else
          raise exception 'Order line % has ambiguous category-level % classifications.', line_index, selected_tax_type;
        end if;
      elsif match_count = 1 then
    $new_scope$
  );

  definition := replace(
    definition,
    $old_treatment$
      if assignment_row.treatment = 'unconfigured' then
        raise exception 'Order line % has an unconfigured % treatment.', line_index, selected_tax_type;
      end if;
    $old_treatment$,
    $new_treatment$
      if assignment_row.treatment = 'unconfigured' then
        return null;
      end if;
    $new_treatment$
  );

  if definition = original_definition
    or position('ambiguous all-products' in definition) = 0
    or position($marker$if assignment_row.treatment = 'unconfigured' then
        return null;$marker$ in definition) = 0 then
    raise exception 'Could not safely update fiscal checkout classification fallback.';
  end if;

  execute definition;
end
$migration$;

update public.app_schema_version
set version = 20261127130000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
