grant select (owner_auto_lock_minutes)
on table public.stores
to authenticated;

update public.app_schema_version
set version = 20261123130000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
