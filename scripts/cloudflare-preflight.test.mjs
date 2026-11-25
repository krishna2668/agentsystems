import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from './cloudflare-preflight.mjs';
const input={account:'a'.repeat(32),script:'example-gateway',deniedWorker:'another-worker',token:'fixture-token'};
const success=()=>new Response(JSON.stringify({success:true,result:{bindings:[]}}));
test('read-only target and denied unrelated worker',async()=>{
 const calls=[];
 const r=await preflight({...input,fetcher:async(url,opts)=>{calls.push(url);assert.equal(opts.method,undefined);return url.includes('/example-gateway/')?success():new Response('',{status:403});}});
 assert.equal(calls.length,2);assert.equal(r.initialized,false);assert.equal(r.unrelatedWorkerAccess,'denied');
});
test('rejects token with access to unrelated worker',async()=>{
 await assert.rejects(preflight({...input,fetcher:async()=>success()}),/denial not confirmed/);
});
test('rejects missing target permission',async()=>{
 await assert.rejects(preflight({...input,fetcher:async()=>new Response('',{status:403})}),/Target access failed/);
});

test('404 is inconclusive rather than permission denial',async()=>{
 await assert.rejects(preflight({...input,fetcher:async(url)=>url.includes('/example-gateway/')?success():new Response('',{status:404})}),/denial not confirmed/);
});
test('portable without negative control; reports not checked',async()=>{
 const r=await preflight({...input,deniedWorker:undefined,fetcher:async()=>success()});
 assert.equal(r.unrelatedWorkerAccess,'not_checked');
});
test('readiness permits supplementary bindings without relaxing upload inventory',async()=>{
 const r=await preflight({...input,deniedWorker:undefined,fetcher:async()=>new Response(JSON.stringify({success:true,result:{bindings:['MCP_ENABLED','REQUEST_LIMIT','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVER_KEY','SUPABASE_URL','OWNER_ID'].map(name=>({name}))}}))});
 assert.equal(r.initialized,true);
});
