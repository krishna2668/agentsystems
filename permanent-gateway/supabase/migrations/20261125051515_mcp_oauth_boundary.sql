begin;
create table worker_private.mcp_grants (
 owner_id uuid not null references worker_private.owners(id),
 client_id uuid not null,
 resource text not null check(resource='https://gateway.example.invalid/mcp'),
 redirect_uri text not null check(redirect_uri='https://chatgpt.com/connector_platform_oauth_redirect' or redirect_uri ~ '^https://chatgpt[.]com/connector/oauth/[A-Za-z0-9_-]{1,200}$'),
 authorization_id text not null unique,
 granted_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 primary key(owner_id,client_id)
);
alter table worker_private.mcp_grants enable row level security;
revoke all on worker_private.mcp_grants from public,anon,authenticated,service_role;
grant usage on schema worker_private to supabase_auth_admin;
grant select on worker_private.mcp_grants to supabase_auth_admin;
create policy mcp_hook_read on worker_private.mcp_grants for select to supabase_auth_admin using(true);

-- Narrow privileged read. Auth schema is not exposed to clients; no general Auth-table grants.
create function worker_private.mcp_direct_session(p_owner uuid,p_session uuid)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
 join worker_private.owners o on o.id=u.id
 where s.id=p_session and s.user_id=p_owner and s.oauth_client_id is null
 and (s.not_after is null or s.not_after>clock_timestamp())
 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and (u.banned_until is null or u.banned_until<clock_timestamp()))
$$;
create function worker_private.mcp_review(p_owner uuid,p_session uuid,p_authorization text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('authorization_id',a.authorization_id,'client_id',c.id,'client_name',coalesce(c.client_name,'ChatGPT'),
 'redirect_uri',a.redirect_uri,'resource',a.resource,'scope',a.scope,'state',a.status::text)
 from auth.oauth_authorizations a join auth.oauth_clients c on c.id=a.client_id
 where worker_private.mcp_direct_session(p_owner,p_session)
 and a.authorization_id=p_authorization and (a.user_id is null or a.user_id=p_owner)
 and a.status::text in ('pending','approved') and a.expires_at>clock_timestamp()
 and c.deleted_at is null and a.code_challenge_method::text ilike 's256'
 and a.resource='https://gateway.example.invalid/mcp'
 and (a.redirect_uri='https://chatgpt.com/connector_platform_oauth_redirect' or a.redirect_uri ~ '^https://chatgpt[.]com/connector/oauth/[A-Za-z0-9_-]{1,200}$')
$$;

-- Called only after a direct owner session has explicitly consented through Supabase Auth.
create function worker_private.mcp_record_grant(p_owner uuid,p_session uuid,p_authorization text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r jsonb; c uuid;
begin
 r:=worker_private.mcp_review(p_owner,p_session,p_authorization);
 if r is null or r->>'state'<>'approved' then return false; end if;
 c:=(r->>'client_id')::uuid;
 if not exists(select 1 from auth.oauth_authorizations where authorization_id=p_authorization and user_id=p_owner and status::text='approved') or
 not exists(select 1 from auth.oauth_consents where user_id=p_owner and client_id=c and revoked_at is null) then return false; end if;
 insert into worker_private.mcp_grants(owner_id,client_id,resource,redirect_uri,authorization_id)
 values(p_owner,c,r->>'resource',r->>'redirect_uri',p_authorization)
 on conflict(owner_id,client_id) do update set granted_at=clock_timestamp(),revoked_at=null,authorization_id=excluded.authorization_id
 where worker_private.mcp_grants.resource=excluded.resource and worker_private.mcp_grants.redirect_uri=excluded.redirect_uri;
 return found;
end $$;

create function worker_private.mcp_session_allowed(p_owner uuid,p_client uuid,p_session uuid)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from worker_private.mcp_grants g
 join auth.sessions s on s.user_id=g.owner_id and s.oauth_client_id=g.client_id
 join auth.oauth_clients c on c.id=g.client_id
 join auth.oauth_consents a on a.user_id=g.owner_id and a.client_id=g.client_id
 join auth.users u on u.id=g.owner_id
 where g.owner_id=p_owner and g.client_id=p_client and s.id=p_session
 and g.revoked_at is null and a.revoked_at is null and c.deleted_at is null
 and (s.not_after is null or s.not_after>clock_timestamp())
 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and (u.banned_until is null or u.banned_until<clock_timestamp()))
$$;

-- Service role has only the narrow wrapper functions, not direct Auth-table access.
revoke all on function worker_private.mcp_direct_session(uuid,uuid),worker_private.mcp_review(uuid,uuid,text),worker_private.mcp_record_grant(uuid,uuid,text),worker_private.mcp_session_allowed(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function worker_private.mcp_review(uuid,uuid,text),worker_private.mcp_record_grant(uuid,uuid,text),worker_private.mcp_session_allowed(uuid,uuid,uuid),worker_private.mcp_direct_session(uuid,uuid) to service_role;
create function public.worker_mcp_review(p_owner uuid,p_session uuid,p_authorization text) returns jsonb language sql security invoker set search_path='' as $$ select worker_private.mcp_review(p_owner,p_session,p_authorization) $$;
create function public.worker_mcp_grant(p_owner uuid,p_session uuid,p_authorization text) returns boolean language sql security invoker set search_path='' as $$ select worker_private.mcp_record_grant(p_owner,p_session,p_authorization) $$;
create function public.worker_mcp_session(p_owner uuid,p_client uuid,p_session uuid) returns boolean language sql security invoker set search_path='' as $$ select worker_private.mcp_session_allowed(p_owner,p_client,p_session) $$;
create function public.worker_mcp_direct_session(p_owner uuid,p_session uuid) returns boolean language sql security invoker set search_path='' as $$ select worker_private.mcp_direct_session(p_owner,p_session) $$;
revoke all on function public.worker_mcp_review(uuid,uuid,text),public.worker_mcp_grant(uuid,uuid,text),public.worker_mcp_session(uuid,uuid,uuid),public.worker_mcp_direct_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_mcp_review(uuid,uuid,text),public.worker_mcp_grant(uuid,uuid,text),public.worker_mcp_session(uuid,uuid,uuid),public.worker_mcp_direct_session(uuid,uuid) to service_role;

-- Enable this hook through the supported Auth Hooks settings only after review.
-- Ordinary direct sign-ins retain their existing claims unchanged.
create function public.worker_mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare claims jsonb:=event->'claims'; target text;
begin
 if claims->>'client_id' is not null then
 select g.resource into target from worker_private.mcp_grants g
 where g.owner_id::text=event->>'user_id' and g.owner_id::text=claims->>'sub'
 and g.client_id::text=claims->>'client_id' and g.revoked_at is null;
 if target is not null then claims:=jsonb_set(claims,'{aud}',to_jsonb(target)); end if;
 end if;
 return jsonb_build_object('claims',claims);
end $$;
revoke all on function public.worker_mcp_access_token_hook(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.worker_mcp_access_token_hook(jsonb) to supabase_auth_admin;
commit;
