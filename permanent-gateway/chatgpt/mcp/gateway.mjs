import gateway,{dispatchOwner,rpc,limit,validConfig,readBounded,parse} from '../../edge/worker.mjs';
import {serveMcp,verifyOwnerToken,directOwnerTokenAllowed,issuer,resource} from './server.mjs';
import {decodeJwt,createRemoteJWKSet} from 'jose';
import {consentApi,supabaseDecision} from './consent-api.mjs';
import {gatewayOrigin,authProject} from './consent-policy.mjs';
import {assets} from './consent-assets.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const enc=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' "+authProject+"; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"};
export function allowedMcpRoute(method,path){
 return (method==='GET'&&(path==='/owner/devices'||/^\/owner\/jobs\/[0-9a-f-]{36}(?:\/artifact)?$/.test(path)))||
 (method==='POST'&&['/owner/enrollments/lookup','/owner/jobs','/owner/knowledge/profiles','/owner/knowledge/context','/owner/knowledge/history','/owner/knowledge/observations','/owner/knowledge/job-evidence','/owner/knowledge/proposals'].includes(path));
}
function authProblem(status,code){return Object.assign(new Error(code),{status,code});}
export async function getVerifiedUser(auth,env){
 // Supabase Auth verifies the exact bearer token. This accepts the project's
 // current signing keys and rotation policy without a second JWKS dependency.
 if(env.SUPABASE_URL!==authProject)throw authProblem(503,'AUTH_CONFIGURATION');
 let r;
 try{r=await fetch(authProject+'/auth/v1/user',{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(8000)});}
 catch{throw authProblem(503,'AUTH_UNAVAILABLE');}
 if(r.status===401||r.status===403)throw authProblem(401,'SESSION_INVALID');
 if(!r.ok)throw authProblem(503,'AUTH_UNAVAILABLE');
 try{return await r.json();}catch{throw authProblem(503,'AUTH_UNAVAILABLE');}
}
export async function verifyDirect(auth,env,sessionCheck,verifiedUser=getVerifiedUser){
 if(!directOwnerTokenAllowed(auth)||!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(auth||''))throw authProblem(401,'SESSION_INVALID');
 // Claims are only trusted after the Auth server validates this same token.
 const user=await verifiedUser(auth,env);
 let p;try{p=decodeJwt(auth.slice(7));}catch{throw authProblem(401,'SESSION_INVALID');}
 const now=Math.floor(Date.now()/1000);
 if(!uuid.test(p.sub||'')||user?.id!==p.sub||p.iss!==issuer||p.aud!=='authenticated'||p.client_id!=null||p.role!=='authenticated'||p.is_anonymous!==false||!uuid.test(p.session_id||'')||!Number.isInteger(p.iat)||!Number.isInteger(p.exp)||p.exp<=now||p.iat>now+30||now-p.iat>3600)throw authProblem(401,'SESSION_INVALID');
 let allowed;try{allowed=await sessionCheck(p.sub,p.session_id);}catch{throw authProblem(503,'SESSION_CHECK_UNAVAILABLE');}
 if(allowed!==true)throw authProblem(403,'ACCOUNT_NOT_ADMITTED');
 return {owner:p.sub,session:p.session_id};
}
// Bounded dependency readiness, not an authorization check. No user data,
 // credentials, upstream bodies or infrastructure details are exposed.
export async function dependencyReadiness(env,rpcCall=rpc,fetcher=fetch){
 const invalid='00000000-0000-4000-8000-000000000000';
 const checks=await Promise.allSettled([
   (async()=>{const r=await fetcher(authProject+'/auth/v1/user',{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY},redirect:'manual',signal:AbortSignal.timeout(8000)});return r.status===401;})(),
   (async()=>await rpcCall(env,'worker_mcp_direct_session',{p_owner:invalid,p_session:invalid})===false)(),
   (async()=>{const r=await fetcher(issuer+'/.well-known/jwks.json',{redirect:'manual',signal:AbortSignal.timeout(8000)});if(r.status!==200)return false;const body=await r.json();return Array.isArray(body.keys)&&body.keys.some(k=>k.kty==='EC'&&k.crv==='P-256');})()
 ]);
 const ready=checks.every(c=>c.status==='fulfilled'&&c.value===true);
 return json({status:ready?'ready':'unavailable'},ready?200:503);
}
function asset(path){
 if(path==='/'||path==='/oauth/consent'||path==='/workers')return new Response(path==='/workers'?assets.html.replace('AgentSystems — authorize connection','AgentSystems — Workers').replace('<h1>Connect ChatGPT</h1><p>Connect ChatGPT to your AgentSystems account.</p>','<h1>Workers</h1><p>Connect and view your devices.</p>').replace('Checking connection request…','Checking sign-in…'):assets.html,{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/oauth/client.js')return new Response(assets.js,{headers:{...security,'Content-Type':'application/javascript; charset=utf-8'}});
 if(path==='/oauth/style.css')return new Response(assets.css,{headers:{...security,'Content-Type':'text/css; charset=utf-8'}});
 return null;
}
export function buildGateway({rpcCall=rpc,limiter=limit,dispatch=dispatchOwner,jwksFactory=()=>createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json')),decision=supabaseDecision,verifiedUser=getVerifiedUser}={}){
 return {async fetch(req,env){
  try{
   const url=new URL(req.url),path=url.pathname;
   if(url.origin!==gatewayOrigin)return json({error:'Invalid host'},400);
   const isMcp=path==='/mcp'||path==='/\.well-known/oauth-protected-resource'||path==='/\.well-known/oauth-protected-resource/mcp';
   const isOauth=path==='/'||path==='/workers'||path.startsWith('/oauth/');
   const isReady=path==='/ready';
   if(!isMcp&&!isOauth&&!isReady&&!path.startsWith('/owner/'))return gateway.fetch(req,env);
   validConfig(env);
   await limiter(env,'gateway-total');
   await limiter(env,'client:'+(req.headers.get('CF-Connecting-IP')||'unknown'));
   if(isReady){if(req.method!=='GET'||url.search)return json({error:'Not found'},404);await limiter(env,'dependency-readiness');return dependencyReadiness(env,rpcCall);}
   // Do not construct a remote JWKS loader until a signed-token check is needed.
   const direct=auth=>verifyDirect(auth,env,(owner,session)=>rpcCall(env,'worker_mcp_direct_session',{p_owner:owner,p_session:session}),verifiedUser);
   if(isMcp){
    return serveMcp(req,env,{
     authenticate:auth=>verifyOwnerToken(auth,{jwks:jwksFactory(),authorize:(owner,client,session)=>rpcCall(env,'worker_mcp_session',{p_owner:owner,p_client:client,p_session:session})}),
     ownerRequest:async(owner,method,path,body)=>{
      if(!uuid.test(owner||'')||!allowedMcpRoute(method,path))throw Error('Operation not delegated');
      const r=await dispatch(env,owner,method,path,body===undefined?new Uint8Array():enc.encode(JSON.stringify(body)));
      if(!r.ok)throw Error('Worker request failed');
      return r.json();
     }
    });
   }
   if(isOauth){
    if(req.method==='GET'){
     const response=asset(path);if(response)return response;
     if(path==='/oauth/config'&&!url.search)return json({url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY});
    }
    if(path==='/oauth/review'||path==='/oauth/decision'){
     if(env.MCP_ENABLED!=='true')return json({error:'Connection setup is not enabled'},503);
     return consentApi(req,{read:async r=>parse(await readBounded(r)),directOwner:direct,
      review:(p,id)=>rpcCall(env,'worker_mcp_review',{p_owner:p.owner,p_session:p.session,p_authorization:id}),
      decision:(auth,id,d,review,principal)=>decision(auth,env.SUPABASE_PUBLISHABLE_KEY,id,d,review,principal),
      record:(p,id)=>rpcCall(env,'worker_mcp_grant',{p_owner:p.owner,p_session:p.session,p_authorization:id})});
    }
    return json({error:'Not found'},404);
   }
   // External owner API is direct-owner-only; OAuth cannot access approval/revocation.
   if(url.search)return json({error:'Query unsupported'},400);
   let p;try{p=await direct(req.headers.get('Authorization'));}catch(e){return json({error:'Session verification failed',code:e.code||'AUTH_UNAVAILABLE'},[401,403,503].includes(e.status)?e.status:503);}
   return await dispatch(env,p.owner,req.method,path,await readBounded(req));
  }catch(e){return json({error:'Gateway request unavailable'},Number.isInteger(e?.status)&&e.status>=400&&e.status<600?e.status:503);}
 }};
}
export default buildGateway();
