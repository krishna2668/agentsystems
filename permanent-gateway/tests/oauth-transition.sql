begin;
update auth.oauth_consents set revoked_at=null where client_id='00000000-0000-4000-8000-000000000101';
insert into auth.oauth_authorizations values
 ('transition-new','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','https://chatgpt.com/connector/oauth/abc','https://previous-gateway.example.invalid/mcp','openid','approved',now()+interval '10 minutes','s256'),
 ('transition-invalid','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','https://chatgpt.com/connector/oauth/abc','https://untrusted.example.invalid/mcp','openid','approved',now()+interval '10 minutes','s256'),
 ('transition-reuse','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','https://chatgpt.com/connector/oauth/abc','https://previous-gateway.example.invalid/mcp','openid','approved',now()+interval '10 minutes','s256');
insert into auth.oauth_consents values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102',null);
set role service_role;
do $$
declare a uuid:='00000000-0000-4000-8000-000000000001'; d uuid:='00000000-0000-4000-8000-000000000201'; c uuid:='00000000-0000-4000-8000-000000000101'; s uuid:='00000000-0000-4000-8000-000000000202';
begin
 assert public.worker_mcp_session(a,c,s);
 assert public.worker_mcp_review(a,d,'transition-new')->>'resource'='https://previous-gateway.example.invalid/mcp';
 assert public.worker_mcp_review(a,d,'transition-invalid') is null;
 assert not public.worker_mcp_grant(a,d,'transition-reuse');
 assert public.worker_mcp_grant(a,d,'transition-new');
 assert not has_function_privilege('authenticated','public.worker_mcp_grant(uuid,uuid,text)','EXECUTE');
end $$;
reset role;
set role supabase_auth_admin;
do $$
declare e jsonb:=jsonb_build_object('user_id','00000000-0000-4000-8000-000000000001','claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000001','aud','authenticated','client_id','00000000-0000-4000-8000-000000000101'));
begin
 assert public.worker_mcp_access_token_hook(e)->'claims'->>'aud'='https://gateway.example.invalid/mcp';
 assert public.worker_mcp_access_token_hook(jsonb_set(e,'{claims,client_id}','"00000000-0000-4000-8000-000000000102"'))->'claims'->>'aud'='https://previous-gateway.example.invalid/mcp';
 raise notice 'PASS: both exact audiences, isolated grants, existing session preserved, unknown resource rejected';
end $$;
reset role;
rollback;
