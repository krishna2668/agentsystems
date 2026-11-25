\set ON_ERROR_STOP on
begin;
set role service_role;
do $$
declare owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); job uuid; lease uuid;
        t bigint:=extract(epoch from clock_timestamp())::bigint; video bytea:='video'::bytea; jpeg bytea:=decode('ffd8ff'||repeat('ab',100)||'ffd9','hex'); changed bytea:=decode('ffd8ff'||repeat('cd',100)||'ffd9','hex'); x jsonb;
begin
 insert into worker_private.owners(id) values(owner_a),(owner_b);
 insert into worker_private.devices(id,owner_id,public_key) values(d,owner_a,decode(repeat('aa',91),'hex')),(other,owner_b,decode(repeat('bb',91),'hex'));
 assert public.worker_review_read(owner_a,gen_random_uuid()) is null;
 assert (public.worker_media_permission(owner_a,d,true)->>'media_enabled')::boolean;
 perform public.worker_operation(d,gen_random_uuid(),t,'claim_v3');
 x:=public.worker_media_submit(owner_a,d,'review-job','v1:2:3:4:5');job:=(x->>'job_id')::uuid;
 x:=public.worker_operation(d,gen_random_uuid(),t,'claim_v3');lease:=split_part(x->>'claim',E'\t',2)::uuid;
 assert (public.worker_review_write(d,gen_random_uuid(),t,job,sha256(video),sha256(jpeg),jpeg)->>'status')::int=403;
 assert (public.worker_media_write(d,gen_random_uuid(),t,job,lease,0,video,null,null)->>'status')::int=200;
 assert (public.worker_media_write(d,gen_random_uuid(),t,job,lease,null,null,1,sha256(video))->>'state')='completed';
 assert (public.worker_review_write(other,gen_random_uuid(),t,job,sha256(video),sha256(jpeg),jpeg)->>'status')::int=404;
 assert public.worker_review_read(owner_b,job) is null;
 assert (public.worker_review_write(d,gen_random_uuid(),t,job,decode(repeat('01',32),'hex'),sha256(jpeg),jpeg)->>'status')::int=422;
 assert (public.worker_review_write(d,gen_random_uuid(),t,job,sha256(video),sha256(jpeg),changed)->>'status')::int=422;
 x:=public.worker_review_write(d,gen_random_uuid(),t,job,sha256(video),sha256(jpeg),jpeg);
 assert (x->>'status')::int=201;
 assert (public.worker_review_write(d,gen_random_uuid(),t,job,sha256(video),sha256(jpeg),jpeg)->>'status')::int=200;
 assert (public.worker_review_write(d,gen_random_uuid(),t,job,sha256(video),sha256(changed),changed)->>'status')::int=409;
 assert (public.worker_review_read(owner_a,job)->>'image_b64')=replace(encode(jpeg,'base64'),E'\n','');
 assert public.worker_review_read(owner_a,job)->>'creative_quality'='unreviewed';
 assert (select count(*) from worker_private.review_stills where job_id=job)=1;
 assert (public.worker_media_permission(owner_a,d,false)->>'media_enabled')::boolean=false;
 assert public.worker_review_read(owner_a,job) is not null;
 raise notice 'PASS: signed bounded review capture, completed media, replay, owner isolation, immutable evidence, and retention';
end $$;
reset role;
do $$ begin assert not has_function_privilege('authenticated','public.worker_review_write(uuid,uuid,bigint,uuid,bytea,bytea,bytea)','EXECUTE'); assert not has_function_privilege('authenticated','public.worker_review_read(uuid,uuid)','EXECUTE'); end $$;
rollback;
