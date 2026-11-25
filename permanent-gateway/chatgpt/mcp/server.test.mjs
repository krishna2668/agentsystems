import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT,generateKeyPair} from 'jose';
import {serveMcp,resource,issuer,catalog,verifyOwnerToken,directOwnerTokenAllowed} from './server.mjs';
import {createHash} from 'node:crypto';
const owner='12345678-1234-4234-8234-123456789abc',client='22345678-1234-4234-8234-123456789abc',session='32345678-1234-4234-8234-123456789abc';
const req=(method,params={},headers={})=>new Request(resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
async function body(r){const raw=await r.text();return r.headers.get('Content-Type')?.includes('text/event-stream')?JSON.parse(raw.split('\n').find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(raw);}
const fixture=()=>{const calls=[];return {calls,host:{authenticate:async token=>{if(token!=='Bearer verified')throw Error('denied');return owner;},ownerRequest:async(...a)=>{calls.push(a);return {devices:[]};}}}};
test('catalog excludes approval and commit',()=>{assert.equal(catalog.length,17);assert.ok(catalog.every(t=>t.securitySchemes[0].type==='oauth2'));assert.ok(!catalog.some(t=>['approve_worker_request','commit_learning'].includes(t.name)));});
test('legacy initialization and list',async()=>{const {host}=fixture();let r=await serveMcp(req('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),{},host);assert.equal((await body(r)).result.protocolVersion,'2025-11-25');r=await serveMcp(req('tools/list'),{},host);const b=await body(r);assert.equal(b.result.tools.length,17);assert.equal(b.result.tools[0]._meta.securitySchemes[0].type,'oauth2');});
test('OAuth challenge and fail-closed authorization',async()=>{const {host,calls}=fixture();const r=await serveMcp(req('tools/call',{name:'list_workers',arguments:{}}),{MCP_ENABLED:'true'},host);const b=await body(r);assert.equal(b.result.isError,true);assert.ok(b.result._meta['mcp/www_authenticate']);assert.equal(calls.length,0);});
test('verified owner fixed route; privileged tool blocked',async()=>{const {host,calls}=fixture();const invoke=name=>serveMcp(req('tools/call',{name,arguments:{}},{Authorization:'Bearer verified'}),{MCP_ENABLED:'true'},host);assert.deepEqual((await body(await invoke('list_workers'))).result.structuredContent,{data:{devices:[]}});assert.deepEqual(calls[0],[owner,'GET','/owner/devices',undefined]);assert.equal((await body(await invoke('approve_worker_request'))).result.isError,true);assert.equal(calls.length,1);});
const pair=await generateKeyPair('ES256');const now=new Date();
async function token(claims={}){return new SignJWT({sub:owner,iss:issuer,aud:resource,role:'authenticated',is_anonymous:false,client_id:client,session_id:session,iat:Math.floor(now.getTime()/1000)-20,exp:Math.floor(now.getTime()/1000)+300,...claims}).setProtectedHeader({alg:'ES256'}).sign(pair.privateKey);}
const verifier={authorize:async(...ids)=>ids.join(':')===[owner,client,session].join(':'),jwks:pair.publicKey,now};
test('JWT signature, audience, owner, client, expiry and grant',async()=>{assert.equal(await verifyOwnerToken('Bearer '+await token(),verifier),owner);for(const override of [{aud:'authenticated'},{iss:'https://wrong.example'},{sub:client},{client_id:null},{session_id:null},{role:'service_role'},{is_anonymous:true},{exp:Math.floor(now.getTime()/1000)-1}])await assert.rejects(verifyOwnerToken('Bearer '+await token(override),verifier));await assert.rejects(verifyOwnerToken('Bearer '+await token(),{...verifier,authorize:async()=>false}));});
test('direct owner route rejects OAuth token',async()=>{assert.equal(directOwnerTokenAllowed('Bearer '+await token({aud:'authenticated'})),false);assert.equal(directOwnerTokenAllowed('Bearer '+await token({aud:'authenticated',client_id:null})),true);});
test('2026-07-28 SDK discovery and catalog over stateless HTTP',async()=>{
 const {host}=fixture();
 const headers={'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'server/discover'};
 const discover=await serveMcp(req('server/discover',{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'test',version:'1'}}},headers),{},host);
 const d=await body(discover);assert.ok(d.result?.supportedVersions?.includes('2026-07-28'),JSON.stringify(d));
 const list=await serveMcp(req('tools/list',{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}},{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'}),{},host);
 const l=await body(list);assert.equal(l.result?.tools?.length,17,JSON.stringify(l));
});
test('owner-only review returns a genuine image content block, never base64 text',async()=>{
 const jpeg=Buffer.concat([Buffer.from('ffd8ff','hex'),Buffer.alloc(100,23),Buffer.from('ffd9','hex')]);
 const job='12345678-1234-4234-8234-123456789abc';
 const data={job_id:job,source_sha256:'a'.repeat(64),sha256:createHash('sha256').update(jpeg).digest('hex'),mime_type:'image/jpeg',frames:6,image_b64:jpeg.toString('base64')};
 const {host,calls}=fixture();host.ownerRequest=async(...a)=>{calls.push(a);return data;};
 const call=(name)=>serveMcp(req('tools/call',{name,arguments:{job_id:job}},{Authorization:'Bearer verified'}),{MCP_ENABLED:'true'},host);
 const result=(await body(await call('inspect_video_frames'))).result;
 assert.equal(result.content[0].type,'image');assert.equal(result.content[0].mimeType,'image/jpeg');assert.equal(result.content[0].data,data.image_b64);
 assert.equal(result.structuredContent.data.frames,6);assert.ok(!JSON.stringify(result.content[1]).includes(data.image_b64));
 assert.deepEqual(calls[0],[owner,'GET','/owner/jobs/'+job+'/review-stills',undefined]);
 data.sha256='0'.repeat(64);
 const tampered=(await body(await call('inspect_video_frames'))).result;assert.equal(tampered.isError,true);assert.equal(tampered.content.some(c=>c.type==='image'),false);
});
