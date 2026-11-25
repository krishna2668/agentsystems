begin;
-- Only authenticated gateway may use these; the owner ID is verified at the edge.
create function public.worker_list_devices(p_owner uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'revoked',revoked_at is not null) order by created_at,id),'[]'::jsonb)
 from worker_private.devices where owner_id=p_owner
$$;
create function public.worker_pairing_status(p_owner uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('pending',count(*) filter(where expires_at>clock_timestamp() and device_id is null),
 'enrolled',count(*) filter(where device_id is not null))
 from worker_private.pairings where owner_id=p_owner
$$;
revoke all on function public.worker_list_devices(uuid),public.worker_pairing_status(uuid) from public,anon,authenticated;
grant execute on function public.worker_list_devices(uuid),public.worker_pairing_status(uuid) to service_role;
commit;
