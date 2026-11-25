-- Local test-only Auth schema. Never apply to Supabase.
create role supabase_auth_admin;
create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null,oauth_client_id uuid,not_after timestamptz);
create table auth.oauth_clients(id uuid primary key,client_name text,deleted_at timestamptz);
create table auth.oauth_authorizations(authorization_id text primary key,client_id uuid,user_id uuid,redirect_uri text,resource text,scope text,status text,expires_at timestamptz,code_challenge_method text);
create table auth.oauth_consents(user_id uuid,client_id uuid,revoked_at timestamptz);
