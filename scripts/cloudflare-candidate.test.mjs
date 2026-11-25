import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadCandidate} from './cloudflare-candidate.mjs';
const active='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222';
const params={account:'a'.repeat(32),script:'agent-worker',token:'fake',revision:'b'.repeat(40),code:'export default {}'};
function mock({divergent=false,extra=false}={}){
 const seen=[];
 return {seen,fetcher:async(url,init)=>{
   const path=url.split('/agent-worker')[1];seen.push([path,init.method||'GET']);
   let result;
   if(path==='/settings')result={compatibility_date:'2026-11-25',bindings:['MCP_ENABLED','REQUEST_LIMIT','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVER_KEY','SUPABASE_URL',...(extra?['UNREVIEWED']:[])].map(name=>({name}))};
   else if(path==='/deployments')result={deployments:[{versions:[{version_id:active,percentage:100}]}]};
   else if(path==='/versions')result={items:[{id:divergent?candidate:active,number:3}]};
   else if(path==='/versions?bindings_inherit=strict'){
     const m=JSON.parse(await init.body.get('metadata').text());assert.equal(m.bindings.length,5);assert.ok(m.bindings.every(b=>b.type==='inherit'));assert.equal(m.annotations['workers/commit_sha'],params.revision);result={id:candidate};
   }else throw Error('Unexpected route');
   return Response.json({success:true,result});
 }};
}
test('upload candidate preserves current deployment and records source',async()=>{const m=mock();const r=await uploadCandidate({...params,fetcher:m.fetcher});assert.equal(r.candidate,candidate);assert.equal(r.active,active);assert.equal(m.seen.filter(x=>x[1]==='POST').length,1);assert.ok(m.seen.every(x=>x[0]!=='/deployments'||x[1]==='GET'));});
test('refuse divergent latest version or unexpected binding',async()=>{for(const opts of [{divergent:true},{extra:true}]){const m=mock(opts);await assert.rejects(uploadCandidate({...params,fetcher:m.fetcher}));assert.equal(m.seen.filter(x=>x[1]==='POST').length,0);}});
test('refuse unconfigured release before networking',async()=>{const m=mock();await assert.rejects(uploadCandidate({...params,code:'https://gateway.example.invalid',fetcher:m.fetcher}));assert.equal(m.seen.length,0);});
