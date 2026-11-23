drop policy if exists activity_logs_owner_insert on public.activity_logs;
drop policy if exists activity_logs_owner_update on public.activity_logs;
drop policy if exists activity_logs_owner_delete on public.activity_logs;
drop policy if exists reports_owner_insert on public.reports;
drop policy if exists reports_owner_update on public.reports;
drop policy if exists reports_owner_delete on public.reports;
drop policy if exists tabs_owner_insert on public.tabs;
drop policy if exists tabs_owner_update on public.tabs;
drop policy if exists tabs_owner_delete on public.tabs;
drop policy if exists cash_movements_owner_insert on public.cash_movements;
drop policy if exists cash_movements_owner_update on public.cash_movements;
drop policy if exists cash_movements_owner_delete on public.cash_movements;
drop policy if exists comps_owner_insert on public.comps;
drop policy if exists comps_owner_update on public.comps;
drop policy if exists comps_owner_delete on public.comps;
drop policy if exists shift_void_adjustments_owner_insert on public.shift_void_adjustments;
drop policy if exists shift_void_adjustments_owner_update on public.shift_void_adjustments;
drop policy if exists shift_void_adjustments_owner_delete on public.shift_void_adjustments;
drop policy if exists item_history_owner_insert on public.item_history;
drop policy if exists item_history_owner_update on public.item_history;
drop policy if exists item_history_owner_delete on public.item_history;
drop policy if exists notifications_owner_insert on public.notifications;
drop policy if exists notifications_owner_update on public.notifications;
drop policy if exists notifications_owner_delete on public.notifications;

do $$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ) then
    raise exception 'Every table in the public schema must have row level security enabled.';
  end if;
end
$$;

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; % is not allowed.', tg_table_name, lower(tg_op);
end
$$;

create trigger activity_logs_append_only
before update or delete on public.activity_logs
for each row execute function public.reject_append_only_mutation();

create trigger reports_append_only
before update or delete on public.reports
for each row execute function public.reject_append_only_mutation();

create trigger activity_logs_prevent_truncate
before truncate on public.activity_logs
for each statement execute function public.reject_append_only_mutation();

create trigger reports_prevent_truncate
before truncate on public.reports
for each statement execute function public.reject_append_only_mutation();
