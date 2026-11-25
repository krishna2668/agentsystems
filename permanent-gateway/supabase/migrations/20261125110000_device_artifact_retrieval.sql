begin;
-- Only the trusted gateway calls this after verifying the signed request.
create function public.worker_device_artifact(p_device uuid,p_nonce uuid,p_stamp bigint,p_job uuid,p_seq integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d worker_private.devices%rowtype; r jsonb; t timestamptz:=clock_timestamp();
begin
 select * into d from worker_private.devices where id=p_device for update;
 if not found or d.revoked_at is not null or p_stamp is null or abs(extract(epoch from t)-p_stamp::numeric)>120 then return jsonb_build_object('status',401); end if;
 insert into worker_private.nonces(device_id,nonce) values(p_device,p_nonce) on conflict do nothing;
 if not found then return jsonb_build_object('status',409); end if;
 if not d.media_enabled or d.media_version<>1 then return jsonb_build_object('status',403); end if;
 if not exists(select 1 from worker_private.jobs where id=p_job and device_id=d.id and owner_id=d.owner_id and state='completed' and capability='media.animatic.render') then return jsonb_build_object('status',404); end if;
 if p_seq is null then r:=public.worker_media_manifest(d.owner_id,p_job);
 elsif p_seq between 0 and 31 then r:=public.worker_media_artifact(d.owner_id,p_job,p_seq);
 else return jsonb_build_object('status',400); end if;
 if r is null then return jsonb_build_object('status',404); end if;
 return jsonb_build_object('status',200,'artifact',r);
end $$;
revoke all on function public.worker_device_artifact(uuid,uuid,bigint,uuid,integer) from public,anon,authenticated;
grant execute on function public.worker_device_artifact(uuid,uuid,bigint,uuid,integer) to service_role;
commit;
