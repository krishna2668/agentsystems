-- Dedicated Worker project only. Private tables; trusted gateway RPCs.
begin;
create schema worker_private;
revoke all on schema worker_private from public, anon, authenticated;
grant usage on schema worker_private to service_role;
create table worker_private.owners (
 id uuid primary key, created_at timestamptz not null default now()
);
create table worker_private.devices (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references worker_private.owners(id),
 public_key bytea not null unique check(octet_length(public_key) between 64 and 256),
 revoked_at timestamptz, created_at timestamptz not null default now(),
 unique(owner_id,id)
);
create table worker_private.pairings (
 code_hash bytea primary key check(octet_length(code_hash)=32),
 owner_id uuid not null references worker_private.owners(id),
 expires_at timestamptz not null, device_id uuid,
 foreign key(owner_id,device_id) references worker_private.devices(owner_id,id)
);
create table worker_private.nonces (
 device_id uuid not null references worker_private.devices(id),
 nonce uuid not null, used_at timestamptz not null default now(),
 primary key(device_id,nonce)
);
create table worker_private.jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null, device_id uuid not null,
 idem text not null check(length(idem) between 1 and 128),
 capability text not null check(capability='file.sha256'),
 payload bytea not null check(octet_length(payload)<=262144),
 state text not null default 'queued' check(state in ('queued','claimed','completed','blocked')),
 lease uuid, deadline timestamptz, result bytea,
 created_at timestamptz not null default now(), completed_at timestamptz,
 foreign key(owner_id,device_id) references worker_private.devices(owner_id,id),
 unique(owner_id,idem),
 check((state='completed')=(result is not null and completed_at is not null)),
 check(result is null or octet_length(result)=32),
 check(state not in ('claimed','completed') or (lease is not null and deadline is not null))
);
create unique index worker_one_claim_per_device on worker_private.jobs(device_id) where state='claimed';
create index worker_job_queue on worker_private.jobs(device_id,created_at,id) where state='queued';
create index worker_nonce_age on worker_private.nonces(used_at);
alter table worker_private.owners enable row level security;
alter table worker_private.devices enable row level security;
alter table worker_private.pairings enable row level security;
alter table worker_private.nonces enable row level security;
alter table worker_private.jobs enable row level security;
revoke all on all tables in schema worker_private from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema worker_private to service_role;

-- All RPC arguments identifying principals must come from verified gateway context.
-- The trusted gateway validates ECDSA proof before calling device operations.
create function public.worker_issue_pairing(p_owner uuid,p_hash bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 insert into worker_private.pairings(code_hash,owner_id,expires_at)
 values(p_hash,p_owner,clock_timestamp()+interval '5 minutes');
 return jsonb_build_object('status',201);
end $$;

create function public.worker_enroll(p_hash bytea,p_key bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p worker_private.pairings%rowtype; d worker_private.devices%rowtype;
begin
 select * into p from worker_private.pairings where code_hash=p_hash for update;
 if not found or p.expires_at<=clock_timestamp() then return jsonb_build_object('status',401); end if;
 if p.device_id is not null then
   select * into d from worker_private.devices where id=p.device_id and owner_id=p.owner_id;
   if d.revoked_at is not null or d.public_key is distinct from p_key then return jsonb_build_object('status',401); end if;
   return jsonb_build_object('status',200,'device_id',d.id);
 end if;
 insert into worker_private.devices(owner_id,public_key) values(p.owner_id,p_key)
 on conflict(public_key) do nothing returning * into d;
 if not found then return jsonb_build_object('status',409); end if;
 update worker_private.pairings set device_id=d.id where code_hash=p_hash;
 return jsonb_build_object('status',201,'device_id',d.id);
end $$;

create function public.worker_key(p_device uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('public_key',replace(encode(public_key,'base64'),E'\n','')) from worker_private.devices where id=p_device and revoked_at is null
$$;

create function public.worker_submit(p_owner uuid,p_device uuid,p_idem text,p_payload bytea)
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
 if j.device_id is distinct from p_device or j.payload is distinct from p_payload then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',200,'job_id',j.id,'state',j.state);
end $$;

create function public.worker_result(p_owner uuid,p_job uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('job_id',id,'status',state,'sha256',encode(result,'hex')) from worker_private.jobs where owner_id=p_owner and id=p_job
$$;

create function public.worker_revoke(p_owner uuid,p_device uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 update worker_private.devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where owner_id=p_owner and id=p_device;
 if not found then return jsonb_build_object('status',404); end if;
 update worker_private.jobs set state='blocked' where device_id=p_device and owner_id=p_owner and state in ('queued','claimed');
 return jsonb_build_object('status',200);
end $$;

create function public.worker_operation(p_device uuid,p_nonce uuid,p_stamp bigint,p_op text,p_job uuid default null,p_lease uuid default null,p_digest bytea default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d worker_private.devices%rowtype; j worker_private.jobs%rowtype; t timestamptz;
begin
 -- Lock the device across replay check and state transition: revocation, claim, recovery and completion serialize.
 select * into d from worker_private.devices where id=p_device for update;
 t:=clock_timestamp();
 if not found or d.revoked_at is not null or p_stamp is null or abs(extract(epoch from t)-p_stamp::numeric)>120 then return jsonb_build_object('status',401); end if;
 insert into worker_private.nonces(device_id,nonce) values(p_device,p_nonce) on conflict do nothing;
 if not found then return jsonb_build_object('status',409); end if;
 if p_op='claim' then
   select * into j from worker_private.jobs where device_id=p_device and state='claimed' for update;
   if found then
     if j.deadline<=t then update worker_private.jobs set lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j; end if;
   else
     select * into j from worker_private.jobs where device_id=p_device and state='queued' order by created_at,id limit 1 for update;
     if not found then return jsonb_build_object('status',200,'claim',''); end if;
     update worker_private.jobs set state='claimed',lease=gen_random_uuid(),deadline=t+interval '60 seconds' where id=j.id returning * into j;
   end if;
   return jsonb_build_object('status',200,'claim',j.id::text||E'\t'||j.lease::text||E'\t'||replace(encode(j.payload,'base64'),E'\n',''));
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
revoke all on function public.worker_issue_pairing(uuid,bytea),public.worker_enroll(bytea,bytea),public.worker_key(uuid),public.worker_submit(uuid,uuid,text,bytea),public.worker_result(uuid,uuid),public.worker_revoke(uuid,uuid),public.worker_operation(uuid,uuid,bigint,text,uuid,uuid,bytea) from public, anon, authenticated;
grant execute on function public.worker_issue_pairing(uuid,bytea),public.worker_enroll(bytea,bytea),public.worker_key(uuid),public.worker_submit(uuid,uuid,text,bytea),public.worker_result(uuid,uuid),public.worker_revoke(uuid,uuid),public.worker_operation(uuid,uuid,bigint,text,uuid,uuid,bytea) to service_role;
commit;
