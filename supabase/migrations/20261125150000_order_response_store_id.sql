do $$
declare
  definition text;
  original_definition text;
begin
  original_definition := replace(
    pg_get_functiondef(
      'public.create_order(uuid,jsonb,text,uuid,text,text,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  if position('to_jsonb(order_row)' in original_definition) = 0 then
    raise exception 'Could not locate the create_order response order row.';
  end if;
  definition := replace(
    original_definition,
    'to_jsonb(order_row) - ''store_id''',
    'to_jsonb(order_row)'
  );
  execute definition;
end
$$;

update public.app_schema_version
set version = 20261125150000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
