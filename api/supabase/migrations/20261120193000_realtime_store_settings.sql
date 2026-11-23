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
