insert into public.store_settings (store_id)
select store_id
from public.stores
on conflict (store_id) do nothing;

drop policy if exists store_settings_member_select on public.store_settings;
create policy store_settings_member_select on public.store_settings for select to authenticated
  using (store_id = (select public.current_store_id()));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'store_settings'
  ) then
    alter publication supabase_realtime add table public.store_settings;
  end if;
end
$$;

update public.app_schema_version
set version = 20261120201000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
