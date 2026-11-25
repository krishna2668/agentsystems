begin;
-- Knowledge is evidence, never executable permission or an authority grant.
create table worker_private.profiles (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references worker_private.owners(id),
 scope text not null check(scope in ('owner','project','domain','skill','quality','worker')),
 label text not null check(length(label) between 1 and 160),
 created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,scope,label)
);
create table worker_private.observations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null, profile_id uuid not null,
 idem text not null check(length(idem) between 1 and 128),
 source_kind text not null check(source_kind in ('owner_statement','execution','review','experiment','external_reference')),
 source_ref text not null check(length(source_ref) between 1 and 512),
 body text not null check(length(body) between 1 and 12000),
 created_at timestamptz not null default now(),
 foreign key(owner_id,profile_id) references worker_private.profiles(owner_id,id),
 unique(owner_id,profile_id,id), unique(owner_id,idem)
);
create table worker_private.knowledge_entries (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null, profile_id uuid not null,
 key text not null check(length(key) between 1 and 160),
 current_revision integer not null default 0 check(current_revision>=0),
 foreign key(owner_id,profile_id) references worker_private.profiles(owner_id,id),
 unique(owner_id,profile_id,id), unique(owner_id,profile_id,key)
);
create table worker_private.learning_proposals (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null, profile_id uuid not null, entry_id uuid not null,
 evidence_id uuid not null,
 expected_revision integer not null check(expected_revision>=0),
 kind text not null check(kind in ('fact','preference','decision','rule','experience','hypothesis','validated_learning','unresolved')),
 body text not null check(length(body) between 1 and 12000),
 rationale text not null check(length(rationale) between 1 and 4000),
 state text not null default 'pending' check(state in ('pending','committed','rejected')),
 created_at timestamptz not null default now(), decided_at timestamptz,
 foreign key(owner_id,profile_id,entry_id) references worker_private.knowledge_entries(owner_id,profile_id,id),
 foreign key(owner_id,profile_id,evidence_id) references worker_private.observations(owner_id,profile_id,id),
 unique(owner_id,profile_id,entry_id,id),
 check((state='pending')=(decided_at is null))
);
create table worker_private.knowledge_revisions (
 owner_id uuid not null, profile_id uuid not null, entry_id uuid not null,
 revision integer not null check(revision>0),
 proposal_id uuid not null unique,
 kind text not null, body text not null, evidence_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(entry_id,revision),
 foreign key(owner_id,profile_id,entry_id,proposal_id) references worker_private.learning_proposals(owner_id,profile_id,entry_id,id),
 foreign key(owner_id,profile_id,evidence_id) references worker_private.observations(owner_id,profile_id,id)
);
alter table worker_private.profiles enable row level security;
alter table worker_private.observations enable row level security;
alter table worker_private.knowledge_entries enable row level security;
alter table worker_private.learning_proposals enable row level security;
alter table worker_private.knowledge_revisions enable row level security;
revoke all on worker_private.profiles,worker_private.observations,worker_private.knowledge_entries,worker_private.learning_proposals,worker_private.knowledge_revisions from public,anon,authenticated,service_role;
grant select,insert on worker_private.profiles,worker_private.observations,worker_private.knowledge_revisions to service_role;
grant select,insert,update on worker_private.knowledge_entries,worker_private.learning_proposals to service_role;

create function public.worker_profile_create(p_owner uuid,p_scope text,p_label text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p worker_private.profiles%rowtype;
begin
 if not exists(select 1 from worker_private.owners where id=p_owner) then return jsonb_build_object('status',403); end if;
 if p_scope is null or p_scope not in ('owner','project','domain','skill','quality','worker') or p_label is null or length(p_label) not between 1 and 160 then return jsonb_build_object('status',400); end if;
 insert into worker_private.profiles(owner_id,scope,label) values(p_owner,p_scope,p_label) on conflict(owner_id,scope,label) do nothing returning * into p;
 if not found then select * into p from worker_private.profiles where owner_id=p_owner and scope=p_scope and label=p_label; end if;
 return jsonb_build_object('status',200,'profile_id',p.id);
end $$;

create function public.worker_observe(p_owner uuid,p_profile uuid,p_idem text,p_kind text,p_ref text,p_body text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o worker_private.observations%rowtype;
begin
 if not exists(select 1 from worker_private.profiles where owner_id=p_owner and id=p_profile) then return jsonb_build_object('status',404); end if;
 if p_idem is null or length(p_idem) not between 1 and 128 or p_kind is null or p_kind not in ('owner_statement','execution','review','experiment','external_reference') or p_ref is null or length(p_ref) not between 1 and 512 or p_body is null or length(p_body) not between 1 and 12000 then return jsonb_build_object('status',400); end if;
 insert into worker_private.observations(owner_id,profile_id,idem,source_kind,source_ref,body)
 values(p_owner,p_profile,p_idem,p_kind,p_ref,p_body) on conflict(owner_id,idem) do nothing returning * into o;
 if found then return jsonb_build_object('status',201,'observation_id',o.id); end if;
 select * into o from worker_private.observations where owner_id=p_owner and idem=p_idem;
 if o.profile_id is distinct from p_profile or o.source_kind is distinct from p_kind or o.source_ref is distinct from p_ref or o.body is distinct from p_body then return jsonb_build_object('status',409); end if;
 return jsonb_build_object('status',200,'observation_id',o.id);
end $$;

create function public.worker_propose_learning(p_owner uuid,p_profile uuid,p_key text,p_expected integer,p_evidence uuid,p_kind text,p_body text,p_rationale text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e worker_private.knowledge_entries%rowtype; p worker_private.learning_proposals%rowtype; source text;
begin
 select source_kind into source from worker_private.observations where owner_id=p_owner and profile_id=p_profile and id=p_evidence;
 if not found then return jsonb_build_object('status',404); end if;
 if p_key is null or length(p_key) not between 1 and 160 or p_expected is null or p_expected<0 or p_kind is null or p_kind not in ('fact','preference','decision','rule','experience','hypothesis','validated_learning','unresolved') or p_body is null or length(p_body) not between 1 and 12000 or p_rationale is null or length(p_rationale) not between 1 and 4000 then return jsonb_build_object('status',400); end if;
 -- Evidence classification is not proof of correctness. This proposal still requires review.
 if p_kind='validated_learning' and source not in ('experiment','review','execution') then return jsonb_build_object('status',422); end if;
 if p_expected=0 then
 insert into worker_private.knowledge_entries(owner_id,profile_id,key) values(p_owner,p_profile,p_key) on conflict(owner_id,profile_id,key) do nothing;
 end if;
 select * into e from worker_private.knowledge_entries where owner_id=p_owner and profile_id=p_profile and key=p_key for update;
 if not found or e.current_revision<>p_expected then return jsonb_build_object('status',409); end if;
 insert into worker_private.learning_proposals(owner_id,profile_id,entry_id,evidence_id,expected_revision,kind,body,rationale)
 values(p_owner,p_profile,e.id,p_evidence,p_expected,p_kind,p_body,p_rationale) returning * into p;
 return jsonb_build_object('status',201,'proposal_id',p.id,'entry_id',e.id,'state','pending');
end $$;

-- Reserved for the trusted owner-consent adapter. Do not expose as a general agent tool.
create function public.worker_decide_learning(p_owner uuid,p_proposal uuid,p_accept boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p worker_private.learning_proposals%rowtype; e worker_private.knowledge_entries%rowtype; n integer;
begin
 if p_accept is null then return jsonb_build_object('status',400); end if;
 select * into p from worker_private.learning_proposals where owner_id=p_owner and id=p_proposal for update;
 if not found then return jsonb_build_object('status',404); end if;
 if p.state<>'pending' then
  if (p.state='committed')=p_accept then return jsonb_build_object('status',200,'state',p.state); end if;
  return jsonb_build_object('status',409);
 end if;
 if not p_accept then
  update worker_private.learning_proposals set state='rejected',decided_at=clock_timestamp() where id=p.id;
  return jsonb_build_object('status',200,'state','rejected');
 end if;
 select * into e from worker_private.knowledge_entries where owner_id=p_owner and id=p.entry_id for update;
 if not found or e.current_revision<>p.expected_revision then return jsonb_build_object('status',409); end if;
 n:=e.current_revision+1;
 insert into worker_private.knowledge_revisions(owner_id,profile_id,entry_id,revision,proposal_id,kind,body,evidence_id)
 values(p_owner,p.profile_id,p.entry_id,n,p.id,p.kind,p.body,p.evidence_id);
 update worker_private.knowledge_entries set current_revision=n where id=e.id;
 update worker_private.learning_proposals set state='committed',decided_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('status',200,'state','committed','revision',n);
end $$;

create function public.worker_get_context(p_owner uuid,p_profile uuid,p_limit integer default 30)
returns jsonb language sql security invoker set search_path='' as $$
 select case when exists(select 1 from worker_private.profiles where owner_id=p_owner and id=p_profile)
 then coalesce((select jsonb_agg(x.row order by x.key) from (
 select e.key,jsonb_build_object('key',e.key,'revision',r.revision,'kind',r.kind,'body',r.body,
 'evidence',jsonb_build_object('id',o.id,'source_kind',o.source_kind,'source_ref',o.source_ref)) as row
 from worker_private.knowledge_entries e join worker_private.knowledge_revisions r on r.entry_id=e.id and r.revision=e.current_revision
 join worker_private.observations o on o.id=r.evidence_id
 where e.owner_id=p_owner and e.profile_id=p_profile order by e.key limit greatest(1,least(coalesce(p_limit,30),50))
 ) x),'[]'::jsonb) else null end
$$;
revoke all on function public.worker_profile_create(uuid,text,text),public.worker_observe(uuid,uuid,text,text,text,text),public.worker_propose_learning(uuid,uuid,text,integer,uuid,text,text,text),public.worker_decide_learning(uuid,uuid,boolean),public.worker_get_context(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.worker_profile_create(uuid,text,text),public.worker_observe(uuid,uuid,text,text,text,text),public.worker_propose_learning(uuid,uuid,text,integer,uuid,text,text,text),public.worker_decide_learning(uuid,uuid,boolean),public.worker_get_context(uuid,uuid,integer) to service_role;
commit;
