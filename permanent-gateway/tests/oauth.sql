insert into auth.users values('00000000-0000-4000-8000-000000000001',now(),false,null),('00000000-0000-4000-8000-000000000002',now(),false,null);
insert into auth.oauth_clients values('00000000-0000-4000-8000-000000000101','ChatGPT',null),('00000000-0000-4000-8000-000000000102','Other',null);
insert into auth.sessions values('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001',null,null),('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101',null);
insert into auth.oauth_authorizations values
 ('request-a','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','https://chatgpt.com/connector/oauth/abc','https://gateway.example.invalid/mcp','openid','pending',now()+interval '10 minutes','s256'),
 ('request-b','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','https://chatgpt.com.evil.example/connector/oauth/abc','https://gateway.example.invalid/mcp','openid','approved',now()+interval '10 minutes','s256');
set role service_role;
do $$
declare a uuid:='00000000-0000-4000-8000-000000000001'; b uuid:='00000000-0000-4000-8000-000000000002'; c uuid:='00000000-0000-4000-8000-000000000101'; d uuid:='00000000-0000-4000-8000-000000000201'; s uuid:='00000000-0000-4000-8000-000000000202';
begin
 assert public.worker_mcp_direct_session(a,d);
 assert not public.worker_mcp_direct_session(a,s);
 assert not public.worker_mcp_direct_session(b,d);
 assert public.worker_mcp_review(a,d,'request-a')->>'state'='pending';
 assert public.worker_mcp_review(a,d,'request-b') is null;
 assert public.worker_mcp_review(a,s,'request-a') is null;
 assert not public.worker_mcp_grant(a,d,'request-a');
 assert not public.worker_mcp_session(a,c,s);
end $$;
reset role;
update auth.oauth_authorizations set status='approved' where authorization_id='request-a';
insert into auth.oauth_consents values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101',null);
set role service_role;
do $$
declare a uuid:='00000000-0000-4000-8000-000000000001'; c uuid:='00000000-0000-4000-8000-000000000101'; d uuid:='00000000-0000-4000-8000-000000000201'; s uuid:='00000000-0000-4000-8000-000000000202';
begin
 assert public.worker_mcp_grant(a,d,'request-a');
 assert public.worker_mcp_session(a,c,s);
 assert not public.worker_mcp_session(a,c,d);
 assert not public.worker_mcp_grant(a,s,'request-a');
 assert not has_table_privilege('service_role','worker_private.mcp_grants','INSERT');
 raise notice 'PASS: owner session, trusted redirect, explicit OAuth approval, exact client and live session';
end $$;
reset role;
set role supabase_auth_admin;
do $$
declare e jsonb:=jsonb_build_object('user_id','00000000-0000-4000-8000-000000000001','claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000001','aud','authenticated','client_id','00000000-0000-4000-8000-000000000101','role','authenticated'));
begin
 assert public.worker_mcp_access_token_hook(e)->'claims'->>'aud'='https://gateway.example.invalid/mcp';
 assert public.worker_mcp_access_token_hook(e #- '{claims,client_id}')->'claims'->>'aud'='authenticated';
 assert public.worker_mcp_access_token_hook(jsonb_set(e,'{claims,client_id}','"00000000-0000-4000-8000-000000000102"'))->'claims'->>'aud'='authenticated';
 assert public.worker_mcp_access_token_hook(e)->'claims'->>'role'='authenticated';
 raise notice 'PASS: exact resource audience, unrelated sign-ins unchanged';
end $$;
reset role;
update auth.oauth_consents set revoked_at=now();
set role service_role;
do $$ begin
 assert not public.worker_mcp_session('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000202');
 assert not has_function_privilege('authenticated','public.worker_mcp_grant(uuid,uuid,text)','EXECUTE');
 assert not has_function_privilege('anon','public.worker_mcp_access_token_hook(jsonb)','EXECUTE');
 raise notice 'PASS: revoked consent and restricted privileges';
end $$;
reset role;
