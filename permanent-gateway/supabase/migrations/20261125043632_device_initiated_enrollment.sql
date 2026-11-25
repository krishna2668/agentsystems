begin;
create table worker_private.enrollments (
 id uuid primary key,
 code_hash bytea not null unique check(octet_length(code_hash)=32),
 public_key bytea not null check(octet_length(public_key) between 64 and 256),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 owner_id uuid,
 device_id uuid,
 check((owner_id is null)=(device_id is null)),
 foreign key(owner_id,device_id) references worker_private.devices(owner_id,id)
);
create index worker_pending_enrollment_expiry on worker_private.enrollments(expires_at) where device_id is null;
alter table worker_private.enrollments enable row level security;
revoke all on worker_private.enrollments from public,anon,authenticated;
grant select,insert,update,delete on worker_private.enrollments to service_role;

-- Trusted gateway verifies P-256 possession before calling this RPC.
create function public.worker_enrollment_start(p_id uuid,p_hash bytea,p_key bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e worker_private.enrollments%rowtype; t timestamptz;
begin
 -- Serialize admission to bound untrusted pending requests and prevent duplicate key requests.
 perform pg_advisory_xact_lock(61125,1);
 t:=clock_timestamp();
 if p_id is null or p_hash is null or octet_length(p_hash)<>32 or p_key is null or octet_length(p_key) not between 64 and 256 then return jsonb_build_object('status',400); end if;
 select * into e from worker_private.enrollments where id=p_id;
 if found then
   if e.public_key is distinct from p_key or e.code_hash is distinct from p_hash then return jsonb_build_object('status',409); end if;
   if e.device_id is not null then
     if exists(select 1 from worker_private.devices where id=e.device_id and revoked_at is null) then return jsonb_build_object('status',200,'state','approved','device_id',e.device_id); end if;
     return jsonb_build_object('status',403);
   end if;
   if e.expires_at>t then return jsonb_build_object('status',200,'state','pending','expires_at',extract(epoch from e.expires_at)::bigint); end if;
   return jsonb_build_object('status',410);
 end if;
 delete from worker_private.enrollments where device_id is null and expires_at<=t;
 if exists(select 1 from worker_private.devices where public_key=p_key) or exists(select 1 from worker_private.enrollments where public_key=p_key and device_id is null) then return jsonb_build_object('status',409); end if;
 if (select count(*) from worker_private.enrollments where device_id is null)>=100 then return jsonb_build_object('status',429); end if;
 insert into worker_private.enrollments(id,code_hash,public_key,expires_at)
 values(p_id,p_hash,p_key,t+interval '10 minutes')
 on conflict do nothing returning * into e;
 if not found then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',201,'state','pending','expires_at',extract(epoch from e.expires_at)::bigint);
end $$;

-- Public gateway may retrieve key for proof verification only; never return it to callers.
create function public.worker_enrollment_key(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('public_key',replace(encode(public_key,'base64'),E'\n',''))
 from worker_private.enrollments where id=p_id
$$;
create function public.worker_enrollment_status(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select case when e.device_id is not null and d.revoked_at is null then jsonb_build_object('status',200,'state','approved','device_id',e.device_id)
 when e.device_id is not null then jsonb_build_object('status',403)
 when e.expires_at<=clock_timestamp() then jsonb_build_object('status',410)
 else jsonb_build_object('status',200,'state','pending','expires_at',extract(epoch from e.expires_at)::bigint) end
 from worker_private.enrollments e left join worker_private.devices d on d.id=e.device_id where e.id=p_id
$$;

-- Owner-only lookup does not disclose public key or authorization to the device.
create function public.worker_enrollment_lookup(p_owner uuid,p_hash bytea)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('request_id',e.id,'state',case when d.revoked_at is not null then 'revoked' when e.device_id is not null then 'approved' else 'pending' end,
 'expires_at',extract(epoch from e.expires_at)::bigint,'fingerprint',encode(sha256(e.public_key),'hex'))
 from worker_private.enrollments e left join worker_private.devices d on d.id=e.device_id
 where e.code_hash=p_hash and exists(select 1 from worker_private.owners where id=p_owner)
 and ((e.device_id is null and e.expires_at>clock_timestamp()) or e.owner_id=p_owner)
$$;

create function public.worker_enrollment_approve(p_owner uuid,p_id uuid,p_hash bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e worker_private.enrollments%rowtype; d worker_private.devices%rowtype;
begin
 if not exists(select 1 from worker_private.owners where id=p_owner) then return jsonb_build_object('status',403); end if;
 select * into e from worker_private.enrollments where id=p_id and code_hash=p_hash for update;
 if not found then return jsonb_build_object('status',404); end if;
 if e.device_id is not null then
   if e.owner_id<>p_owner then return jsonb_build_object('status',404); end if;
   if exists(select 1 from worker_private.devices where id=e.device_id and revoked_at is null) then return jsonb_build_object('status',200,'state','approved','device_id',e.device_id); end if;
   return jsonb_build_object('status',403);
 end if;
 if e.expires_at<=clock_timestamp() then return jsonb_build_object('status',410); end if;
 insert into worker_private.devices(owner_id,public_key) values(p_owner,e.public_key) on conflict(public_key) do nothing returning * into d;
 if not found then return jsonb_build_object('status',409); end if;
 update worker_private.enrollments set owner_id=p_owner,device_id=d.id where id=p_id;
 return jsonb_build_object('status',201,'state','approved','device_id',d.id);
end $$;
revoke all on function public.worker_enrollment_start(uuid,bytea,bytea),public.worker_enrollment_key(uuid),public.worker_enrollment_status(uuid),public.worker_enrollment_lookup(uuid,bytea),public.worker_enrollment_approve(uuid,uuid,bytea) from public,anon,authenticated;
grant execute on function public.worker_enrollment_start(uuid,bytea,bytea),public.worker_enrollment_key(uuid),public.worker_enrollment_status(uuid),public.worker_enrollment_lookup(uuid,bytea),public.worker_enrollment_approve(uuid,uuid,bytea) to service_role;
commit;
