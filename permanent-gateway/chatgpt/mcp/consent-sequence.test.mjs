import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supabaseDecision,consentApi} from './consent-api.mjs';
import {gatewayOrigin,authProject,mcpResource} from './consent-policy.mjs';
const owner='12345678-1234-4234-8234-123456789abc',client='22345678-1234-4234-8234-123456789abc',id='request-a';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const review={authorization_id:id,client_id:client,client_name:'ChatGPT',redirect_uri:callback,resource:mcpResource,scope:'openid email',state:'pending'};
const details={authorization_id:id,client:{id:client},user:{id:owner},redirect_uri:callback,scope:review.scope};
const redirect={redirect_url:callback+'?code=example&state=example'};
test('real Auth sequence contract: details binds user before consent',async()=>{
 let associated=false;const calls=[];
 const fetcher=async(url,init)=>{
   calls.push([url,init.method]);assert.equal(init.redirect,'manual');
   if(init.method==='GET'){associated=true;return Response.json(details);}
   assert.equal(init.body,JSON.stringify({action:'approve'}));
   return associated?Response.json(redirect):Response.json({code:'oauth_authorization_not_found'},{status:404});
 };
 const r=await supabaseDecision('Bearer test','test-public',id,'approve',review,{owner},fetcher);
 assert.deepEqual(r,redirect);assert.deepEqual(calls,[[authProject+'/auth/v1/oauth/authorizations/'+id,'GET'],[authProject+'/auth/v1/oauth/authorizations/'+id+'/consent','POST']]);
});
test('mismatched user, client, callback or scopes cannot reach approval',async()=>{
 for(const patch of [{user:{id:client}},{client:{id:owner}},{redirect_uri:'https://evil.example/'},{scope:'different'}]){
  let n=0;await assert.rejects(supabaseDecision('Bearer test','test',id,'approve',review,{owner},async()=>{n++;return Response.json({...details,...patch});}),e=>e.code==='AUTHORIZATION_DETAILS_MISMATCH');assert.equal(n,1);
 }
});
test('previously consented request returns Auth redirect without second approval',async()=>{
 let n=0;const r=await supabaseDecision('Bearer test','test',id,'approve',review,{owner},async()=>{n++;return Response.json(redirect);});
 assert.equal(n,1);assert.deepEqual(r,redirect);
});
test('upstream 404 is specific; no approval if association failed',async()=>{
 let n=0;await assert.rejects(supabaseDecision('Bearer test','test',id,'approve',review,{owner},async()=>{n++;return Response.json({},{status:404});}),e=>e.status===404&&e.code==='AUTHORIZATION_NOT_FOUND');assert.equal(n,1);
});
test('approved request with lost callback requires fresh authorization',async()=>{
 await assert.rejects(supabaseDecision('Bearer test','test',id,'approve',{...review,state:'approved'},{owner},async()=>{throw Error('must not call');}),e=>e.code==='AUTHORIZATION_RESTART_REQUIRED');
});
test('explicit deny performs no Auth approval or grant',async()=>{
 const req=new Request(gatewayOrigin+'/oauth/decision',{method:'POST',headers:{Origin:gatewayOrigin,'Content-Type':'application/json'},body:JSON.stringify({authorization_id:id,decision:'deny'})});
 const r=await consentApi(req,{read:r=>r.json(),directOwner:async()=>({owner}),review:async()=>review,decision:async()=>{throw Error('must not call');},record:async()=>{throw Error('must not call');}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{denied:true});
});
