set role service_role;
do $$
declare
 a uuid:='00000000-0000-4000-8000-000000000001'; b uuid:='00000000-0000-4000-8000-000000000002';
 p uuid; q uuid; ob uuid; verified uuid; j uuid; proposal uuid; entry uuid; result jsonb; c text;
begin
 p:=(public.worker_profile_create(a,'domain','Retrieval test')->>'profile_id')::uuid;
 q:=(public.worker_profile_create(b,'domain','Retrieval test')->>'profile_id')::uuid;
 assert jsonb_array_length(public.worker_profiles(a))>=1;
 assert public.worker_search_context(a,array[p,q]) is null;
 assert public.worker_search_context(a,array[]::uuid[]) is null;
 ob:=(public.worker_observe(a,p,'retrieval-obs','experiment','claimed:test','A claimed experiment')->>'observation_id')::uuid;
 assert (public.worker_propose_retry(a,p,'validation',0,ob,'validated_learning','Unverified','Unsupported','proposal-0')->>'status')::int=422;
 assert (public.worker_observe_job(a,p,gen_random_uuid())->>'status')::int=404;
 select id into j from worker_private.jobs where owner_id=a and state='completed' limit 1;
 assert j is not null;
 verified:=(public.worker_observe_job(a,p,j)->>'observation_id')::uuid;
 assert verified is not null;
 assert (public.worker_observe_job(a,p,j)->>'observation_id')::uuid=verified;
 assert (public.worker_observe_job(b,q,j)->>'status')::int=404;
 result:=public.worker_propose_retry(a,p,'digest',0,verified,'validated_learning','Verified digest','Matching SHA-256','proposal-1');
 assert (result->>'status')::int=201;
 proposal:=(result->>'proposal_id')::uuid; entry:=(result->>'entry_id')::uuid;
 assert (public.worker_propose_retry(a,p,'digest',0,verified,'validated_learning','Verified digest','Matching SHA-256','proposal-1')->>'proposal_id')::uuid=proposal;
 assert (public.worker_propose_retry(a,p,'digest',0,verified,'validated_learning','Altered digest','Matching SHA-256','proposal-1')->>'status')::int=409;
 assert public.worker_search_context(a,array[p])='[]'::jsonb;
 assert (public.worker_decide_learning(a,proposal,true)->>'state')='committed';
 result:=public.worker_search_context(a,array[p],'digest');
 assert jsonb_array_length(result)=1;
 assert (result->0->'evidence'->>'verified_job_id')::uuid=j;
 c:=result->0->>'cursor';
 assert public.worker_search_context(a,array[p],'digest',20,c)='[]'::jsonb;
 assert public.worker_search_context(a,array[p],'nonexistent')='[]'::jsonb;
 assert (public.worker_revision_history(a,entry)->0->>'revision')::int=1;
 assert public.worker_revision_history(b,entry) is null;
 assert public.worker_revision_history(a,entry,1)='[]'::jsonb;
 assert (public.worker_propose_retry(a,p,'digest',0,verified,'validated_learning','Verified digest','Matching SHA-256','proposal-1')->>'state')='committed';
 raise notice 'PASS: verified job provenance, profile isolation, retry safety, pending exclusion, bounded retrieval and revision history';
end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.worker_observe_job(uuid,uuid,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.worker_search_context(uuid,uuid[],text,integer,text)','EXECUTE');
 assert has_function_privilege('service_role','public.worker_propose_retry(uuid,uuid,text,integer,uuid,text,text,text,text)','EXECUTE');
 raise notice 'PASS: retrieval permissions';
end $$;
