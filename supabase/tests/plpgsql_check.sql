create extension if not exists plpgsql_check;

select p.oid::regprocedure as fn, c.*
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
cross join lateral plpgsql_check_function_tb(p.oid) c
where n.nspname = 'public'
  and l.lanname = 'plpgsql'
  and p.prorettype <> 'trigger'::regtype
order by fn;
