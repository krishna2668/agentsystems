-- Additive pilot project transport. No historical migration is changed.
begin;
alter table worker_private.devices drop constraint devices_media_version_check;
alter table worker_private.devices add constraint devices_media_version_check check(media_version in (0,1,2));
alter table worker_private.jobs add column project_id uuid, add column project_revision integer, add column project_failure text;
alter table worker_private.jobs add constraint pilot_project_fields check((project_id is null and project_revision is null and project_failure is null) or (project_id is not null and project_revision is not null and project_revision between 1 and 16 and capability='media.animatic.render' and (project_failure is null or (state='blocked' and project_failure='local_project_unavailable'))));
create unique index pilot_project_revision on worker_private.jobs(owner_id,project_id,project_revision) where project_id is not null;
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
 if p_op in ('claim','claim_v2','claim_v3') then
   update worker_private.devices set media_version=case p_op when 'claim_v3' then 2 when 'claim_v2' then 1 else 0 end where id=d.id;
   select * into j from worker_private.jobs where device_id=p_device and state='claimed' for update;
   if found then
     if ((p_op='claim' or not d.media_enabled) and j.capability<>'file.sha256') or (j.project_id is not null and p_op<>'claim_v3') then return jsonb_build_object('status',200,'claim',''); end if;
     if j.deadline<=t then delete from worker_private.media_chunks where job_id=j.id; update worker_private.jobs set lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j; end if;
   else
     select * into j from worker_private.jobs where device_id=p_device and state='queued' and (capability='file.sha256' or (p_op in ('claim_v2','claim_v3') and d.media_enabled and (project_id is null or p_op='claim_v3'))) order by created_at,id limit 1 for update;
     if not found then return jsonb_build_object('status',200,'claim',''); end if;
     update worker_private.jobs set state='claimed',lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j;
   end if;
   return jsonb_build_object('status',200,'claim',j.id::text||E'\t'||j.lease::text||E'\t'||case when p_op in ('claim_v2','claim_v3') then j.capability||E'\t' else '' end||replace(encode(j.payload,'base64'),E'\n',''));
 end if;
 select * into j from worker_private.jobs where id=p_job and device_id=p_device for update;
 if not found then return jsonb_build_object('status',404); end if;
 if p_lease is null or j.lease is distinct from p_lease then return jsonb_build_object('status',409); end if;
 if p_op='recover' then
   if j.state='completed' then return jsonb_build_object('status',200,'state','completed','job_id',j.id,'sha256',encode(j.result,'hex')); end if;
   if j.state='blocked' and j.project_id is not null then return jsonb_build_object('status',200,'state','blocked','job_id',j.id,'lease',j.lease); end if;
   if j.state<>'claimed' then return jsonb_build_object('status',409); end if;
   update worker_private.jobs set deadline=t+interval '60 seconds' where id=j.id;
   return jsonb_build_object('status',200,'state','claimed','job_id',j.id,'lease',j.lease);
 elsif p_op='reject_project' then
   if j.project_id is null then return jsonb_build_object('status',422); end if;
   if j.state='blocked' then return jsonb_build_object('status',200,'state','blocked','job_id',j.id,'lease',j.lease); end if;
   if j.state<>'claimed' then return jsonb_build_object('status',409); end if;
   delete from worker_private.media_chunks where job_id=j.id;
   update worker_private.jobs set state='blocked',project_failure='local_project_unavailable' where id=j.id;
   return jsonb_build_object('status',200,'state','blocked','job_id',j.id,'lease',j.lease);
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
create or replace function public.worker_media_submit(p_owner uuid,p_device uuid,p_idem text,p_spec text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j worker_private.jobs%rowtype; parts text[]; total integer;
begin
 if p_idem is null or length(p_idem) not between 1 and 128 or p_spec is null or p_spec !~ '^v1:([1-9]|10):([1-9]|10):([1-9]|10):([1-9]|10)$' then return jsonb_build_object('status',400); end if;
 parts:=string_to_array(p_spec,':'); total:=parts[2]::int+parts[3]::int+parts[4]::int+parts[5]::int;
 if total>30 then return jsonb_build_object('status',400); end if;
 -- Serialize owner media admission so quota cannot be bypassed by multiple devices.
 perform pg_advisory_xact_lock(hashtextextended('media:'||p_owner::text,0));
 perform 1 from worker_private.devices where owner_id=p_owner and id=p_device and revoked_at is null and media_version>=1 and media_enabled for update;
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


-- Same bounded media queue; each project revision is a render job. Admission
-- serializes with legacy media quota and rejects stale edits before claiming.
create function public.worker_project_submit(p_owner uuid,p_device uuid,p_idem text,p_project uuid,p_expected integer,p_timing text,p_notice boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j worker_private.jobs%rowtype; prior worker_private.jobs%rowtype; spec text; parts text[];
begin
 if p_idem is null or length(p_idem) not between 1 and 128 or p_project is null or p_expected is null or p_expected not between 0 and 15 then return jsonb_build_object('status',400); end if;
 if p_expected=0 then
  if p_notice is not null or p_timing is null or p_timing !~ '^v1:([1-9]|10):([1-9]|10):([1-9]|10):([1-9]|10)$' then return jsonb_build_object('status',400); end if;
  parts:=string_to_array(p_timing,':');if parts[2]::int+parts[3]::int+parts[4]::int+parts[5]::int>30 then return jsonb_build_object('status',400); end if;
  spec:='p1:'||p_project::text||':0:'||substring(p_timing from 4);
 else
  if p_timing is not null or p_notice is null then return jsonb_build_object('status',400); end if;
  spec:='p1:'||p_project::text||':'||p_expected::text||':'||case when p_notice then '1' else '0' end;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('media:'||p_owner::text,0));
 select * into j from worker_private.jobs where owner_id=p_owner and idem=p_idem;
 if found then
  if j.device_id<>p_device or j.project_id is distinct from p_project or j.project_revision is distinct from p_expected+1 or j.payload<>convert_to(spec,'UTF8') then return jsonb_build_object('status',409); end if;
  return jsonb_build_object('status',200,'job_id',j.id,'state',j.state,'project_id',p_project,'revision',j.project_revision);
 end if;
 perform 1 from worker_private.devices where owner_id=p_owner and id=p_device and revoked_at is null and media_version=2 and media_enabled for update;
 if not found then return jsonb_build_object('status',409); end if;
 select * into prior from worker_private.jobs where owner_id=p_owner and project_id=p_project order by project_revision desc limit 1;
 if (p_expected=0 and found) or (p_expected>0 and (not found or prior.project_revision<>p_expected or prior.state<>'completed' or prior.device_id<>p_device)) then return jsonb_build_object('status',409); end if;
 if (select count(*) from worker_private.jobs where owner_id=p_owner and capability='media.animatic.render' and state<>'blocked')>=16 then return jsonb_build_object('status',429); end if;
 insert into worker_private.jobs(owner_id,device_id,idem,capability,payload,project_id,project_revision) values(p_owner,p_device,p_idem,'media.animatic.render',convert_to(spec,'UTF8'),p_project,p_expected+1)
 on conflict(owner_id,idem) do nothing returning * into j;
 if not found then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',201,'job_id',j.id,'state',j.state,'project_id',p_project,'revision',j.project_revision);
end $$;
create function public.worker_project_read(p_owner uuid,p_project uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('project_id',p_project,'device_id',j.device_id,'revision',j.project_revision,'job_id',j.id,'status',j.state,'failure',j.project_failure,'command',convert_from(j.payload,'UTF8'))
 from worker_private.jobs j where j.owner_id=p_owner and j.project_id=p_project order by j.project_revision desc limit 1
$$;
revoke all on function public.worker_project_submit(uuid,uuid,text,uuid,integer,text,boolean),public.worker_project_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_project_submit(uuid,uuid,text,uuid,integer,text,boolean),public.worker_project_read(uuid,uuid) to service_role;
commit;
