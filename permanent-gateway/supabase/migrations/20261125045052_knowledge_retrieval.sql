begin;
-- Exact job evidence is distinct from a claim made by a reasoning client.
alter table worker_private.observations add column verified_job_id uuid references worker_private.jobs(id);
alter table worker_private.learning_proposals add column idem text check(length(idem) between 1 and 128);
create unique index worker_proposal_retry on worker_private.learning_proposals(owner_id,idem) where idem is not null;

create function public.worker_profiles(p_owner uuid,p_after uuid default null,p_limit integer default 30)
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from (
 select id,scope,label from worker_private.profiles where owner_id=p_owner
 and (p_after is null or id>p_after) order by id limit greatest(1,least(coalesce(p_limit,30),50))
 ) x
$$;

create function public.worker_observe_job(p_owner uuid,p_profile uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j worker_private.jobs%rowtype; o worker_private.observations%rowtype; k text; b text;
begin
 if not exists(select 1 from worker_private.profiles where owner_id=p_owner and id=p_profile) then return jsonb_build_object('status',404); end if;
 select * into j from worker_private.jobs where owner_id=p_owner and id=p_job and state='completed' and result=sha256(payload);
 if not found then return jsonb_build_object('status',404); end if;
 k:='verified-job:'||p_profile::text||':'||p_job::text;
 b:=jsonb_build_object('capability',j.capability,'job_id',j.id,'sha256',encode(j.result,'hex'),'verified_at',j.completed_at)::text;
 insert into worker_private.observations(owner_id,profile_id,idem,source_kind,source_ref,body,verified_job_id)
 values(p_owner,p_profile,k,'execution','job:'||p_job::text,b,p_job)
 on conflict(owner_id,idem) do nothing returning * into o;
 if found then return jsonb_build_object('status',201,'observation_id',o.id); end if;
 select * into o from worker_private.observations where owner_id=p_owner and idem=k;
 if o.verified_job_id is distinct from p_job or o.profile_id is distinct from p_profile then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',200,'observation_id',o.id);
end $$;

create function public.worker_propose_retry(p_owner uuid,p_profile uuid,p_key text,p_expected integer,p_evidence uuid,p_kind text,p_body text,p_rationale text,p_idem text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p worker_private.learning_proposals%rowtype; e worker_private.knowledge_entries%rowtype; r jsonb;
begin
 if p_idem is null or length(p_idem) not between 1 and 128 then return jsonb_build_object('status',400); end if;
 -- Serialize retry keys per owner, not the entire system.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_idem,0));
 select * into p from worker_private.learning_proposals where owner_id=p_owner and idem=p_idem;
 if found then
 select * into e from worker_private.knowledge_entries where owner_id=p_owner and id=p.entry_id;
 if p.profile_id is distinct from p_profile or e.key is distinct from p_key or p.expected_revision is distinct from p_expected or p.evidence_id is distinct from p_evidence or p.kind is distinct from p_kind or p.body is distinct from p_body or p.rationale is distinct from p_rationale then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',200,'proposal_id',p.id,'entry_id',p.entry_id,'state',p.state);
 end if;
 if p_kind='validated_learning' and not exists(select 1 from worker_private.observations where owner_id=p_owner and profile_id=p_profile and id=p_evidence and verified_job_id is not null) then return jsonb_build_object('status',422); end if;
 r:=public.worker_propose_learning(p_owner,p_profile,p_key,p_expected,p_evidence,p_kind,p_body,p_rationale);
 if (r->>'status')::integer=201 then update worker_private.learning_proposals set idem=p_idem where owner_id=p_owner and id=(r->>'proposal_id')::uuid; end if;
 return r;
end $$;

create function public.worker_search_context(p_owner uuid,p_profiles uuid[],p_query text default '',p_limit integer default 20,p_after text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select case when cardinality(p_profiles) between 1 and 12 and length(coalesce(p_query,''))<=240
 and not exists(select 1 from unnest(p_profiles) s(id) where not exists(select 1 from worker_private.profiles p where p.owner_id=p_owner and p.id=s.id))
 then coalesce((select jsonb_agg(x.row order by x.cursor) from (
 select p.id::text||':'||e.id::text as cursor,
 jsonb_build_object('cursor',p.id::text||':'||e.id::text,'profile_id',p.id,'scope',p.scope,'label',p.label,'entry_id',e.id,'key',e.key,'revision',r.revision,'kind',r.kind,'body',r.body,
 'evidence',jsonb_build_object('id',o.id,'source_kind',o.source_kind,'source_ref',o.source_ref,'verified_job_id',o.verified_job_id)) as row
 from worker_private.knowledge_entries e join worker_private.profiles p on p.id=e.profile_id
 join worker_private.knowledge_revisions r on r.entry_id=e.id and r.revision=e.current_revision
 join worker_private.observations o on o.id=r.evidence_id
 where e.owner_id=p_owner and e.profile_id=any(p_profiles)
 and (p_after is null or p.id::text||':'||e.id::text>p_after)
 and (coalesce(p_query,'')='' or strpos(lower(e.key||' '||r.body),lower(p_query))>0)
 order by p.id::text||':'||e.id::text limit greatest(1,least(coalesce(p_limit,20),20))
 ) x),'[]'::jsonb) else null end
$$;

create function public.worker_revision_history(p_owner uuid,p_entry uuid,p_before integer default null,p_limit integer default 10)
returns jsonb language sql security invoker set search_path='' as $$
 select case when exists(select 1 from worker_private.knowledge_entries where owner_id=p_owner and id=p_entry)
 then coalesce((select jsonb_agg(to_jsonb(x) order by x.revision desc) from (
 select r.revision,r.kind,r.body,r.created_at,r.evidence_id,o.source_kind,o.source_ref,o.verified_job_id
 from worker_private.knowledge_revisions r join worker_private.observations o on o.id=r.evidence_id
 where r.owner_id=p_owner and r.entry_id=p_entry and (p_before is null or r.revision<p_before)
 order by r.revision desc limit greatest(1,least(coalesce(p_limit,10),20))
 ) x),'[]'::jsonb) else null end
$$;

revoke all on function public.worker_profiles(uuid,uuid,integer),public.worker_observe_job(uuid,uuid,uuid),public.worker_propose_retry(uuid,uuid,text,integer,uuid,text,text,text,text),public.worker_search_context(uuid,uuid[],text,integer,text),public.worker_revision_history(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.worker_profiles(uuid,uuid,integer),public.worker_observe_job(uuid,uuid,uuid),public.worker_propose_retry(uuid,uuid,text,integer,uuid,text,text,text,text),public.worker_search_context(uuid,uuid[],text,integer,text),public.worker_revision_history(uuid,uuid,integer,integer) to service_role;
commit;
