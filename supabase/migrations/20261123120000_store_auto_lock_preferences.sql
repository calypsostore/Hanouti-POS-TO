alter table public.stores
  drop constraint if exists stores_staff_auto_lock_minutes_check;

alter table public.stores
  add constraint stores_staff_auto_lock_minutes_check
  check (staff_auto_lock_minutes between 0 and 60);

alter table public.stores
  add column if not exists owner_auto_lock_minutes integer not null default 0
  check (owner_auto_lock_minutes between 0 and 60);

update public.app_schema_version
set version = 20261123120000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
