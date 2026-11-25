-- Admit only the two exact deployment resources during account cutover.
-- Existing grants retain their original audience; a separate client is required
-- for the new audience. No grant, session, identity or hook is rewritten.
begin;
alter table worker_private.mcp_grants drop constraint mcp_grants_resource_check;
alter table worker_private.mcp_grants add constraint mcp_grants_resource_check
 check(resource in ('https://gateway.example.invalid/mcp','https://previous-gateway.example.invalid/mcp'));
create or replace function worker_private.mcp_review(p_owner uuid,p_session uuid,p_authorization text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('authorization_id',a.authorization_id,'client_id',c.id,'client_name',coalesce(c.client_name,'ChatGPT'),
 'redirect_uri',a.redirect_uri,'resource',a.resource,'scope',a.scope,'state',a.status::text)
 from auth.oauth_authorizations a join auth.oauth_clients c on c.id=a.client_id
 where worker_private.mcp_direct_session(p_owner,p_session)
 and a.authorization_id=p_authorization and (a.user_id is null or a.user_id=p_owner)
 and a.status::text in ('pending','approved') and a.expires_at>clock_timestamp()
 and c.deleted_at is null and a.code_challenge_method::text ilike 's256'
 and a.resource in ('https://gateway.example.invalid/mcp','https://previous-gateway.example.invalid/mcp')
 and (a.redirect_uri='https://chatgpt.com/connector_platform_oauth_redirect' or a.redirect_uri ~ '^https://chatgpt[.]com/connector/oauth/[A-Za-z0-9_-]{1,200}$')
$$;

commit;
