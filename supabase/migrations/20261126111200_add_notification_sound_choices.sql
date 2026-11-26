alter table public.notification_sound_preferences
  alter column general_sound set default 'alert6',
  alter column void_sound set default 'alert7';

alter table public.notification_sound_preferences
  drop constraint if exists notification_sound_preferences_general_sound_check,
  drop constraint if exists notification_sound_preferences_void_sound_check;

alter table public.notification_sound_preferences
  add constraint notification_sound_preferences_general_sound_check
    check (general_sound in ('alert1', 'alert2', 'alert3', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8')),
  add constraint notification_sound_preferences_void_sound_check
    check (void_sound in ('alert1', 'alert2', 'alert3', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8'));

update public.app_schema_version
set version = 20261126111200,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
