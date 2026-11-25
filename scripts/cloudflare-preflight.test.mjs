import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from './cloudflare-preflight.mjs';
const input={account:'a'.repeat(32),script:'agentsystems-gateway',token:'fixture-token'};
const success=()=>new Response(JSON.stringify({success:true,result:{bindings:[]}}));
test('read-only target and denied unrelated worker',async()=>{
 const calls=[];
 const r=await preflight({...input,fetcher:async(url,opts)=>{calls.push(url);assert.equal(opts.method,undefined);return url.includes('/agentsystems-gateway/')?success():new Response('',{status:403});}});
 assert.equal(calls.length,2);assert.equal(r.initialized,false);assert.equal(r.unrelatedWorkerAccess,'denied');
});
test('rejects token with access to unrelated worker',async()=>{
 await assert.rejects(preflight({...input,fetcher:async()=>success()}),/not denied/);
});
test('rejects missing target permission',async()=>{
 await assert.rejects(preflight({...input,fetcher:async()=>new Response('',{status:403})}),/Target access failed/);
});
