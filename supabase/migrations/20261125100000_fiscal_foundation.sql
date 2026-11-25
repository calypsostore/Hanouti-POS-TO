alter table public.catalog_items
  add constraint catalog_items_store_id_id_key unique (store_id, id);

alter table public.categories
  add constraint categories_store_id_id_key unique (store_id, id);

create table public.fiscal_profiles (
  store_id uuid primary key references public.stores(store_id) on delete cascade,
  review_status text not null default 'unconfigured'
    check (review_status in ('unconfigured', 'draft', 'review_required', 'confirmed')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((review_status = 'confirmed') = (reviewed_at is not null and reviewed_by is not null))
);

create table public.fiscal_tax_rules (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  rule_id text not null check (length(trim(rule_id)) > 0),
  version integer not null check (version > 0),
  name text not null check (length(trim(name)) > 0),
  tax_type text not null check (tax_type in ('vat', 'consumption', 'stamp', 'withholding', 'other')),
  calculation_method text not null check (calculation_method in ('percentage', 'fixed')),
  rate_ppm bigint,
  fixed_amount_millimes bigint,
  fixed_amount_per_unit boolean not null default true,
  compound_with_prior_taxes boolean not null default false,
  priority integer not null check (priority >= 0),
  effective_from date not null,
  effective_through date,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  legal_reference text,
  legal_reviewed boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (store_id, rule_id, version),
  check (effective_through is null or effective_through >= effective_from),
  check (
    (calculation_method = 'percentage' and rate_ppm is not null and rate_ppm > 0 and fixed_amount_millimes is null)
    or
    (calculation_method = 'fixed' and fixed_amount_millimes is not null and fixed_amount_millimes > 0 and rate_ppm is null)
  ),
  check (status <> 'active' or (legal_reviewed and length(trim(coalesce(legal_reference, ''))) > 0))
);

create index fiscal_tax_rules_effective_lookup
  on public.fiscal_tax_rules (store_id, status, effective_from, effective_through, priority);

create table public.catalog_item_tax_assignments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  item_id uuid,
  category_id uuid,
  tax_type text not null check (tax_type in ('vat', 'consumption', 'stamp', 'withholding', 'other')),
  treatment text not null check (treatment in ('unconfigured', 'taxable', 'exempt', 'outside_scope', 'suspended', 'special')),
  rule_id text,
  rule_version integer,
  legal_reference text,
  evidence_reference text,
  note text,
  effective_from date not null,
  effective_through date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((item_id is null) <> (category_id is null)),
  check ((rule_id is null) = (rule_version is null)),
  check (
    (treatment in ('taxable', 'special') and rule_id is not null)
    or
    (treatment in ('unconfigured', 'exempt', 'outside_scope', 'suspended') and rule_id is null)
  ),
  check (
    treatment in ('taxable', 'unconfigured')
    or length(trim(coalesce(legal_reference, ''))) > 0
    or length(trim(coalesce(evidence_reference, ''))) > 0
  ),
  check (effective_through is null or effective_through >= effective_from),
  foreign key (store_id, item_id) references public.catalog_items(store_id, id) on delete cascade,
  foreign key (store_id, category_id) references public.categories(store_id, id) on delete cascade,
  foreign key (store_id, rule_id, rule_version)
    references public.fiscal_tax_rules(store_id, rule_id, version)
);

create index catalog_item_tax_assignments_lookup
  on public.catalog_item_tax_assignments (store_id, item_id, category_id, tax_type, effective_from);

create function public.validate_fiscal_assignment_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_rule public.fiscal_tax_rules%rowtype;
begin
  if new.rule_id is null then
    return new;
  end if;
  select * into selected_rule
  from public.fiscal_tax_rules
  where store_id = new.store_id and rule_id = new.rule_id and version = new.rule_version;
  if not found or selected_rule.status <> 'active' or not selected_rule.legal_reviewed
    or new.effective_from < selected_rule.effective_from
    or (selected_rule.effective_through is not null and
      (new.effective_through is null or new.effective_through > selected_rule.effective_through)) then
    raise exception 'Fiscal assignment must reference an active, reviewed rule covering its effective dates.';
  end if;
  return new;
end
$$;

create trigger catalog_item_tax_assignments_rule_check
before insert on public.catalog_item_tax_assignments
for each row execute function public.validate_fiscal_assignment_rule();

alter table public.orders
  add column fiscal_snapshot jsonb,
  add constraint orders_fiscal_snapshot_object_check
    check (fiscal_snapshot is null or jsonb_typeof(fiscal_snapshot) = 'object');

create function public.reject_immutable_fiscal_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Fiscal versions are immutable; create a new version instead.';
end
$$;

create trigger fiscal_tax_rules_append_only
before update or delete on public.fiscal_tax_rules
for each row execute function public.reject_immutable_fiscal_change();

create function public.reject_order_fiscal_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.fiscal_snapshot is distinct from new.fiscal_snapshot then
    raise exception 'A completed order fiscal snapshot is immutable.';
  end if;
  return new;
end
$$;

create trigger orders_fiscal_snapshot_immutable
before update of fiscal_snapshot on public.orders
for each row execute function public.reject_order_fiscal_snapshot_change();

alter table public.fiscal_profiles enable row level security;
create policy fiscal_profiles_owner_select on public.fiscal_profiles
  for select to authenticated using (public.is_store_owner(store_id));
create policy fiscal_profiles_owner_insert on public.fiscal_profiles
  for insert to authenticated with check (public.is_store_owner(store_id));
create policy fiscal_profiles_owner_update on public.fiscal_profiles
  for update to authenticated using (public.is_store_owner(store_id))
  with check (public.is_store_owner(store_id));

alter table public.fiscal_tax_rules enable row level security;
create policy fiscal_tax_rules_owner_select on public.fiscal_tax_rules
  for select to authenticated using (public.is_store_owner(store_id));
create policy fiscal_tax_rules_checkout_select on public.fiscal_tax_rules
  for select to authenticated using (
    store_id = (select public.current_store_id())
    and status = 'active'
    and legal_reviewed
    and public.has_store_permission('take_orders')
  );
create policy fiscal_tax_rules_owner_insert on public.fiscal_tax_rules
  for insert to authenticated with check (public.is_store_owner(store_id));

alter table public.catalog_item_tax_assignments enable row level security;
create policy catalog_item_tax_assignments_owner_select on public.catalog_item_tax_assignments
  for select to authenticated using (public.is_store_owner(store_id));
create policy catalog_item_tax_assignments_checkout_select on public.catalog_item_tax_assignments
  for select to authenticated using (
    store_id = (select public.current_store_id())
    and public.has_store_permission('take_orders')
  );
create policy catalog_item_tax_assignments_owner_insert on public.catalog_item_tax_assignments
  for insert to authenticated with check (public.is_store_owner(store_id));

grant select, insert, update on public.fiscal_profiles to authenticated;
grant select, insert on public.fiscal_tax_rules to authenticated;
grant select, insert on public.catalog_item_tax_assignments to authenticated;

comment on table public.fiscal_profiles is
  'Store-entered fiscal identity and review metadata; not an automated legal determination.';
comment on table public.fiscal_tax_rules is
  'Append-only, store-scoped, legally reviewed effective-dated fiscal rule versions.';
comment on table public.catalog_item_tax_assignments is
  'Store-scoped product/category fiscal treatment and evidence, effective-dated.';
comment on column public.orders.fiscal_snapshot is
  'Immutable calculation snapshot; null for historical and legacy orders.';

update public.app_schema_version
set version = 20261125100000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
