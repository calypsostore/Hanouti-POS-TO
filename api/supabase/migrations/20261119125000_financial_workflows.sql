create or replace function public.record_supplier_payment(
  p_supplier_id uuid,
  p_expense_id uuid,
  p_amount_millimes bigint,
  p_date date
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  supplier public.suppliers%rowtype;
  expense public.expenses%rowtype;
  amount_owed bigint;
  expense_remaining bigint;
  result public.supplier_payments%rowtype;
begin
  select * into actor from public.profiles where id = (select auth.uid()) and is_active;
  if actor.id is null or actor.role <> 'owner' then
    raise exception 'Only a store owner can record supplier payments.' using errcode = '42501';
  end if;
  select * into supplier from public.suppliers
  where id = p_supplier_id and store_id = actor.store_id
  for update;
  if supplier.id is null then
    raise exception 'Supplier could not be found in this store.';
  end if;
  if p_amount_millimes is null or p_amount_millimes <= 0 or p_date is null then
    raise exception 'Supplier payment details are invalid.';
  end if;

  select
    coalesce(sum(e.amount_millimes), 0)
    - coalesce(sum(greatest(
      e.paid_millimes,
      (select coalesce(sum(p.amount_millimes), 0)
       from public.supplier_payments p
       where p.expense_id = e.id)
    )), 0)
    - coalesce((
      select sum(p.amount_millimes)
      from public.supplier_payments p
      where p.supplier_id = supplier.id and p.expense_id is null
    ), 0)
  into amount_owed
  from public.expenses e
  where e.store_id = supplier.store_id and e.supplier_id = supplier.id;

  if p_amount_millimes > greatest(0, amount_owed) then
    raise exception 'Payment cannot exceed the amount owed to this supplier.';
  end if;
  if p_expense_id is not null then
    select * into expense from public.expenses
    where id = p_expense_id
      and store_id = supplier.store_id
      and supplier_id = supplier.id
    for update;
    if expense.id is null then
      raise exception 'Supplier purchase could not be found.';
    end if;
    select expense.amount_millimes - greatest(
      expense.paid_millimes,
      coalesce(sum(p.amount_millimes), 0)
    )
    into expense_remaining
    from public.supplier_payments p
    where p.expense_id = expense.id;
    if p_amount_millimes > greatest(0, coalesce(expense_remaining, 0)) then
      raise exception 'Payment cannot exceed the remaining balance on this purchase.';
    end if;
  end if;

  insert into public.supplier_payments (store_id, supplier_id, expense_id, amount_millimes, date)
  values (supplier.store_id, supplier.id, expense.id, p_amount_millimes, p_date)
  returning * into result;
  if expense.id is not null then
    update public.expenses
    set paid_millimes = least(expense.amount_millimes, expense.paid_millimes + p_amount_millimes)
    where id = expense.id;
  end if;
  return result;
end
$$;

revoke all on function public.record_supplier_payment(uuid, uuid, bigint, date) from public, anon;
grant execute on function public.record_supplier_payment(uuid, uuid, bigint, date) to authenticated;
