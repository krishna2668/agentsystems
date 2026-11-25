import {createClient} from '@supabase/supabase-js';
import {validAuthorizationId,validReview,validCallback,authProject,gatewayOrigin} from '../consent-policy.mjs';
const $=id=>document.getElementById(id);
const status=s=>{$('notice').textContent=s;};
const storageKey='agent-system:pending-oauth-request';
let auth,authorizationId,review,busy=false;
const workerMode=location.pathname==='/workers';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const artifactJob=workerMode?new URL(location.href).searchParams.get('artifact'):null;
let reviewedDevice=null;
function error(e){
 const messages={401:'Your session is not authorized. Sign out and sign in with an authorized account.',404:'This connection request has expired or is not allowed. Start a new connection from ChatGPT.',409:'Authorization could not be confirmed. Try again before starting another connection.',429:'Too many requests. Try again shortly.',503:'The service is temporarily unavailable. Try again.'};
 const specific={SESSION_INVALID:'Your sign-in session is invalid or expired. Sign out and sign in again.',ACCOUNT_NOT_ADMITTED:'This account does not have access to AgentSystems.',AUTH_UNAVAILABLE:'The authentication service could not be reached. Try again.',SESSION_CHECK_UNAVAILABLE:'Signed in, but the system could not check your session. Try again.',AUTH_CONFIGURATION:'The sign-in service is not configured correctly.',AUTHORIZATION_NOT_FOUND:'This connection request expired or no longer exists. Start a new connection in ChatGPT.',AUTHORIZATION_RESTART_REQUIRED:'This connection request cannot be resumed. Start a new connection in ChatGPT.',AUTHORIZATION_DETAILS_MISMATCH:'The connection details changed. Start a new connection in ChatGPT.',CONSENT_UNAVAILABLE:'The authorization service could not complete the request. Try again.',CONSENT_RATE_LIMITED:'Too many authorization attempts. Try again shortly.'};
 status(specific[e?.code]||messages[e?.status]||'Connection could not be confirmed. Try again.');
 $('retry').hidden=false;
 if(auth)$('logout').hidden=false;
}
function clearPending(){localStorage.removeItem(storageKey);}
async function call(path,body,method='POST'){
 const {data,error}=await auth.auth.getSession();
 if(error||!data.session)throw Error('Sign in required');
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},...(method==='GET'?{}:{body:JSON.stringify(body)}),cache:'no-store',redirect:'error'});
 if(!r.ok){const data=await r.json().catch(()=>({}));throw Object.assign(Error('Request rejected'),{status:r.status,code:data.code});}
 return r.json();
}
async function action(fn){
 if(busy)return;
 busy=true;const buttons=[...document.querySelectorAll('button')];
 for(const b of buttons)b.disabled=true;
 try{await fn();}catch(e){error(e);}finally{busy=false;for(const b of buttons)b.disabled=false;}
}
async function loadReview(){
 if(workerMode){await loadWorkers();return;}
 const r=await call('/oauth/review',{authorization_id:authorizationId});
 if(!validReview(r.request,authorizationId))throw Error('Invalid authorization');
 review=r.request;
 $('client').textContent=review.client_name;
 $('redirect').textContent=review.redirect_uri;
 $('scopes').textContent=review.scope||'No identity scopes requested';
 $('signin').hidden=true;$('review').hidden=false;$('logout').hidden=false;
 $('retry').hidden=true;status('Review the requested access before authorizing.');
}
async function initialize(){
 if(location.origin!==gatewayOrigin)throw Error('Invalid origin');
 const url=new URL(location.href);
 if(workerMode){document.title='AgentSystems — Workers';document.querySelector('h1').textContent='Workers';document.querySelector('header p').textContent='Connect and view your devices.';}
 const candidate=workerMode?null:url.searchParams.get('authorization_id');
 if(candidate){
   if(!validAuthorizationId(candidate))throw Error('Invalid request');
   localStorage.setItem(storageKey,candidate);
 }
 authorizationId=candidate||localStorage.getItem(storageKey);
 if(!workerMode&&!validAuthorizationId(authorizationId)){status('Start a new connection from ChatGPT.');return;}
 const config=await fetch('/oauth/config',{cache:'no-store'}).then(r=>r.json());
 if(config.url!==authProject||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key))throw Error('Invalid configuration');
 auth=createClient(config.url,config.key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'agent-system-user-auth'}});
 const {data}=await auth.auth.getUser();
 if(data.user){await loadReview();return;}
 $('signin').hidden=false;
 status('Sign in to your account.');
}
$('signin').addEventListener('submit',e=>{
 e.preventDefault();void action(async()=>{
  if(!auth||(!workerMode&&!authorizationId))throw Error('Request missing');
  // Official Supabase SDK sends credentials directly to the dedicated Auth project.
  // No gateway password endpoint, logging, storage, or forwarding to ChatGPT.
  const password=$('password').value;
  $('password').value='';
  const {error}=await auth.auth.signInWithPassword({email:$('email').value.trim(),password});
  if(error){
    status(error.status===429?'Too many sign-in attempts. Try again shortly.':'Could not sign in. Check your email and password.');
    return;
  }
  $('signin').hidden=true;$('logout').hidden=false;
  await loadReview();
 });
});
$('retry').addEventListener('click',()=>void action(async()=>{
 if(!auth){location.reload();return;}
 const {data}=await auth.auth.getUser();
 if(data.user){await loadReview();return;}
 $('signin').hidden=false;$('review').hidden=true;$('workers').hidden=true;clearDeviceReview();$('retry').hidden=true;status('Sign in to your account.');
}));
async function decide(decision){
 if(!review||!authorizationId)throw Error('Review required');
 const r=await call('/oauth/decision',{authorization_id:authorizationId,decision});
 if(r.denied===true&&decision==='deny'){clearPending();$('review').hidden=true;status('Connection denied. Return to ChatGPT.');return;}
 if(!validCallback(r.redirect_url,review.redirect_uri,decision))throw Error('Invalid redirect');
 clearPending();$('review').hidden=true;location.replace(r.redirect_url);
}
$('approve').addEventListener('click',()=>void action(()=>decide('approve')));
$('deny').addEventListener('click',()=>void action(()=>decide('deny')));
$('logout').addEventListener('click',()=>void action(async()=>{
 await auth.auth.signOut({scope:'local'});review=null;location.reload();
}));
function clearDeviceReview(){reviewedDevice=null;$('deviceReview').hidden=true;}
async function loadWorkers(){
 $('signin').hidden=true;$('review').hidden=true;$('workers').hidden=false;$('logout').hidden=false;
 const r=await call('/owner/devices',undefined,'GET');
 if(!Array.isArray(r.devices))throw Error('Invalid device list');
 $('workerList').replaceChildren();
 if(!r.devices.length)$('workerList').textContent='No registered Workers.';
 else for(const d of r.devices){
   const line=document.createElement('p');line.textContent='Worker '+String(d.id).slice(0,8)+' · '+(d.revoked?'Revoked':'Registered');
   $('workerList').append(line);
   if(!d.revoked&&uuid.test(d.id)&&(d.media_version===1||d.media_version===2||d.media_enabled)){
    const media=document.createElement('button');media.type='button';media.className='secondary';media.textContent=d.media_enabled?'Disable media jobs':'Allow media jobs';
    media.addEventListener('click',()=>void action(async()=>{
     const enabled=!d.media_enabled;
     const r=await call('/owner/devices/'+d.id+'/media-permission',{enabled});
     if(r.media_enabled!==enabled)throw Error('Media permission unconfirmed');
     await loadWorkers();
     status(enabled?'Media jobs allowed on this Worker.':'Media jobs disabled on this Worker.');
    }));$('workerList').append(media);
   }
 }
 $('retry').hidden=true;status('Signed in.');
 $('artifactPanel').hidden=!uuid.test(artifactJob||'');
 if(!$('artifactPanel').hidden)$('artifactInfo').textContent='Sign-in verified. Download checks the complete file against its recorded digest.';

}
$('deviceCode').addEventListener('input',clearDeviceReview);
$('cancelDevice').addEventListener('click',clearDeviceReview);
$('refreshWorkers').addEventListener('click',()=>void action(loadWorkers));
$('deviceForm').addEventListener('submit',e=>{
 e.preventDefault();void action(async()=>{
   clearDeviceReview();
   const code=$('deviceCode').value.trim().toUpperCase().replace(/-/g,'');
   if(!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(code)){status('Enter the 12-character code from your Worker app.');return;}
   const r=await call('/owner/enrollments/lookup',{code});
   if($('deviceCode').value.trim().toUpperCase().replace(/-/g,'')!==code){status('Request code changed. Review again.');return;}
   if(r.state==='approved'){status('This Worker is already connected.');await loadWorkers();return;}
   if(r.state!=='pending'||!r.request_id||!r.fingerprint||r.expires_at<=Date.now()/1000){status('Request unavailable or expired. Request a new code on the Worker.');return;}
   reviewedDevice={code,id:r.request_id,fingerprint:r.fingerprint,expires:r.expires_at};
   $('deviceFingerprint').textContent='Device key: '+r.fingerprint;
   $('deviceExpiry').textContent='Request expires '+new Date(r.expires_at*1000).toLocaleTimeString();
   $('deviceReview').hidden=false;status('Review the device before connecting.');
 });
});
$('approveDevice').addEventListener('click',()=>void action(async()=>{
 const d=reviewedDevice;
 if(!d||$('deviceCode').value.trim().toUpperCase().replace(/-/g,'')!==d.code||d.expires<=Date.now()/1000){clearDeviceReview();status('Request expired. Request a new code.');return;}
 const current=await call('/owner/enrollments/lookup',{code:d.code});
 if(current.request_id!==d.id||current.fingerprint!==d.fingerprint||!['pending','approved'].includes(current.state)){clearDeviceReview();status('Request changed. Review it again.');return;}
 const r=await call('/owner/enrollments/approve',{code:d.code,request_id:d.id,confirmed:true});
 if(r.state!=='approved'||!r.device_id)throw Error('Connection not confirmed');
 clearDeviceReview();$('deviceCode').value='';await loadWorkers();
 status('Device authorized. Open the Worker app to complete connection.');
}));
$('downloadArtifact').addEventListener('click',()=>void action(async()=>{
 if(!uuid.test(artifactJob||''))throw Error('Invalid artifact');
 const root='/owner/jobs/'+artifactJob+'/artifact';
 const m=await call(root,undefined,'GET');
 if(m.job_id!==artifactJob||m.capability!=='media.animatic.render'||m.integrity!=='verified'||!/^[0-9a-f]{64}$/.test(m.sha256||'')||!Number.isInteger(m.chunks)||m.chunks<1||m.chunks>32||!Number.isInteger(m.bytes)||m.bytes<1||m.bytes>2097152)throw Error('Invalid artifact manifest');
 const out=new Uint8Array(m.bytes);let off=0;
 for(let i=0;i<m.chunks;i++){
  $('artifactInfo').textContent='Receiving video '+(i+1)+' / '+m.chunks;
  const c=await call(root+'/'+i,undefined,'GET');
  if(c.seq!==i||c.chunks!==m.chunks||c.sha256!==m.sha256||typeof c.bytes_b64!=='string'||c.bytes_b64.length>87384)throw Error('Artifact chunk mismatch');
  const bytes=Uint8Array.from(atob(c.bytes_b64),v=>v.charCodeAt(0));
  if(!bytes.length||bytes.length>65536||off+bytes.length>out.length)throw Error('Invalid chunk size');
  out.set(bytes,off);off+=bytes.length;
 }
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out)),v=>v.toString(16).padStart(2,'0')).join('');
 if(off!==out.length||digest!==m.sha256)throw Error('Artifact integrity mismatch');
 const href=URL.createObjectURL(new Blob([out],{type:'video/mp4'}));const link=document.createElement('a');
 link.href=href;link.download='animatic-'+artifactJob+'.mp4';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
 $('artifactInfo').textContent='File integrity verified. Video quality has not yet been reviewed.';
}));
void initialize().catch(error);
