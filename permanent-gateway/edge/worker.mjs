// Protocol 3 adapter. No credentials in source. All privileged RPCs server-side only.
const enc = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const MAX_BODY = 400000;
class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
function need(ok,status,msg){if(!ok)throw new Problem(status,msg);}
function response(status,body,plain=false){
  return new Response(plain?body:JSON.stringify(body),{status,headers:{"Content-Type":plain?"text/plain; charset=utf-8":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function b64(s,max){
  need(typeof s==="string"&&s.length<=Math.ceil(max/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s),400,"invalid base64");
  const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  need(bytes.length<=max,413,"payload too large"); return bytes;
}
function hex(b){return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");}
async function digest(bytes){return hex(await crypto.subtle.digest("SHA-256",bytes));}
function pgbytes(b){return "\\x"+hex(b);}
function requireId(s){need(typeof s==="string"&&UUID.test(s),400,"invalid id");return s;}
function parse(raw){
  try{const o=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));need(o&&typeof o==="object"&&!Array.isArray(o),400,"object required");return o;}
  catch(e){if(e instanceof Problem)throw e;throw new Problem(400,"invalid JSON");}
}
async function readBounded(req){
  const size=req.headers.get("Content-Length");
  if(size!==null)need(/^\d+$/.test(size)&&Number(size)<=MAX_BODY,413,"body too large");
  if(!req.body)return new Uint8Array();
  const reader=req.body.getReader(), parts=[];let len=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;len+=value.byteLength;if(len>MAX_BODY){await reader.cancel();throw new Problem(413,"body too large");}parts.push(value);}}
  finally{reader.releaseLock();}
  const raw=new Uint8Array(len);let off=0;for(const part of parts){raw.set(part,off);off+=part.length;}return raw;
}
// Android SHA256withECDSA returns ASN.1 DER; Web Crypto expects raw r||s.
export function derToRaw(der){
  if(der.length<8||der.length>72||der[0]!==0x30||der[1]!==der.length-2)throw new Error("invalid sequence");
  let pos=2;const raw=new Uint8Array(64);
  for(let i=0;i<2;i++){
    if(der[pos++]!==2)throw new Error("invalid integer");const n=der[pos++];
    if(!n||n>33||pos+n>der.length)throw new Error("invalid length");
    let v=der.subarray(pos,pos+n);pos+=n;
    if(v[0]&128)throw new Error("negative integer");
    if(v.length>1&&v[0]===0){if(!(v[1]&128))throw new Error("noncanonical integer");v=v.subarray(1);}
    if(v.length>32||v.every(x=>x===0))throw new Error("invalid scalar");
    raw.set(v,i*32+32-v.length);
  }
  if(pos!==der.length)throw new Error("trailing bytes");return raw;
}
async function verify(key,proof,message){
  try{const k=await crypto.subtle.importKey("spki",key,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);return await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},k,derToRaw(proof),enc.encode(message));}catch{return false;}
}
async function limit(env,key){
  need(env.REQUEST_LIMIT&&typeof env.REQUEST_LIMIT.limit==="function",503,"request limiter unavailable");
  const r=await env.REQUEST_LIMIT.limit({key});
  need(r?.success===true,429,"request limit exceeded");
}
function pageLimit(v,fallback,max){
  if(v==null)return fallback;
  need(Number.isInteger(v)&&v>=1&&v<=max,400,"invalid page limit");return v;
}
function validConfig(env){
  need(typeof env.SUPABASE_URL==="string"&&/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL)&&typeof env.SUPABASE_SERVER_KEY==="string"&&env.SUPABASE_SERVER_KEY.length>30&&typeof env.SUPABASE_PUBLISHABLE_KEY==="string"&&env.SUPABASE_PUBLISHABLE_KEY.length>20,503,"gateway not configured");
}
async function rpc(env,name,args){
  const headers={"Content-Type":"application/json",apikey:env.SUPABASE_SERVER_KEY};
  // Legacy service_role keys are JWTs; modern secret keys use apikey only.
  if(env.SUPABASE_SERVER_KEY.split(".").length===3)headers.Authorization="Bearer "+env.SUPABASE_SERVER_KEY;
  const r=await fetch(env.SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers,body:JSON.stringify(args),redirect:"manual",signal:AbortSignal.timeout(8000)});
  need(r.ok,503,"database unavailable");return await r.json();
}
async function owner(req,env){
  const auth=req.headers.get("Authorization")||"";
  need(/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth),401,"unauthorized");
  // Auth server verifies the actual session. No owner identifier supplied by the caller is trusted.
  const r=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:auth},redirect:"manual",signal:AbortSignal.timeout(8000)});
  need(r.ok,r.status===401||r.status===403?401:503,"owner authentication unavailable");
  const user=await r.json();need(UUID.test(user.id||""),401,"unauthorized");
  // Explicit provisioned single owner for this first vertical slice. No user-editable metadata.
  need(typeof env.OWNER_ID==="string"&&UUID.test(env.OWNER_ID)&&user.id===env.OWNER_ID,403,"owner not authorized");
  return user.id;
}
function enrollmentReply(r){
  need(r&&Number.isInteger(r.status)&&r.status>=200&&r.status<=499,503,"database response unavailable");
  const {status,...fields}=r;
  return status>=400?response(status,{error:"request rejected"}):response(status,fields);
}
function rpcReply(r){
  need(r&&Number.isInteger(r.status)&&r.status>=200&&r.status<=499,503,"database response unavailable");
  const {status,state,...fields}=r;
  if(status>=400)return response(status,{error:"request rejected"});
  return response(status,state?{...fields,status:state}:fields);
}
async function device(req,env,path,raw){
  const id=req.headers.get("X-Device")||"",nonce=req.headers.get("X-Nonce")||"",stamp=req.headers.get("X-Timestamp")||"";
  need(UUID.test(id)&&UUID.test(nonce)&&/^\d{1,12}$/.test(stamp)&&Math.abs(Date.now()/1000-Number(stamp))<=120,401,"invalid device proof");
  let signature;try{signature=b64(req.headers.get("X-Signature"),72);}catch{throw new Problem(401,"invalid device proof");}
  const row=await rpc(env,"worker_key",{p_device:id});need(row?.public_key,401,"unknown device");
  const msg=[id,req.method,path,stamp,nonce,await digest(raw)].join("\n");
  need(await verify(b64(row.public_key,256),signature,msg),401,"invalid device proof");
  return {p_device:id,p_nonce:nonce,p_stamp:Number(stamp)};
}
// Internal entry point; the public fetch path authenticates before dispatch.
export async function dispatchOwner(env,id,method,path,raw){
  need(UUID.test(id),403,"user not authorized");
  await limit(env,"owner:"+id);
      if(path==="/owner/readiness"&&method==="GET"){
        const r=await rpc(env,"worker_result",{p_owner:id,p_job:"00000000-0000-0000-0000-000000000000"});
        need(r===null,503,"unexpected readiness response");
        return response(200,{status:"ready",protocol:3});
      }
      if((path==="/owner/enrollments/lookup"||path==="/owner/enrollments/approve")&&method==="POST"){
        const b=parse(raw),code=typeof b.code==="string"?b.code.toUpperCase().replace(/-/g,""):"";
        need(CODE.test(code),400,"invalid request code");
        const hash="\\x"+await digest(enc.encode(code));
        if(path.endsWith("/lookup")){
          const r=await rpc(env,"worker_enrollment_lookup",{p_owner:id,p_hash:hash});
          need(r,404,"request not found or expired");return response(200,r);
        }
        need(b.confirmed===true,400,"owner confirmation required");
        return enrollmentReply(await rpc(env,"worker_enrollment_approve",{p_owner:id,p_id:requireId(b.request_id),p_hash:hash}));
      }
      if(path==="/owner/knowledge/profiles"&&method==="POST"){
        const b=parse(raw);
        if(b.action==="create"){
          need(typeof b.scope==="string"&&["owner","project","domain","skill","quality","worker"].includes(b.scope)&&typeof b.label==="string"&&b.label.length>=1&&b.label.length<=160,400,"invalid profile");
          return rpcReply(await rpc(env,"worker_profile_create",{p_owner:id,p_scope:b.scope,p_label:b.label}));
        }
        need(b.action==="list",400,"invalid action");
        const rows=await rpc(env,"worker_profiles",{p_owner:id,p_after:b.after==null?null:requireId(b.after),p_limit:pageLimit(b.limit,30,50)});
        need(Array.isArray(rows),503,"invalid profile response");
        return response(200,{profiles:rows});
      }
      if(path==="/owner/knowledge/context"&&method==="POST"){
        const b=parse(raw);
        need(Array.isArray(b.profile_ids)&&b.profile_ids.length>=1&&b.profile_ids.length<=12&&new Set(b.profile_ids).size===b.profile_ids.length,400,"invalid profiles");
        const profiles=b.profile_ids.map(requireId);
        need(b.query==null||typeof b.query==="string"&&b.query.length<=240,400,"invalid query");
        need(b.after==null||typeof b.after==="string"&&/^[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(b.after),400,"invalid cursor");
        const rows=await rpc(env,"worker_search_context",{p_owner:id,p_profiles:profiles,p_query:b.query??"",p_limit:pageLimit(b.limit,10,20),p_after:b.after??null});
        need(rows!==null,404,"profile unavailable");need(Array.isArray(rows),503,"invalid context response");
        return response(200,{entries:rows,content_is_evidence:true});
      }
      if(path==="/owner/knowledge/history"&&method==="POST"){
        const b=parse(raw);need(b.before==null||Number.isInteger(b.before)&&b.before>0,400,"invalid revision cursor");
        const rows=await rpc(env,"worker_revision_history",{p_owner:id,p_entry:requireId(b.entry_id),p_before:b.before??null,p_limit:pageLimit(b.limit,10,20)});
        need(rows!==null,404,"entry unavailable");need(Array.isArray(rows),503,"invalid history response");
        return response(200,{revisions:rows,content_is_evidence:true});
      }
      if(path==="/owner/knowledge/observations"&&method==="POST"){
        const b=parse(raw);
        need(typeof b.idempotency_key==="string"&&b.idempotency_key.length>=1&&b.idempotency_key.length<=128&&!b.idempotency_key.startsWith("verified-job:"),400,"invalid idempotency key");
        need(typeof b.source_kind==="string"&&["owner_statement","execution","review","experiment","external_reference"].includes(b.source_kind),400,"invalid source");
        need(typeof b.source_ref==="string"&&b.source_ref.length>=1&&b.source_ref.length<=512&&typeof b.body==="string"&&b.body.length>=1&&b.body.length<=12000,400,"invalid evidence");
        return rpcReply(await rpc(env,"worker_observe",{p_owner:id,p_profile:requireId(b.profile_id),p_idem:b.idempotency_key,p_kind:b.source_kind,p_ref:b.source_ref,p_body:b.body}));
      }
      if(path==="/owner/knowledge/job-evidence"&&method==="POST"){
        const b=parse(raw);
        return rpcReply(await rpc(env,"worker_observe_job",{p_owner:id,p_profile:requireId(b.profile_id),p_job:requireId(b.job_id)}));
      }
      if(path==="/owner/knowledge/proposals"&&method==="POST"){
        const b=parse(raw);
        need(Number.isInteger(b.expected_revision)&&b.expected_revision>=0&&b.expected_revision<=2147483646,400,"invalid revision");
        need(typeof b.key==="string"&&b.key.length>=1&&b.key.length<=160&&typeof b.kind==="string"&&["fact","preference","decision","rule","experience","hypothesis","validated_learning","unresolved"].includes(b.kind),400,"invalid proposal");
        need(typeof b.body==="string"&&b.body.length>=1&&b.body.length<=12000&&typeof b.rationale==="string"&&b.rationale.length>=1&&b.rationale.length<=4000&&typeof b.idempotency_key==="string"&&b.idempotency_key.length>=1&&b.idempotency_key.length<=128,400,"invalid proposal content");
        return enrollmentReply(await rpc(env,"worker_propose_retry",{p_owner:id,p_profile:requireId(b.profile_id),p_key:b.key,p_expected:b.expected_revision,p_evidence:requireId(b.evidence_id),p_kind:b.kind,p_body:b.body,p_rationale:b.rationale,p_idem:b.idempotency_key}));
      }
      if(path==="/owner/devices"&&method==="GET"){
        const devices=await rpc(env,"worker_list_devices",{p_owner:id});
        need(Array.isArray(devices),503,"invalid device response");
        return response(200,{devices});
      }
      if(path==="/owner/pairings"&&method==="GET"){
        const state=await rpc(env,"worker_pairing_status",{p_owner:id});
        need(state&&Number.isInteger(state.pending)&&Number.isInteger(state.enrolled),503,"invalid pairing status");
        return response(200,state);
      }
      if(path==="/owner/pairings"&&method==="POST"){
        const code=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g,"-").replace(/\//g,"_");
        const r=await rpc(env,"worker_issue_pairing",{p_owner:id,p_hash:"\\x"+await digest(enc.encode(code))});
        if(r?.status!==201)return rpcReply(r);
        return response(201,{code,expires_at:Math.floor(Date.now()/1000)+300});
      }
      if(path==="/owner/projects"&&method==="POST"){
        const b=parse(raw);need(typeof b.idempotency_key==="string"&&b.idempotency_key.length>=1&&b.idempotency_key.length<=128&&Number.isInteger(b.expected_revision)&&b.expected_revision>=0&&b.expected_revision<=15,400,"invalid project operation");
        need(b.expected_revision===0?(typeof b.timing==="string"&&b.notice==null):(b.timing==null&&typeof b.notice==="boolean"),400,"invalid project edit");
        return rpcReply(await rpc(env,"worker_project_submit",{p_owner:id,p_device:requireId(b.device_id),p_idem:b.idempotency_key,p_project:requireId(b.project_id),p_expected:b.expected_revision,p_timing:b.timing??null,p_notice:b.notice??null}));
      }
      const projectMatch=path.match(/^\/owner\/projects\/([^/]+)$/);
      if(projectMatch&&method==="GET"){
        const r=await rpc(env,"worker_project_read",{p_owner:id,p_project:requireId(projectMatch[1])});need(r,404,"project unavailable");return response(200,r);
      }
      if(path==="/owner/jobs"&&method==="POST"){
        const b=parse(raw);need(typeof b.idempotency_key==="string"&&b.idempotency_key.length>=1&&b.idempotency_key.length<=128,400,"invalid idempotency key");
        const args={p_owner:id,p_device:requireId(b.device_id),p_idem:b.idempotency_key};
        if(b.capability==="media.animatic.render"){
          need(typeof b.spec==="string"&&/^v1:(?:[1-9]|10):(?:[1-9]|10):(?:[1-9]|10):(?:[1-9]|10)$/.test(b.spec)&&b.spec.split(":").slice(1).reduce((a,v)=>a+Number(v),0)<=30,400,"invalid animatic spec");
          return rpcReply(await rpc(env,"worker_media_submit",{...args,p_spec:b.spec}));
        }
        need(b.capability==="file.sha256",400,"invalid capability");
        return rpcReply(await rpc(env,"worker_submit",{...args,p_payload:pgbytes(b64(b.input_b64,262144))}));
      }
      let m=path.match(/^\/owner\/jobs\/([^/]+)$/);
      if(m&&method==="GET"){const r=await rpc(env,"worker_result",{p_owner:id,p_job:requireId(m[1])});need(r,404,"job not found");return response(200,r);}
      m=path.match(/^\/owner\/jobs\/([^/]+)\/artifact$/);
      if(m&&method==="GET"){const job=requireId(m[1]);const r=await rpc(env,"worker_media_manifest",{p_owner:id,p_job:job});need(r,404,"artifact unavailable");return response(200,{...r,download_page:"https://gateway.example.invalid/workers?artifact="+job});}
      m=path.match(/^\/owner\/devices\/([^/]+)\/media-permission$/);
      if(m&&method==="POST"){const b=parse(raw);need(typeof b.enabled==="boolean",400,"invalid permission");return rpcReply(await rpc(env,"worker_media_permission",{p_owner:id,p_device:requireId(m[1]),p_enabled:b.enabled}));}
      m=path.match(/^\/owner\/jobs\/([^/]+)\/artifact\/(0|[1-9][0-9]?)$/);
      if(m&&method==="GET"){need(Number(m[2])<32,400,"invalid chunk");const r=await rpc(env,"worker_media_artifact",{p_owner:id,p_job:requireId(m[1]),p_seq:Number(m[2])});need(r,404,"artifact unavailable");return response(200,r);}
      m=path.match(/^\/owner\/devices\/([^/]+)\/revoke$/);
      if(m&&method==="POST")return rpcReply(await rpc(env,"worker_revoke",{p_owner:id,p_device:requireId(m[1])}));
      throw new Problem(404,"not found");
}

export {rpc,limit,validConfig,readBounded,parse,owner};
export default {async fetch(req,env){
  try{
    const url=new URL(req.url),path=url.pathname,method=req.method;
    need(!url.search,400,"query unsupported");
    if(path==="/health"&&method==="GET")return response(200,{status:"gateway",protocol:3});
    need(path==="/enrollment/start"||path==="/enrollment/status"||path==="/pair"||path.startsWith("/owner/")||path.startsWith("/worker/"),404,"not found");
    validConfig(env);
    // A shared limit protects the upstream per edge location. A second key limits an individual client.
    // No attacker-controlled X-Forwarded-For header is used.
    await limit(env,"gateway-total");
    const ip=req.headers.get("CF-Connecting-IP")||"unknown";
    await limit(env,"client:"+ip);
    const raw=await readBounded(req);
    if(path.startsWith("/owner/")){
      const id=await owner(req,env);
      return await dispatchOwner(env,id,method,path,raw);
    }
    if(path==="/enrollment/start"&&method==="POST"){
      const b=parse(raw),id=requireId(b.request_id);
      need(typeof b.code==="string"&&CODE.test(b.code),400,"invalid request code");
      need(typeof b.timestamp==="string"&&/^\d{1,12}$/.test(b.timestamp)&&Math.abs(Date.now()/1000-Number(b.timestamp))<=120,401,"expired proof");
      const key=b64(b.public_key,256),proof=b64(b.proof,72);
      const msg=["worker-enroll-v1:start",id,b.code,b.public_key,b.timestamp].join("\n");
      need(await verify(key,proof,msg),401,"invalid key proof");
      return enrollmentReply(await rpc(env,"worker_enrollment_start",{p_id:id,p_hash:"\\x"+await digest(enc.encode(b.code)),p_key:pgbytes(key)}));
    }
    if(path==="/enrollment/status"&&method==="POST"){
      const b=parse(raw),id=requireId(b.request_id);
      need(typeof b.timestamp==="string"&&/^\d{1,12}$/.test(b.timestamp)&&Math.abs(Date.now()/1000-Number(b.timestamp))<=120,401,"expired proof");
      const row=await rpc(env,"worker_enrollment_key",{p_id:id});need(row?.public_key,404,"request unavailable");
      const msg=["worker-enroll-v1:status",id,b.timestamp].join("\n");
      need(await verify(b64(row.public_key,256),b64(b.proof,72),msg),401,"invalid key proof");
      const r=await rpc(env,"worker_enrollment_status",{p_id:id});need(r,404,"request unavailable");return enrollmentReply(r);
    }
    if(path==="/pair"&&method==="POST"){
      const b=parse(raw);need(typeof b.code==="string"&&/^[A-Za-z0-9_-]{32}$/.test(b.code),401,"invalid pairing");
      const key=b64(b.public_key,256),proof=b64(b.proof,72);
      need(await verify(key,proof,"worker-pair-v1:"+b.code),401,"invalid key proof");
      return rpcReply(await rpc(env,"worker_enroll",{p_hash:"\\x"+await digest(enc.encode(b.code)),p_key:pgbytes(key)}));
    }
    if(path.startsWith("/worker/")&&method==="POST"){
      const m=path.match(/^\/worker\/jobs\/([^/]+)\/(recover|complete|chunk|finish|reject_project)$/);
      need(path==="/worker/claim"||path==="/worker/claim-v2"||path==="/worker/claim-v3"||path==="/worker/verify-connection"||m,404,"not found");
      const auth=await device(req,env,path,raw);
      await limit(env,"device:"+auth.p_device);
      if(path==="/worker/verify-connection"){
        const b=parse(raw);
        need(b.origin===url.origin&&typeof b.challenge==="string"&&UUID.test(b.challenge),400,"invalid connection challenge");
        // Read-only proof: no claim, lease, identity or checkpoint mutation.
        return response(200,{status:"verified",device_id:auth.p_device,origin:url.origin,challenge:b.challenge});
      }
      if(path==="/worker/claim"||path==="/worker/claim-v2"||path==="/worker/claim-v3"){
        const r=await rpc(env,"worker_operation",{...auth,p_op:path.endsWith("-v3")?"claim_v3":path.endsWith("-v2")?"claim_v2":"claim"});
        if(r?.status===200){need(typeof r.claim==="string",503,"invalid claim response");return response(200,r.claim,true);}return rpcReply(r);
      }
      const b=parse(raw),args={...auth,p_op:m[2],p_job:requireId(m[1]),p_lease:requireId(b.lease)};
      if(m[2]==="chunk"||m[2]==="finish"){
        const data={...auth,p_job:args.p_job,p_lease:args.p_lease,p_seq:null,p_bytes:null,p_count:null,p_digest:null};
        if(m[2]==="chunk"){need(Number.isInteger(b.seq)&&b.seq>=0&&b.seq<32,400,"invalid chunk");const bytes=b64(b.bytes_b64,65536);need(bytes.length>0,400,"empty chunk");data.p_seq=b.seq;data.p_bytes=pgbytes(bytes);}
        else{need(Number.isInteger(b.count)&&b.count>=1&&b.count<=32&&typeof b.sha256==="string"&&HEX.test(b.sha256),400,"invalid artifact manifest");data.p_count=b.count;data.p_digest="\\x"+b.sha256;}
        return rpcReply(await rpc(env,"worker_media_write",data));
      }
      if(m[2]==="complete"){need(typeof b.sha256==="string"&&HEX.test(b.sha256),400,"invalid digest");args.p_digest="\\x"+b.sha256;}
      return rpcReply(await rpc(env,"worker_operation",args));
    }
    throw new Problem(404,"not found");
  }catch(e){if(e instanceof Problem)return response(e.status,{error:e.message});return response(503,{error:"gateway unavailable"});}
}};
