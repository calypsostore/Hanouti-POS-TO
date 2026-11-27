create or replace function public.enforce_order_note_permission()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.note is not null
    and length(btrim(new.note)) > 0
    and not (
      public.is_store_owner(new.store_id)
      or public.has_store_permission('add_order_note')
    ) then
    raise exception 'Your position does not allow order notes.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger orders_note_permission_insert
before insert on public.orders
for each row execute function public.enforce_order_note_permission();

create trigger orders_note_permission_update
before update of note on public.orders
for each row execute function public.enforce_order_note_permission();
