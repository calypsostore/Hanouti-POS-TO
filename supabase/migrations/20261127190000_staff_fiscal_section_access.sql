create policy categories_fiscal_staff_read on public.categories for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));
create policy catalog_items_fiscal_staff_read on public.catalog_items for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));
create policy catalog_modifiers_fiscal_staff_read on public.catalog_modifiers for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));

do $$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := pg_get_functiondef('public.confirm_fiscal_tax_rule(uuid,text,integer,text)'::regprocedure);
  original := 'or public.current_user_role() <> ''owner''';
  replacement := 'or (public.current_user_role() <> ''owner'' and not public.has_store_permission(''manage_fiscal''))';
  if position(original in definition) = 0 then
    raise exception 'Could not locate fiscal tax-rule confirmation authorization check.';
  end if;
  definition := replace(definition, original, replacement);

  original := 'Only the store owner can confirm a fiscal tax rule.';
  replacement := 'Only an owner or delegated fiscal manager can confirm a fiscal tax rule.';
  if position(original in definition) = 0 then
    raise exception 'Could not locate fiscal tax-rule confirmation error message.';
  end if;
  execute replace(definition, original, replacement);
end
$$;
