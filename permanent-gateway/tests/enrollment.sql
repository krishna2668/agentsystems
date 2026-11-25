set role service_role;
do $$
declare
 owner uuid := '00000000-0000-4000-8000-000000000001';
 other uuid := gen_random_uuid();
 rid uuid := gen_random_uuid();
 ph bytea := sha256('TESTCODE');
 pk bytea := decode(repeat('35',91),'hex');
 d uuid; a jsonb;
begin
 assert (public.worker_enrollment_start(rid,ph,pk)->>'state')='pending';
 assert (public.worker_enrollment_start(rid,ph,pk)->>'status')::int=200;
 assert (public.worker_enrollment_start(rid,sha256('OTHER'),pk)->>'status')::int=409;
 assert (public.worker_enrollment_start(gen_random_uuid(),sha256('OTHER'),pk)->>'status')::int=409;
 assert (public.worker_enrollment_status(rid)->>'state')='pending';
 assert public.worker_enrollment_lookup(other,ph) is null;
 assert (public.worker_enrollment_approve(other,rid,ph)->>'status')::int=403;
 assert (public.worker_enrollment_approve(owner,rid,sha256('OTHER'))->>'status')::int=404;
 assert (public.worker_enrollment_lookup(owner,ph)->>'request_id')::uuid=rid;
 a:=public.worker_enrollment_approve(owner,rid,ph);
 assert (a->>'status')::int=201;
 d:=(a->>'device_id')::uuid;
 assert (public.worker_enrollment_approve(owner,rid,ph)->>'device_id')::uuid=d;
 assert (public.worker_enrollment_status(rid)->>'device_id')::uuid=d;
 assert (public.worker_enrollment_start(rid,ph,pk)->>'device_id')::uuid=d;
 assert (public.worker_revoke(owner,d)->>'status')::int=200;
 assert (public.worker_enrollment_status(rid)->>'status')::int=403;
 assert (public.worker_enrollment_approve(owner,rid,ph)->>'status')::int=403;
 assert (public.worker_enrollment_start(rid,ph,pk)->>'status')::int=403;
 rid:=gen_random_uuid(); pk:=decode(repeat('36',91),'hex'); ph:=sha256('EXPIRED');
 assert (public.worker_enrollment_start(rid,ph,pk)->>'status')::int=201;
 update worker_private.enrollments set expires_at=now()-interval '1 second' where id=rid;
 assert (public.worker_enrollment_status(rid)->>'status')::int=410;
 assert (public.worker_enrollment_approve(owner,rid,ph)->>'status')::int=410;
 assert public.worker_enrollment_lookup(owner,ph) is null;
 assert (public.worker_enrollment_start(gen_random_uuid(),sha256('RENEWED'),pk)->>'status')::int=201;
 raise notice 'PASS: device proof contract, duplicate requests, owner binding, approval recovery, expiry, revocation';
end $$;
reset role;
do $$ begin
 assert not has_table_privilege('anon','worker_private.enrollments','SELECT');
 assert not has_function_privilege('authenticated','public.worker_enrollment_approve(uuid,uuid,bytea)','EXECUTE');
 assert not has_function_privilege('anon','public.worker_enrollment_status(uuid)','EXECUTE');
 assert has_function_privilege('service_role','public.worker_enrollment_start(uuid,bytea,bytea)','EXECUTE');
 raise notice 'PASS: enrollment private and restricted RPCs';
end $$;
