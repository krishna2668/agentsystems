import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {buildGateway,allowedMcpRoute,verifyDirect} from './gateway.mjs';
import {resource,issuer} from './server.mjs';
const origin=new URL(resource).origin;
const owner='12345678-1234-4234-8234-123456789abc',client='22345678-1234-4234-8234-123456789abc',session='32345678-1234-4234-8234-123456789abc';
const env={OWNER_ID:owner,MCP_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVER_KEY:'test-only-secret-never-valid-000000000',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only_00000000'};
const {privateKey,publicKey}=await generateKeyPair('ES256');
const token=async(oauth=false)=>new SignJWT({sub:owner,iss:issuer,aud:oauth?resource:'authenticated',role:'authenticated',is_anonymous:false,session_id:session,...(oauth?{client_id:client}:{})}).setProtectedHeader({alg:'ES256'}).setIssuedAt().setExpirationTime('5m').sign(privateKey);
const auth=await token(), oauth=await token(true);
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const review={authorization_id:'request-a',client_id:client,client_name:'ChatGPT',redirect_uri:callback,resource,scope:'openid',state:'pending'};
function fixture(overrides={}){
 const calls=[];
 const gw=buildGateway({jwksFactory:()=>publicKey,verifiedUser:async a=>{const {payload}=await jwtVerify(a.slice(7),publicKey,{issuer,audience:'authenticated'});return {id:payload.sub};},limiter:async()=>{},rpcCall:async(e,n,a)=>{calls.push(n);if(n==='worker_mcp_review')return review;if(n==='worker_mcp_direct_session'||n==='worker_mcp_session'||n==='worker_mcp_grant')return true;throw Error('Unexpected RPC');},decision:async()=>({redirect_url:callback+'?code=test&state=abc'}),dispatch:async(e,o,m,p,b)=>{calls.push(p);assert.equal(o,owner);return Response.json({devices:[]});},...overrides});
 return {gw,calls};
}
const get=(p,headers={})=>new Request(origin+p,{headers});
const post=(p,b,t=auth,o=origin)=>new Request(origin+p,{method:'POST',headers:{Origin:o,Authorization:'Bearer '+t,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(b)});
async function rpcBody(r){const t=await r.text();return r.headers.get('Content-Type')?.includes('text/event-stream')?JSON.parse(t.split('\n').find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(t);}
test('public consent assets use CSP and never return secret',async()=>{
 const {gw}=fixture();
 const r=await gw.fetch(get('/oauth/consent?authorization_id=request-a'),env);
 assert.equal(r.status,200);assert.ok(r.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
 assert.ok((await r.text()).includes('Connect ChatGPT'));
 const config=await gw.fetch(get('/oauth/config'),env);assert.deepEqual(await config.json(),{url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY});
});
test('consent requires direct owner session and same origin',async()=>{
 const {gw,calls}=fixture();
 assert.equal((await gw.fetch(post('/oauth/review',{authorization_id:'request-a'},oauth),env)).status,401);
 assert.equal((await gw.fetch(post('/oauth/decision',{authorization_id:'request-a',decision:'approve'},auth,'https://evil.example'),env)).status,403);
 assert.equal(calls.length,0);
 const r=await gw.fetch(post('/oauth/review',{authorization_id:'request-a'}),env);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{request:review});
 assert.deepEqual(calls,['worker_mcp_direct_session','worker_mcp_review']);
});
test('explicit approval records grant before returning redirect',async()=>{
 const {gw,calls}=fixture();const r=await gw.fetch(post('/oauth/decision',{authorization_id:'request-a',decision:'approve'}),env);
 assert.equal(r.status,200);assert.equal((await r.json()).redirect_url,callback+'?code=test&state=abc');assert.equal(calls.at(-1),'worker_mcp_grant');
});
test('unexpected redirect cannot create grant',async()=>{
 const {gw,calls}=fixture({decision:async()=>({redirect_url:'https://evil.example/?code=test'})});
 assert.equal((await gw.fetch(post('/oauth/decision',{authorization_id:'request-a',decision:'approve'}),env)).status,409);
 assert.ok(!calls.includes('worker_mcp_grant'));
});
test('OAuth cannot invoke direct owner approval endpoint',async()=>{
 const {gw,calls}=fixture();
 assert.equal((await gw.fetch(post('/owner/enrollments/approve',{},oauth),env)).status,401);
 assert.equal(calls.length,0);assert.equal(allowedMcpRoute('POST','/owner/enrollments/approve'),false);
 assert.equal(allowedMcpRoute('POST','/owner/knowledge/commit'),false);
});
test('MCP calls check exact audience and live session before dispatch',async()=>{
 const {gw,calls}=fixture();
 const msg={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_workers',arguments:{}}};
 const r=await gw.fetch(post('/mcp',msg,oauth),env);assert.deepEqual((await rpcBody(r)).result.structuredContent,{data:{devices:[]}});
 assert.deepEqual(calls,['worker_mcp_session','/owner/devices']);
 const rejected=await gw.fetch(post('/mcp',msg,auth),env);assert.equal((await rpcBody(rejected)).result.isError,true);
 assert.equal(calls.length,2);
});
test('revoked OAuth grant is rejected before dispatch',async()=>{
 const {gw,calls}=fixture({rpcCall:async()=>false});
 const r=await gw.fetch(post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_workers',arguments:{}}},oauth),env);
 assert.equal((await rpcBody(r)).result.isError,true);assert.equal(calls.length,0);
});
test('existing health endpoint unaffected',async()=>{
 const {gw}=fixture();const r=await gw.fetch(get('/health'),env);assert.equal(r.status,200);assert.equal((await r.json()).protocol,3);
});
test('second permitted user works without a configured owner ID; scope follows verified subject',async()=>{
 const other='42345678-1234-4234-8234-123456789abc';
 const signed=await new SignJWT({sub:other,iss:issuer,aud:resource,role:'authenticated',is_anonymous:false,client_id:client,session_id:session}).setProtectedHeader({alg:'ES256'}).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const seen=[];
 const {gw}=fixture({rpcCall:async(e,n,a)=>{assert.equal(n,'worker_mcp_session');assert.equal(a.p_owner,other);return true;},dispatch:async(e,o,m,p)=>{seen.push(o);return Response.json({devices:[]});}});
 const {OWNER_ID,...config}=env;
 const result=await rpcBody(await gw.fetch(post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_workers',arguments:{}}},signed),config));
 assert.deepEqual(result.result.structuredContent,{data:{devices:[]}});
 assert.deepEqual(seen,[other]);
});
test('signed-in user without an admitted account or live session cannot access resources',async()=>{
 const {gw,calls}=fixture({rpcCall:async()=>false});
 const r=await gw.fetch(get('/owner/devices',{Authorization:'Bearer '+auth}),env);
 assert.equal(r.status,403);assert.equal(calls.length,0);
});

test('Auth service verification is required and bound to the same JWT subject',async()=>{
 const bearer='Bearer '+auth;
 const verified=await verifyDirect(bearer,env,async(u,s)=>u===owner&&s===session,async()=>({id:owner}));
 assert.deepEqual(verified,{owner,session});
 await assert.rejects(verifyDirect(bearer,env,async()=>true,async()=>({id:client})),e=>e.status===401);
 await assert.rejects(verifyDirect(bearer,env,async()=>true,async()=>{throw Object.assign(Error('unavailable'),{status:503,code:'AUTH_UNAVAILABLE'});}),e=>e.status===503);
 await assert.rejects(verifyDirect(bearer,env,async()=>{throw Error('database unavailable');},async()=>({id:owner})),e=>e.status===503&&e.code==='SESSION_CHECK_UNAVAILABLE');
 await assert.rejects(verifyDirect(bearer,env,async()=>false,async()=>({id:owner})),e=>e.status===403);
});
test('consent reports upstream session-check failure without blaming user',async()=>{
 const {gw}=fixture({rpcCall:async()=>{throw Error('database unavailable');}});
 const r=await gw.fetch(post('/oauth/review',{authorization_id:'request-a'}),env);
 assert.equal(r.status,503);assert.equal((await r.json()).code,'SESSION_CHECK_UNAVAILABLE');
});
test('Cloudflare outbound requests never follow redirects carrying credentials',async()=>{
 const {getVerifiedUser}=await import('./gateway.mjs');
 const {supabaseDecision}=await import('./consent-api.mjs');
 const original=globalThis.fetch;
 const seen=[];
 globalThis.fetch=async(url,init)=>{seen.push(init.redirect);assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.example/'}});};
 try{
  await assert.rejects(getVerifiedUser('Bearer test',env),e=>e.status===503);
  await assert.rejects(supabaseDecision('Bearer test',env.SUPABASE_PUBLISHABLE_KEY,'request-a','approve',review,{owner}));
  assert.deepEqual(seen,['manual','manual']);
 }finally{globalThis.fetch=original;}
});
test('readiness requires working Auth, privileged RPC and JWKS; never exposes response bodies',async()=>{
 const {dependencyReadiness}=await import('./gateway.mjs');
 const fake=async(url,init)=>{assert.equal(init.redirect,'manual');return url.endsWith('/user')?new Response('private upstream body',{status:401}):Response.json({keys:[{kty:'EC',crv:'P-256'}]});};
 const r=await dependencyReadiness(env,async(e,n,a)=>{assert.equal(n,'worker_mcp_direct_session');assert.equal(a.p_owner,'00000000-0000-4000-8000-000000000000');return false;},fake);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ready'});
 const bad=await dependencyReadiness(env,async()=>{throw Error('private error');},fake);
 assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{status:'unavailable'});
});
test('Worker management is served securely; approval requires direct user session',async()=>{
 const {gw,calls}=fixture();
 const page=await gw.fetch(get('/workers'),env);
 assert.equal(page.status,200);assert.ok(page.headers.get('Content-Security-Policy').includes("form-action 'none'"));
 assert.ok((await page.text()).includes('id="deviceForm"'));
 assert.equal((await gw.fetch(get('/owner/devices'),env)).status,401);
 const data={code:"ABCDEFGH2345",request_id:client,confirmed:true};
 assert.equal((await gw.fetch(post('/owner/enrollments/approve',data,oauth),env)).status,401);
 assert.equal(calls.length,0);
 assert.equal((await gw.fetch(post('/owner/enrollments/approve',data,auth),env)).status,200);
 assert.deepEqual(calls,['worker_mcp_direct_session','/owner/enrollments/approve']);
});

test('media manifest delegated, raw artifact and capability permission not delegated',()=>{
 assert.equal(allowedMcpRoute('GET','/owner/jobs/'+session+'/artifact'),true);
 assert.equal(allowedMcpRoute('GET','/owner/jobs/'+session+'/artifact/0'),false);
 assert.equal(allowedMcpRoute('POST','/owner/devices/'+session+'/media-permission'),false);
});

test('App Links publish only the reviewed certificate; browser fallback reveals no media',async()=>{
 const {appLinkResponse}=await import('./gateway.mjs');
 const path='/.well-known/assetlinks.json',fingerprint=Array(32).fill('AB').join(':');
 assert.deepEqual(await appLinkResponse(path,'GET','').json(),[]);
 const r=appLinkResponse(path,'GET','',fingerprint);
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'dev.worker.test',sha256_cert_fingerprints:[fingerprint]}}]);
 const {gw,calls}=fixture({limiter:async()=>{throw Error('Static handoff must not depend on rate-limit service');}});
 const link=await gw.fetch(get('/artifacts/'+session),{});
 assert.equal(link.status,200);
 assert.equal(link.headers.get('Location'),null);
 assert.equal(link.headers.get('Cache-Control'),'no-store');
 assert.ok(link.headers.get('Content-Security-Policy').includes("connect-src 'none'"));
 assert.ok(link.headers.get('X-Robots-Tag').includes('noindex'));
 const html=await link.text();
 assert.ok(html.includes('Continue on your Android phone'));
 assert.ok(html.includes(origin+'/artifacts/'+session));
 assert.ok(html.includes('preview-qr'));
 assert.ok(!html.includes('/workers'));
 assert.ok(!html.includes('Sign in'));
 assert.ok(!html.includes('Your animation is ready'));
 assert.ok(!html.includes(env.SUPABASE_SERVER_KEY));
 assert.deepEqual(calls,[]);
 // Existence is never checked or disclosed; arbitrary syntactically valid
 // identifiers receive the same static handoff.
 const unknown=await gw.fetch(get('/artifacts/'+client),{});
 assert.equal((await unknown.text()).replaceAll(client,session),html);
 for(const [path,type] of [['/preview/client.js','application/javascript'],['/preview/style.css','text/css']]){
  const r=await gw.fetch(get(path),{});
  assert.equal(r.status,200);
  assert.ok(r.headers.get('Content-Type').startsWith(type));
  assert.ok((await r.text()).length>100);
  assert.equal((await gw.fetch(get(path+'?x=1'),{})).status,404);
 }
 assert.deepEqual(calls,[]);
 // Chat clients and browsers can append query parameters. Never echo them
 // or treat them as authorization, redirect targets or job identity.
 for(const suffix of ['?utm_source=chatgpt.com','?token=x&redirect=https://evil.example','/?utm_source=chatgpt','/']){
  const decorated=await gw.fetch(get('/artifacts/'+session+suffix),{});
  assert.equal(decorated.status,200);
  assert.equal(await decorated.text(),html);
 }
 const head=await gw.fetch(new Request(origin+'/artifacts/'+session+'?utm_source=chatgpt.com',{method:'HEAD'}),{});
 assert.equal(head.status,200);assert.equal(await head.text(),'');
 for(const path of ['/artifacts','/artifacts/','/artifacts/not-a-job','/artifacts/'+session+'/extra']){
  const invalid=await gw.fetch(get(path),{});
  assert.equal(invalid.status,404);
  assert.ok(invalid.headers.get('Content-Type').startsWith('text/html'));
  assert.ok((await invalid.text()).includes('Return to ChatGPT'));
 }
 assert.deepEqual(calls,[]);
 assert.equal((await gw.fetch(post(path,{}),env)).status,404);
 assert.equal((await gw.fetch(post('/artifacts/'+session,{}),env)).status,404);
});
