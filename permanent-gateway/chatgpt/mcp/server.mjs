import {Server,createMcpHandler} from '@modelcontextprotocol/server';
import {jwtVerify,createRemoteJWKSet,decodeJwt} from 'jose';
import {definitions,executeTool} from '../tools.mjs';
import {knowledgeDefinitions,executeKnowledgeTool} from '../knowledge.mjs';
export const resource='https://gateway.example.invalid/mcp';
export const issuer='https://example.supabase.co/auth/v1';
const metadata=resource.replace(/\/mcp$/,'/.well-known/oauth-protected-resource/mcp');
const challenge='Bearer resource_metadata="'+metadata+'"';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const schemes=[{type:'oauth2',scopes:[]}];
// Human device approval and knowledge commits are not model-accessible.
export const catalog=[...definitions.filter(t=>t.name!=='approve_worker_request'),...knowledgeDefinitions].map(t=>({...t,securitySchemes:schemes,_meta:{securitySchemes:schemes}}));
export function directOwnerTokenAllowed(auth){
 try{const p=decodeJwt((auth||'').replace(/^Bearer /,''));return p.iss===issuer&&p.aud==='authenticated'&&p.role==='authenticated'&&p.client_id==null&&p.is_anonymous!==true;}catch{return false;}
}
export async function verifyOwnerToken(auth,{authorize,jwks=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json')),now=new Date()}){
 if(!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(auth||''))throw Error('Owner authorization required');
 const {payload:p}=await jwtVerify(auth.slice(7),jwks,{issuer,audience:resource,algorithms:['ES256'],requiredClaims:['sub','iat','exp','session_id','client_id'],maxTokenAge:'1h',currentDate:now});
 if(!uuid.test(p.sub||'')||!uuid.test(p.client_id||'')||!uuid.test(p.session_id||'')||p.role!=='authenticated'||p.is_anonymous!==false||!Number.isInteger(p.iat)||!Number.isInteger(p.exp)||p.exp-p.iat>3600||!(p.aud===resource||Array.isArray(p.aud)&&p.aud.length===1&&p.aud[0]===resource))throw Error('Owner authorization required');
 if(typeof authorize!=='function'||await authorize(p.sub,p.client_id,p.session_id)!==true)throw Error('Owner authorization revoked or unavailable');
 return p.sub;
}
function json(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function authError(message){return {resultType:'complete',isError:true,content:[{type:'text',text:message}],_meta:{'mcp/www_authenticate':[challenge]}};}
// MCP image blocks give the model actual pixels, not a URL or a base64 text dump.
// Verify the bounded server-owned evidence before exposing it as an image.
export async function reviewImage(data,job){
 if(data?.job_id!==job||data?.mime_type!=='image/jpeg'||data?.frames!==6||typeof data.image_b64!=='string'||data.image_b64.length>Math.ceil(196608/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.image_b64)||!/^[a-f0-9]{64}$/.test(data.sha256||'')||!/^[a-f0-9]{64}$/.test(data.source_sha256||''))throw Error('Invalid review evidence');
 const bytes=Uint8Array.from(atob(data.image_b64),c=>c.charCodeAt(0));
 if(bytes.length<100||bytes.length>196608||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Invalid review image');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==data.sha256)throw Error('Review evidence digest mismatch');
 const metadata={job_id:job,source_sha256:data.source_sha256,sha256:hash,frames:6,provenance:'signed_device_capture',creative_quality:'unreviewed'};
 return {resultType:'complete',content:[{type:'image',mimeType:'image/jpeg',data:data.image_b64},{type:'text',text:JSON.stringify(metadata)}],structuredContent:{data:metadata}};
}
export async function serveMcp(req,env,host){
 const url=new URL(req.url);
 if(url.origin!==new URL(resource).origin)return json({error:'Invalid host'},400);
 if((url.pathname==='/.well-known/oauth-protected-resource/mcp'||url.pathname==='/.well-known/oauth-protected-resource')&&req.method==='GET')return json({resource,authorization_servers:[issuer],bearer_methods_supported:['header']});
 if(url.pathname!=='/mcp'||url.search)return json({error:'Unknown MCP route'},404);
 const origin=req.headers.get('Origin');
 if(origin&&origin!==url.origin&&origin!=='https://chatgpt.com'&&origin!=='https://chat.openai.com')return json({error:'Origin denied'},403);
 if(req.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 const handler=createMcpHandler(()=>{
  const server=new Server({name:'agent-system-worker',title:'AgentSystems',version:'1.0.0'},{capabilities:{tools:{listChanged:false}}});
  server.setRequestHandler('tools/list',async()=>({tools:catalog}));
  server.setRequestHandler('tools/call',async({params})=>{
   if(env.MCP_ENABLED!=='true')return authError('Owner OAuth connection is not configured.');
   let owner;try{owner=await host.authenticate(req.headers.get('Authorization'));}catch{return authError('Authenticate as the authorized owner.');}
   if(!uuid.test(owner||''))return authError('Owner authorization required.');
   if(!catalog.some(t=>t.name===params.name))return {resultType:'complete',isError:true,content:[{type:'text',text:'Unsupported tool'}]};
   const adapter={ownerRequest:(method,path,body)=>host.ownerRequest(owner,method,path,body)};
   try{
    const call=knowledgeDefinitions.some(t=>t.name===params.name)?executeKnowledgeTool:executeTool;
    const data=await call(params.name,params.arguments??{},adapter);
    if(params.name==='inspect_video_frames')return await reviewImage(data,params.arguments?.job_id);
    return {resultType:'complete',content:[{type:'text',text:JSON.stringify(data)}],structuredContent:{data}};
   }catch{return {resultType:'complete',isError:true,content:[{type:'text',text:'Worker request rejected or unavailable.'}]};}
  });
  return server;
 },{legacy:'stateless',responseMode:'json',maxRequestBodySize:65536});
 return handler.fetch(req);
}
