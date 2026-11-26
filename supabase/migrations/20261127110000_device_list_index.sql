create index if not exists devices_store_created_id_idx
  on public.devices (store_id, created_at desc, id desc);
