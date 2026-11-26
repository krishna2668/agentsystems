-- Bounded, private visual evidence for completed media; never public media access.
begin;
create table worker_private.review_stills (
 job_id uuid primary key references worker_private.jobs(id),
 source_sha256 bytea not null check (octet_length(source_sha256)=32),
 jpeg_sha256 bytea not null check (octet_length(jpeg_sha256)=32),
 jpeg bytea not null check (octet_length(jpeg) between 100 and 196608),
 created_at timestamptz not null default clock_timestamp()
);
alter table worker_private.review_stills enable row level security;
revoke all on worker_private.review_stills from public,anon,authenticated;
grant select,insert on worker_private.review_stills to service_role;

-- Called only after gateway verifies the device signature for the exact body.
-- Completed jobs remain immutable. Replays are safe only for identical evidence.
create function public.worker_review_write(p_device uuid,p_nonce uuid,p_stamp bigint,p_job uuid,p_source bytea,p_digest bytea,p_image bytea)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d worker_private.devices%rowtype; j worker_private.jobs%rowtype; old worker_private.review_stills%rowtype; t timestamptz:=clock_timestamp();
begin
 select * into d from worker_private.devices where id=p_device for update;
 if not found or d.revoked_at is not null or p_stamp is null or abs(extract(epoch from t)-p_stamp::numeric)>120 then return jsonb_build_object('status',401); end if;
 insert into worker_private.nonces(device_id,nonce) values(p_device,p_nonce) on conflict do nothing;
 if not found then return jsonb_build_object('status',409); end if;
 select * into j from worker_private.jobs where id=p_job and device_id=d.id and owner_id=d.owner_id for update;
 if not found then return jsonb_build_object('status',404); end if;
 if not d.media_enabled or d.media_version<2 or j.capability<>'media.animatic.render' or j.state<>'completed' then return jsonb_build_object('status',403); end if;
 if p_source is null or p_source is distinct from j.result or p_digest is null or octet_length(p_digest)<>32 or p_image is null or octet_length(p_image) not between 100 and 196608 or sha256(p_image) is distinct from p_digest or substring(p_image from 1 for 3)<>decode('ffd8ff','hex') or substring(p_image from octet_length(p_image)-1 for 2)<>decode('ffd9','hex') then return jsonb_build_object('status',422); end if;
 select * into old from worker_private.review_stills where job_id=j.id;
 if found then
  if old.source_sha256 is distinct from p_source or old.jpeg_sha256 is distinct from p_digest or old.jpeg is distinct from p_image then return jsonb_build_object('status',409); end if;
  return jsonb_build_object('status',200,'sha256',encode(old.jpeg_sha256,'hex'));
 end if;
 insert into worker_private.review_stills(job_id,source_sha256,jpeg_sha256,jpeg) values(j.id,p_source,p_digest,p_image);
 return jsonb_build_object('status',201,'sha256',encode(p_digest,'hex'));
end $$;

create function public.worker_review_read(p_owner uuid,p_job uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('job_id',j.id,'source_sha256',encode(j.result,'hex'),'sha256',encode(s.jpeg_sha256,'hex'),'mime_type','image/jpeg','bytes',octet_length(s.jpeg),'frames',6,'image_b64',replace(encode(s.jpeg,'base64'),E'\n',''),'provenance','signed_device_capture','creative_quality','unreviewed')
 from worker_private.jobs j join worker_private.review_stills s on s.job_id=j.id
 where j.owner_id=p_owner and j.id=p_job and j.state='completed' and j.capability='media.animatic.render' and j.result=s.source_sha256
$$;
revoke all on function public.worker_review_write(uuid,uuid,bigint,uuid,bytea,bytea,bytea),public.worker_review_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_review_write(uuid,uuid,bigint,uuid,bytea,bytea,bytea),public.worker_review_read(uuid,uuid) to service_role;
commit;
