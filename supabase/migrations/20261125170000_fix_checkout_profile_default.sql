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

update public.app_schema_version
set version = 20261125170000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
