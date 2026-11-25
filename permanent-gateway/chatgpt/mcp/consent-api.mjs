import {validAuthorizationId,validReview,validCallback,authProject,gatewayOrigin} from './consent-policy.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function consentApi(req,host){
 if(req.method!=='POST'||req.headers.get('Origin')!==gatewayOrigin||!req.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Request denied'},403);
 let b,principal;
 try{b=await host.read(req);}catch{return json({error:'Invalid request',code:'INVALID_REQUEST'},400);}
 try{principal=await host.directOwner(req.headers.get('Authorization'));}catch(e){
   const status=[401,403,503].includes(e.status)?e.status:503;
   return json({error:'Session verification failed',code:e.code||'AUTH_UNAVAILABLE'},status);
 }
 if(!validAuthorizationId(b?.authorization_id)||!principal)return json({error:'Invalid authorization request'},400);
 const id=b.authorization_id;
 let review;try{review=await host.review(principal,id);}catch{return json({error:'Authorization unavailable'},503);}
 if(!validReview(review,id))return json({error:'Request expired or not permitted'},404);
 if(new URL(req.url).pathname==='/oauth/review')return json({request:review});
 if(new URL(req.url).pathname!=='/oauth/decision'||!['approve','deny'].includes(b.decision))return json({error:'Invalid decision'},400);
 if(b.decision==='deny')return json({denied:true});
 try{
   const auth=await host.decision(req.headers.get('Authorization'),id,b.decision,review,principal);
   const redirect=auth?.redirect_url;
   if(!validCallback(redirect,review.redirect_uri,b.decision))return json({error:'Consent response could not be verified'},409);
   if(b.decision==='approve'&&await host.record(principal,id)!==true)return json({error:'Connection authorization not confirmed'},409);
   return json({redirect_url:redirect});
 }catch(e){
   const status=[401,403,404,409,429,503].includes(e.status)?e.status:503;
   return json({error:'Consent could not be confirmed',code:e.code||'CONSENT_UNAVAILABLE'},status);
 }
}
function problem(status,code){return Object.assign(new Error(code),{status,code});}
export async function supabaseDecision(auth,publicKey,id,decision,review,principal,fetcher=fetch){
 const url=authProject+'/auth/v1/oauth/authorizations/'+encodeURIComponent(id);
 const headers={apikey:publicKey,Authorization:auth,'Content-Type':'application/json'};
 async function request(path,method,body){
   let r;
   try{r=await fetcher(url+path,{method,headers,...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(8000)});}
   catch{throw problem(503,'CONSENT_UNAVAILABLE');}
   if(!r.ok){
     if(r.status===404)throw problem(404,'AUTHORIZATION_NOT_FOUND');
     if(r.status===400||r.status===409)throw problem(409,'AUTHORIZATION_RESTART_REQUIRED');
     if(r.status===401||r.status===403)throw problem(401,'SESSION_INVALID');
     if(r.status===429)throw problem(429,'CONSENT_RATE_LIMITED');
     throw problem(503,'CONSENT_UNAVAILABLE');
   }
   try{return await r.json();}catch{throw problem(503,'CONSENT_UNAVAILABLE');}
 }
 // The official details endpoint binds the pending authorization to this user.
 // Database review is a policy check, not a substitute for that Auth operation.
 // Call it only on the user's explicit decision; an existing consent may auto-approve.
 if(review.state!=='pending')throw problem(409,'AUTHORIZATION_RESTART_REQUIRED');
 const details=await request('','GET');
 if(details?.redirect_url){
   if(decision!=='approve')throw problem(409,'AUTHORIZATION_RESTART_REQUIRED');
   // Auth may auto-approve a previously consented client. The caller validates
   // callback and independently records the grant before releasing the redirect.
   return details;
 }
 if(details?.authorization_id!==id||details.client?.id!==review.client_id||
    details.user?.id!==principal.owner||details.redirect_uri!==review.redirect_uri||
    details.scope!==review.scope)throw problem(409,'AUTHORIZATION_DETAILS_MISMATCH');
 return request('/consent','POST',{action:decision});
}
