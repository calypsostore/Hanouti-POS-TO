alter table public.notification_sound_preferences
  drop constraint if exists notification_sound_preferences_general_sound_check,
  drop constraint if exists notification_sound_preferences_void_sound_check;

alter table public.notification_sound_preferences
  add constraint notification_sound_preferences_general_sound_check
    check (general_sound in ('alert1', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8', 'silent')),
  add constraint notification_sound_preferences_void_sound_check
    check (void_sound in ('alert1', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8', 'silent'));

create function public.prevent_duplicate_periodic_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'customer_overdue'
    and new.user_id is not null
    and new.entity_id is not null
    and new.due_at is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.store_id::text || ':' || new.user_id::text || ':' || new.type || ':' ||
      new.entity_id || ':' || extract(epoch from new.due_at)::text,
      0
    ));
    if exists (
      select 1
      from public.notifications existing
      where existing.store_id = new.store_id
        and existing.user_id = new.user_id
        and existing.type = new.type
        and existing.entity_id = new.entity_id
        and existing.due_at = new.due_at
    ) then
      return null;
    end if;
  elsif new.type = 'subscription_expiring'
    and new.user_id is not null
    and new.entity_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.store_id::text || ':' || new.user_id::text || ':' || new.type || ':' || new.entity_id,
      0
    ));
    if exists (
      select 1
      from public.notifications existing
      where existing.store_id = new.store_id
        and existing.user_id = new.user_id
        and existing.type = new.type
        and existing.entity_id = new.entity_id
    ) then
      return null;
    end if;
  end if;

  return new;
end
$$;

create trigger notifications_prevent_duplicate_periodic
before insert on public.notifications
for each row execute function public.prevent_duplicate_periodic_notifications();

revoke all on function public.prevent_duplicate_periodic_notifications() from public, anon, authenticated;

do $migration$
declare
  original_definition text;
  definition text;
begin
  original_definition := pg_catalog.pg_get_functiondef(
    'public.create_notification(uuid,text,text,text,uuid,text,text,text,uuid,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  );
  definition := replace(
    original_definition,
    'return to_jsonb(created);',
    'if created.id is null then return null; end if; return to_jsonb(created);'
  );
  if definition = original_definition
    or position('if created.id is null then return null;' in definition) = 0 then
    raise exception 'Could not safely update create_notification duplicate handling.';
  end if;
  execute definition;
end
$migration$;

update public.app_schema_version
set version = 20261127140000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
