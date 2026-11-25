set role service_role;
do $$
declare a uuid:='00000000-0000-4000-8000-000000000001'; b uuid:='00000000-0000-4000-8000-000000000002'; x jsonb;
begin
 x:=public.worker_list_devices(a);
 assert jsonb_array_length(x)=1 and (x->0->>'revoked')::boolean;
 assert not ((x->0) ? 'public_key');
 assert jsonb_array_length(public.worker_list_devices(b))=1;
 assert (public.worker_list_devices(b)->0->>'id')<>(x->0->>'id');
 assert public.worker_list_devices(gen_random_uuid())='[]'::jsonb;
 assert (public.worker_pairing_status(a)->>'enrolled')::integer=1;
 assert (public.worker_pairing_status(b)->>'enrolled')::integer=1;
 assert public.worker_pairing_status(gen_random_uuid())='{"pending":0,"enrolled":0}'::jsonb;
 raise notice 'PASS: owner-scoped discovery, revoked state, no key exposure, pairing counts';
end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.worker_list_devices(uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.worker_pairing_status(uuid)','EXECUTE');
 assert has_function_privilege('service_role','public.worker_list_devices(uuid)','EXECUTE');
 raise notice 'PASS: discovery API grants';
end $$;
