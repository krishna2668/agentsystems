-- Local media candidate. Existing SHA-256 jobs and legacy claims are preserved.
begin;
alter table worker_private.devices add column media_version integer not null default 0 check(media_version in (0,1));
alter table worker_private.devices add column media_enabled boolean not null default false;
alter table worker_private.jobs drop constraint jobs_capability_check;
alter table worker_private.jobs add constraint jobs_capability_check check(capability in ('file.sha256','media.animatic.render'));
create table worker_private.media_chunks (
 job_id uuid not null references worker_private.jobs(id), lease uuid not null,
 seq integer not null check(seq between 0 and 31),
 bytes bytea not null check(octet_length(bytes) between 1 and 65536),
 primary key(job_id,seq)
);
alter table worker_private.media_chunks enable row level security;
revoke all on worker_private.media_chunks from public,anon,authenticated;
grant select,insert,delete on worker_private.media_chunks to service_role;
create or replace function public.worker_operation(p_device uuid,p_nonce uuid,p_stamp bigint,p_op text,p_job uuid default null,p_lease uuid default null,p_digest bytea default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d worker_private.devices%rowtype; j worker_private.jobs%rowtype; t timestamptz;
begin
 -- Lock the device across replay check and state transition: revocation, claim, recovery and completion serialize.
 select * into d from worker_private.devices where id=p_device for update;
 t:=clock_timestamp();
 if not found or d.revoked_at is not null or p_stamp is null or abs(extract(epoch from t)-p_stamp::numeric)>120 then return jsonb_build_object('status',401); end if;
 insert into worker_private.nonces(device_id,nonce) values(p_device,p_nonce) on conflict do nothing;
 if not found then return jsonb_build_object('status',409); end if;
 if p_op in ('claim','claim_v2') then
   if p_op='claim_v2' then update worker_private.devices set media_version=1 where id=d.id; else update worker_private.devices set media_version=0 where id=d.id; end if;
   select * into j from worker_private.jobs where device_id=p_device and state='claimed' for update;
   if found then
     if (p_op='claim' or not d.media_enabled) and j.capability<>'file.sha256' then return jsonb_build_object('status',200,'claim',''); end if;
     if j.deadline<=t then delete from worker_private.media_chunks where job_id=j.id; update worker_private.jobs set lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j; end if;
   else
     select * into j from worker_private.jobs where device_id=p_device and state='queued' and (capability='file.sha256' or (p_op='claim_v2' and d.media_enabled)) order by created_at,id limit 1 for update;
     if not found then return jsonb_build_object('status',200,'claim',''); end if;
     update worker_private.jobs set state='claimed',lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j;
   end if;
   return jsonb_build_object('status',200,'claim',j.id::text||E'\t'||j.lease::text||E'\t'||case when p_op='claim_v2' then j.capability||E'\t' else '' end||replace(encode(j.payload,'base64'),E'\n',''));
 end if;
 select * into j from worker_private.jobs where id=p_job and device_id=p_device for update;
 if not found then return jsonb_build_object('status',404); end if;
 if p_lease is null or j.lease is distinct from p_lease then return jsonb_build_object('status',409); end if;
 if p_op='recover' then
   if j.state='completed' then return jsonb_build_object('status',200,'state','completed','job_id',j.id,'sha256',encode(j.result,'hex')); end if;
   if j.state<>'claimed' then return jsonb_build_object('status',409); end if;
   update worker_private.jobs set deadline=t+interval '60 seconds' where id=j.id;
   return jsonb_build_object('status',200,'state','claimed','job_id',j.id,'lease',j.lease);
 elsif p_op='complete' then
   if j.capability<>'file.sha256' then return jsonb_build_object('status',422); end if;
   if j.state='completed' then
     if j.result is distinct from p_digest then return jsonb_build_object('status',409); end if;
   else
     if j.state<>'claimed' or j.deadline<=t then return jsonb_build_object('status',409); end if;
     if sha256(j.payload) is distinct from p_digest then return jsonb_build_object('status',422); end if;
     update worker_private.jobs set state='completed',result=p_digest,completed_at=t where id=j.id returning * into j;
   end if;
   return jsonb_build_object('status',200,'state','completed','job_id',j.id,'sha256',encode(j.result,'hex'));
 end if;
 return jsonb_build_object('status',400);
end $$;
create or replace function public.worker_submit(p_owner uuid,p_device uuid,p_idem text,p_payload bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j worker_private.jobs%rowtype;
begin
 perform 1 from worker_private.devices where owner_id=p_owner and id=p_device and revoked_at is null for update;
 if not found then return jsonb_build_object('status',400); end if;
 if p_idem is null or length(p_idem) not between 1 and 128 or p_payload is null or octet_length(p_payload)>262144 then return jsonb_build_object('status',400); end if;
 insert into worker_private.jobs(owner_id,device_id,idem,capability,payload)
 values(p_owner,p_device,p_idem,'file.sha256',p_payload)
 on conflict(owner_id,idem) do nothing returning * into j;
 if found then return jsonb_build_object('status',201,'job_id',j.id,'state',j.state); end if;
 select * into j from worker_private.jobs where owner_id=p_owner and idem=p_idem;
 if j.capability<>'file.sha256' or j.device_id is distinct from p_device or j.payload is distinct from p_payload then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',200,'job_id',j.id,'state',j.state);
end $$;

-- Admission requires a signed v2 claim from a capable app. No capabilities inferred from enrollment.
create function public.worker_media_submit(p_owner uuid,p_device uuid,p_idem text,p_spec text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j worker_private.jobs%rowtype; parts text[]; total integer;
begin
 if p_idem is null or length(p_idem) not between 1 and 128 or p_spec is null or p_spec !~ '^v1:([1-9]|10):([1-9]|10):([1-9]|10):([1-9]|10)$' then return jsonb_build_object('status',400); end if;
 parts:=string_to_array(p_spec,':'); total:=parts[2]::int+parts[3]::int+parts[4]::int+parts[5]::int;
 if total>30 then return jsonb_build_object('status',400); end if;
 -- Serialize owner media admission so quota cannot be bypassed by multiple devices.
 perform pg_advisory_xact_lock(hashtextextended('media:'||p_owner::text,0));
 perform 1 from worker_private.devices where owner_id=p_owner and id=p_device and revoked_at is null and media_version=1 and media_enabled for update;
 if not found then return jsonb_build_object('status',409); end if;
 select * into j from worker_private.jobs where owner_id=p_owner and idem=p_idem;
 if found then
  if j.device_id<>p_device or j.capability<>'media.animatic.render' or j.payload<>convert_to(p_spec,'UTF8') then return jsonb_build_object('status',409); end if;
  return jsonb_build_object('status',200,'job_id',j.id,'state',j.state);
 end if;
 -- Pilot quota: reserve at most sixteen bounded artifacts, no silent deletion.
 if (select count(*) from worker_private.jobs where owner_id=p_owner and capability='media.animatic.render' and state<>'blocked')>=16 then return jsonb_build_object('status',429); end if;
 insert into worker_private.jobs(owner_id,device_id,idem,capability,payload) values(p_owner,p_device,p_idem,'media.animatic.render',convert_to(p_spec,'UTF8'))
 on conflict(owner_id,idem) do nothing returning * into j;
 if not found then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',201,'job_id',j.id,'state',j.state);
end $$;

-- Device signature is checked by the trusted edge; this transaction fences replay, revocation and leases.
create function public.worker_media_write(p_device uuid,p_nonce uuid,p_stamp bigint,p_job uuid,p_lease uuid,p_seq integer,p_bytes bytea,p_count integer,p_digest bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d worker_private.devices%rowtype;j worker_private.jobs%rowtype;t timestamptz; n integer; last_seq integer; artifact bytea;
begin
 select * into d from worker_private.devices where id=p_device for update; t:=clock_timestamp();
 if not found or d.revoked_at is not null or p_stamp is null or abs(extract(epoch from t)-p_stamp::numeric)>120 then return jsonb_build_object('status',401); end if;
 insert into worker_private.nonces(device_id,nonce) values(p_device,p_nonce) on conflict do nothing;
 if not found then return jsonb_build_object('status',409); end if;
 select * into j from worker_private.jobs where id=p_job and device_id=p_device and capability='media.animatic.render' for update;
 if not found then return jsonb_build_object('status',404); end if;
 if p_lease is null or j.lease is distinct from p_lease then return jsonb_build_object('status',409); end if;
 if j.state='completed' then
  if p_seq is null and p_bytes is null and p_digest=j.result and p_count=(select count(*) from worker_private.media_chunks where job_id=j.id) then
   return jsonb_build_object('status',200,'state','completed','sha256',encode(j.result,'hex'));
  end if;
  return jsonb_build_object('status',409);
 end if;
 if not d.media_enabled or j.state<>'claimed' or j.deadline<=t then return jsonb_build_object('status',409); end if;
 if p_seq is not null then
  if p_seq not between 0 and 31 or p_bytes is null or octet_length(p_bytes) not between 1 and 65536 or p_count is not null or p_digest is not null then return jsonb_build_object('status',400); end if;
  insert into worker_private.media_chunks(job_id,lease,seq,bytes) values(j.id,p_lease,p_seq,p_bytes) on conflict(job_id,seq) do nothing;
  if not exists(select 1 from worker_private.media_chunks where job_id=j.id and seq=p_seq and lease=p_lease and bytes=p_bytes) then return jsonb_build_object('status',409); end if;
  update worker_private.jobs set deadline=t+interval '60 seconds' where id=j.id;
  return jsonb_build_object('status',200,'state','uploaded','seq',p_seq);
 end if;
 if p_bytes is not null or p_count is null or p_count not between 1 and 32 or p_digest is null or octet_length(p_digest)<>32 then return jsonb_build_object('status',400); end if;
 select count(*),max(seq),string_agg(bytes,''::bytea order by seq) into n,last_seq,artifact from worker_private.media_chunks where job_id=j.id and lease=p_lease;
 if n<>p_count or last_seq<>p_count-1 then return jsonb_build_object('status',409); end if;
 if sha256(artifact) is distinct from p_digest then return jsonb_build_object('status',422); end if;
 -- Integrity only: independent decoding/creative inspection are separate evidence.
 update worker_private.jobs set state='completed',result=sha256(artifact),completed_at=t where id=j.id returning * into j;
 return jsonb_build_object('status',200,'state','completed','sha256',encode(j.result,'hex'));
end $$;
create function public.worker_media_artifact(p_owner uuid,p_job uuid,p_seq integer)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('sha256',encode(j.result,'hex'),'seq',c.seq,'bytes_b64',replace(encode(c.bytes,'base64'),E'\n',''),'chunks',(select count(*) from worker_private.media_chunks where job_id=j.id))
 from worker_private.jobs j join worker_private.media_chunks c on c.job_id=j.id and c.lease=j.lease
 where j.owner_id=p_owner and j.id=p_job and j.state='completed' and j.capability='media.animatic.render' and c.seq=p_seq
$$;
-- Revocation discards unfinished artifact bytes, not completed results.
create or replace function public.worker_revoke(p_owner uuid,p_device uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 update worker_private.devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where owner_id=p_owner and id=p_device;
 if not found then return jsonb_build_object('status',404); end if;
 delete from worker_private.media_chunks c using worker_private.jobs j where c.job_id=j.id and j.device_id=p_device and j.owner_id=p_owner and j.state in ('queued','claimed');
 update worker_private.jobs set state='blocked' where device_id=p_device and owner_id=p_owner and state in ('queued','claimed');
 return jsonb_build_object('status',200);
end $$;
revoke all on function public.worker_media_submit(uuid,uuid,text,text),public.worker_media_write(uuid,uuid,bigint,uuid,uuid,integer,bytea,integer,bytea),public.worker_media_artifact(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.worker_media_submit(uuid,uuid,text,text),public.worker_media_write(uuid,uuid,bigint,uuid,uuid,integer,bytea,integer,bytea),public.worker_media_artifact(uuid,uuid,integer) to service_role;
-- Direct authenticated user only; never delegated to MCP. Disabling blocks unfinished media work.
create function public.worker_media_permission(p_owner uuid,p_device uuid,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_enabled is null then return jsonb_build_object('status',400); end if;
 update worker_private.devices set media_enabled=p_enabled where owner_id=p_owner and id=p_device and revoked_at is null;
 if not found then return jsonb_build_object('status',404); end if;
 if not p_enabled then
  delete from worker_private.media_chunks c using worker_private.jobs j where c.job_id=j.id and j.device_id=p_device and j.capability='media.animatic.render' and j.state in ('queued','claimed');
  update worker_private.jobs set state='blocked' where device_id=p_device and capability='media.animatic.render' and state in ('queued','claimed');
 end if;
 return jsonb_build_object('status',200,'media_enabled',p_enabled);
end $$;
create or replace function public.worker_list_devices(p_owner uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'revoked',revoked_at is not null,'media_version',media_version,'media_enabled',media_enabled) order by created_at,id),'[]'::jsonb) from worker_private.devices where owner_id=p_owner
$$;
create function public.worker_media_manifest(p_owner uuid,p_job uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('job_id',j.id,'capability',j.capability,'sha256',encode(j.result,'hex'),'bytes',sum(octet_length(c.bytes)),'chunks',count(*),'integrity','verified','media_validity','unverified','creative_quality','unreviewed')
 from worker_private.jobs j join worker_private.media_chunks c on c.job_id=j.id and c.lease=j.lease
 where j.owner_id=p_owner and j.id=p_job and j.state='completed' and j.capability='media.animatic.render'
 group by j.id
$$;
revoke all on function public.worker_media_permission(uuid,uuid,boolean),public.worker_media_manifest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_media_permission(uuid,uuid,boolean),public.worker_media_manifest(uuid,uuid) to service_role;
commit;
