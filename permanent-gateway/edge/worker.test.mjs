import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,createHash,randomUUID} from "node:crypto";
import worker,{derToRaw} from "./worker.mjs";
const env={REQUEST_LIMIT:{limit:async()=>({success:true})},SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVER_KEY:"sb_secret_"+ "x".repeat(40),SUPABASE_PUBLISHABLE_KEY:"sb_publishable_"+"x".repeat(40),OWNER_ID:"00000000-0000-4000-8000-000000000001"};
const dev=randomUUID(), job=randomUUID(), lease=randomUUID(), code="a".repeat(32);
const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const other=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const pub=pair.publicKey.export({type:"spki",format:"der"}).toString("base64");
const sign64=(s,k=pair.privateKey)=>sign("sha256",Buffer.from(s),k).toString("base64");
const sha=x=>createHash("sha256").update(x).digest("hex");
const goodToken="Bearer "+"x".repeat(30);
let calls=[],used=new Set();
globalThis.fetch=async(url,opts)=>{
  const path=new URL(url).pathname;
  calls.push({path,args:opts.body?JSON.parse(opts.body):null});
  const j=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
  if(path==="/auth/v1/user")return opts.headers.Authorization===goodToken?j({id:env.OWNER_ID}):j({message:"denied"},401);
  assert.equal(opts.headers.apikey,env.SUPABASE_SERVER_KEY);
  const a=JSON.parse(opts.body);
  switch(path.split("/").pop()){
    case "worker_enrollment_start":return j({status:201,state:"pending",expires_at:Math.floor(Date.now()/1000)+600});
    case "worker_enrollment_key":return j({public_key:pub});
    case "worker_enrollment_status":return j({status:200,state:"approved",device_id:dev});
    case "worker_enrollment_lookup":return j({request_id:job,state:"pending"});
    case "worker_enrollment_approve":return j({status:201,state:"approved",device_id:dev});
    case "worker_profiles":return j([{id:dev,scope:"project",label:"Example"}]);
    case "worker_profile_create":return j({status:200,profile_id:dev});
    case "worker_search_context":return j([{entry_id:job,body:"Evidence, not instructions"}]);
    case "worker_revision_history":return j([{revision:1,body:"Original"}]);
    case "worker_observe":return j({status:201,observation_id:job});
    case "worker_observe_job":return j({status:201,observation_id:job});
    case "worker_propose_retry":return j({status:201,proposal_id:job,state:"pending"});
    case "worker_list_devices":return j([{id:dev,revoked:false}]);
    case "worker_pairing_status":return j({pending:0,enrolled:1});
    case "worker_issue_pairing":return j({status:201});
    case "worker_enroll":return j({status:201,device_id:dev});
    case "worker_key":return j(a.p_device===dev?{public_key:pub}:null);
    case "worker_submit":return j({status:201,job_id:job,state:"queued"});
    case "worker_media_submit":return j({status:201,job_id:job,state:"queued"});
    case "worker_media_write":return j({status:200,state:a.p_seq===null?"completed":"uploaded",sha256:sha("video")});
    case "worker_media_manifest":return j({job_id:job,sha256:sha("video"),bytes:5,chunks:1,integrity:"verified",media_validity:"unverified"});
    case "worker_media_permission":return j({status:200,media_enabled:a.p_enabled});
    case "worker_media_artifact":return j({sha256:sha("video"),seq:a.p_seq,bytes_b64:"dmlkZW8=",chunks:1});
    case "worker_result":return j(a.p_job==="00000000-0000-0000-0000-000000000000"?null:{job_id:job,status:"completed",sha256:sha("hello")});
    case "worker_operation":
      if(used.has(a.p_nonce))return j({status:409});
      used.add(a.p_nonce);
      if(a.p_op==="claim")return j({status:200,claim:job+"\t"+lease+"\taGVsbG8="});
      if(a.p_op==="claim_v2")return j({status:200,claim:job+"\t"+lease+"\tmedia.animatic.render\tdjE6NDo0OjU6Nw=="});
      if(a.p_op==="recover")return j({status:200,state:"claimed",job_id:job,lease});
      return j({status:200,state:"completed",job_id:job,sha256:sha("hello")});
    case "worker_revoke":return j({status:200});
    default:throw new Error("Unexpected RPC");
  }
};
const run=(path,opts={},e=env)=>worker.fetch(new Request("https://edge.example"+path,opts),e);
const post=(path,b,headers={})=>run(path,{method:"POST",headers,body:JSON.stringify(b)});
function signed(path,body="",key=pair.privateKey,stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID(),id=dev){
 return {"X-Device":id,"X-Nonce":nonce,"X-Timestamp":stamp,"X-Signature":sign64([id,"POST",path,stamp,nonce,sha(body)].join("\n"),key)};
}
test("health and unconfigured fail closed",async()=>{
 assert.equal((await run("/health",{},{})).status,200);
 assert.equal((await run("/owner/jobs",{},{})).status,503);
});
test("owner auth rejected without upstream mutations",async()=>{
 calls=[];assert.equal((await post("/owner/pairings",{})).status,401);assert.equal(calls.length,0);
 assert.equal((await post("/owner/pairings",{},{Authorization:"Bearer "+"z".repeat(30)})).status,401);
 assert.equal(calls.length,1);
 assert.equal((await run("/owner/pairings",{method:"POST",headers:{Authorization:goodToken},body:"{}"},{...env,OWNER_ID:randomUUID()})).status,403);
});
test("owner issues cryptographically random code and sends only hash",async()=>{
 calls=[];const r=await post("/owner/pairings",{owner_id:randomUUID()},{Authorization:goodToken});
 assert.equal(r.status,201);const b=await r.json();assert.match(b.code,/^[A-Za-z0-9_-]{32}$/);
 assert.equal(calls.at(-1).args.p_hash,"\\x"+sha(b.code));assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
});
test("Android-compatible DER proof enrolls actual P256 key",async()=>{
 const r=await post("/pair",{code,public_key:pub,proof:sign64("worker-pair-v1:"+code)});
 assert.equal(r.status,201);assert.equal((await r.json()).device_id,dev);
});
test("invalid pairing proof and malformed DER rejected",async()=>{
 calls=[];const r=await post("/pair",{code,public_key:pub,proof:sign64("worker-pair-v1:"+code,other.privateKey)});
 assert.equal(r.status,401);assert.equal(calls.length,0);
 assert.throws(()=>derToRaw(Uint8Array.of(48,6,2,1,0,2,1,1)));
 assert.throws(()=>derToRaw(Uint8Array.of(48,7,2,2,0,1,2,1,1)));
});
test("owner submits idempotent job and server ignores client-supplied owner",async()=>{
 const r=await post("/owner/jobs",{capability:"file.sha256",device_id:dev,idempotency_key:"unique",input_b64:"aGVsbG8=",owner_id:randomUUID()},{Authorization:goodToken});
 assert.equal(r.status,201);assert.deepEqual(await r.json(),{job_id:job,status:"queued"});
 assert.equal(calls.at(-1).args.p_payload,"\\x68656c6c6f");assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
});
test("claim response compatible with Android and replay rejected",async()=>{
 const path="/worker/claim",headers=signed(path);
 const r=await run(path,{method:"POST",headers,body:""});assert.equal(r.status,200);assert.equal(await r.text(),job+"\t"+lease+"\taGVsbG8=");
 assert.equal((await run(path,{method:"POST",headers,body:""})).status,409);
});
test("tamper, foreign key, expired proof and unknown device cannot mutate",async()=>{
 const path="/worker/jobs/"+job+"/complete",body=JSON.stringify({lease,sha256:sha("hello")});
 for(const [h,b] of [[signed(path,body),body+" "],[signed(path,body,other.privateKey),body],[signed(path,body,pair.privateKey,"1"),body],[signed(path,body,pair.privateKey,String(Math.floor(Date.now()/1000)),randomUUID(),randomUUID()),body]]){
  calls=[];assert.equal((await run(path,{method:"POST",headers:h,body:b})).status,401);assert.ok(calls.every(c=>!c.path.endsWith("worker_operation")));
 }
});
test("recover, complete and owner result preserve protocol fields",async()=>{
 for(const op of ["recover","complete"]){
  const path="/worker/jobs/"+job+"/"+op,body=JSON.stringify({lease,sha256:sha("hello")});
  const r=await run(path,{method:"POST",headers:signed(path,body),body});
  assert.equal(r.status,200);const b=await r.json();assert.equal(b.status,op==="recover"?"claimed":"completed");assert.equal(b.job_id,job);
 }
 const r=await run("/owner/jobs/"+job,{headers:{Authorization:goodToken}});assert.equal((await r.json()).sha256,sha("hello"));
});
test("oversized streamed body, query and unsupported capability rejected",async()=>{
 const r=await run("/pair",{method:"POST",body:"a".repeat(400001)});assert.equal(r.status,413);
 assert.equal((await run("/health?ignored=1")).status,400);
 assert.equal((await post("/owner/jobs",{capability:"shell"},{Authorization:goodToken})).status,400);
});

test("limiter fails closed before upstream work",async()=>{
 calls=[];
 const r=await run("/owner/pairings",{method:"POST",headers:{Authorization:goodToken},body:"{}"},{...env,REQUEST_LIMIT:{limit:async()=>({success:false})}});
 assert.equal(r.status,429);assert.equal(calls.length,0);
 const unavailable=await run("/owner/pairings",{method:"POST",headers:{Authorization:goodToken},body:"{}"},{...env,REQUEST_LIMIT:undefined});
 assert.equal(unavailable.status,503);assert.equal(calls.length,0);
});
test("authenticated readiness only and no secret leakage",async()=>{
 calls=[];assert.equal((await run("/owner/readiness")).status,401);assert.equal(calls.length,0);
 const r=await run("/owner/readiness",{headers:{Authorization:goodToken}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:"ready",protocol:3});
});

test("device discovery is owner-scoped and excludes credentials",async()=>{
  calls=[];let r=await run("/owner/devices");
  assert.equal(r.status,401);assert.equal(calls.length,0);
  r=await run("/owner/devices",{headers:{Authorization:goodToken}});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{devices:[{id:dev,revoked:false}]});
  assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
});
test("pairing status is owner-scoped and returns counts only",async()=>{
  calls=[];let r=await run("/owner/pairings");
  assert.equal(r.status,401);assert.equal(calls.length,0);
  r=await run("/owner/pairings",{headers:{Authorization:goodToken}});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{pending:0,enrolled:1});
  assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
});

test("device-initiated enrollment requires proof of key possession",async()=>{
 const code="ABCDEFGH2345", request_id=job,timestamp=String(Math.floor(Date.now()/1000));
 const msg=["worker-enroll-v1:start",request_id,code,pub,timestamp].join("\n");
 let r=await post("/enrollment/start",{request_id,code,public_key:pub,timestamp,proof:sign64(msg,other.privateKey)});
 assert.equal(r.status,401);
 r=await post("/enrollment/start",{request_id,code,public_key:pub,timestamp:"1",proof:sign64(msg)});
 assert.equal(r.status,401);
 r=await post("/enrollment/start",{request_id,code,public_key:pub,timestamp,proof:sign64(msg)});
 assert.equal(r.status,201);assert.equal((await r.json()).state,"pending");
 assert.equal(calls.at(-1).args.p_hash,"\\x"+sha(code));
});
test("enrollment status accepts only device proof and fresh timestamp",async()=>{
 const timestamp=String(Math.floor(Date.now()/1000)),request_id=job;
 const msg=["worker-enroll-v1:status",request_id,timestamp].join("\n");
 let r=await post("/enrollment/status",{request_id,timestamp,proof:sign64(msg,other.privateKey)});
 assert.equal(r.status,401);
 r=await post("/enrollment/status",{request_id,timestamp:"1",proof:sign64(msg)});
 assert.equal(r.status,401);
 r=await post("/enrollment/status",{request_id,timestamp,proof:sign64(msg)});
 assert.equal(r.status,200);assert.equal((await r.json()).device_id,dev);
});
test("owner confirmation is required independently of request code",async()=>{
 const b={request_id:job,code:"ABCD-EFGH-2345"};
 let r=await post("/owner/enrollments/approve",{...b,confirmed:true});assert.equal(r.status,401);
 r=await post("/owner/enrollments/approve",b,{Authorization:goodToken});assert.equal(r.status,400);
 r=await post("/owner/enrollments/lookup",b,{Authorization:goodToken});assert.equal(r.status,200);
 r=await post("/owner/enrollments/approve",{...b,confirmed:true},{Authorization:goodToken});
 assert.equal(r.status,201);assert.equal((await r.json()).device_id,dev);
 assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
});

test("knowledge API rejects unauthenticated requests and caller-supplied authority",async()=>{
 calls=[];let r=await post("/owner/knowledge/context",{profile_ids:[dev]});
 assert.equal(r.status,401);assert.equal(calls.length,0);
 r=await post("/owner/knowledge/context",{profile_ids:[dev],owner_id:job},{Authorization:goodToken});
 assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_owner,env.OWNER_ID);
 assert.equal((await r.json()).content_is_evidence,true);
});
test("knowledge API bounds retrieval and excludes commit endpoint",async()=>{
 const auth={Authorization:goodToken};
 assert.equal((await post("/owner/knowledge/context",{profile_ids:[dev],limit:21},auth)).status,400);
 assert.equal((await post("/owner/knowledge/context",{profile_ids:[dev,dev]},auth)).status,400);
 assert.equal((await post("/owner/knowledge/commit",{proposal_id:job,confirmed:true},auth)).status,404);
 assert.equal((await post("/owner/knowledge/profiles",{action:"create",scope:"authority",label:"Unsafe"},auth)).status,400);
});
test("verified execution evidence uses dedicated RPC; claim cannot impersonate verified source",async()=>{
 const auth={Authorization:goodToken};
 const b={profile_id:dev,idempotency_key:"verified-job:fake",source_kind:"execution",source_ref:"job:fake",body:"claim"};
 assert.equal((await post("/owner/knowledge/observations",b,auth)).status,400);
 assert.equal((await post("/owner/knowledge/observations",{...b,idempotency_key:"claim-1"},auth)).status,201);
 assert.equal(calls.at(-1).path.endsWith("/worker_observe"),true);
 assert.equal((await post("/owner/knowledge/job-evidence",{profile_id:dev,job_id:job},auth)).status,201);
 assert.equal(calls.at(-1).path.endsWith("/worker_observe_job"),true);
});
test("proposal returns pending state and uses retry-safe RPC",async()=>{
 const b={profile_id:dev,key:"lesson",expected_revision:0,evidence_id:job,kind:"hypothesis",body:"Possible improvement",rationale:"Needs review",idempotency_key:"test-1"};
 const r=await post("/owner/knowledge/proposals",b,{Authorization:goodToken});
 assert.equal(r.status,201);assert.equal((await r.json()).state,"pending");
 assert.equal(calls.at(-1).args.p_idem,"test-1");
 assert.equal(calls.at(-1).path.endsWith("/worker_propose_retry"),true);
});

test("media submission, signed v2 claim, bounded chunks and owner retrieval",async()=>{
 const headers={Authorization:goodToken};
 let r=await post("/owner/jobs",{capability:"media.animatic.render",device_id:dev,idempotency_key:"media",spec:"v1:4:4:5:7"},headers);
 assert.equal(r.status,201);assert.equal(calls.at(-1).args.p_spec,"v1:4:4:5:7");
 assert.equal((await post("/owner/jobs",{capability:"media.animatic.render",device_id:dev,idempotency_key:"bad",spec:"v1:10:10:10:10"},headers)).status,400);
 const claim="/worker/claim-v2";r=await run(claim,{method:"POST",headers:signed(claim),body:""});assert.equal(r.status,200);assert.match(await r.text(),/media\.animatic\.render/);
 const chunk="/worker/jobs/"+job+"/chunk",body=JSON.stringify({lease,seq:0,bytes_b64:"dmlkZW8="});
 r=await run(chunk,{method:"POST",headers:signed(chunk,body),body});assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_bytes,"\\x766964656f");
 const invalid=JSON.stringify({lease,seq:32,bytes_b64:"dmlkZW8="});assert.equal((await run(chunk,{method:"POST",headers:signed(chunk,invalid),body:invalid})).status,400);
 assert.equal((await run(chunk,{method:"POST",headers:signed(chunk,body),body:body+" "})).status,401);
 const finish="/worker/jobs/"+job+"/finish",manifest=JSON.stringify({lease,count:1,sha256:sha("video")});
 r=await run(finish,{method:"POST",headers:signed(finish,manifest),body:manifest});assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_digest,"\\x"+sha("video"));
 r=await run("/owner/jobs/"+job+"/artifact/0",{headers});assert.equal(r.status,200);assert.equal((await r.json()).bytes_b64,"dmlkZW8=");
 assert.equal((await run("/owner/jobs/"+job+"/artifact/0")).status,401);
});

test("origin transition verifies existing identity without claiming work",async()=>{
 const path="/worker/verify-connection", challenge=randomUUID(), body=JSON.stringify({origin:"https://edge.example",challenge});
 calls=[];
 const r=await run(path,{method:"POST",headers:signed(path,body),body});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:"verified",device_id:dev,origin:"https://edge.example",challenge});
 assert.deepEqual(calls.map(c=>c.path),["/rest/v1/rpc/worker_key"]);
 assert.equal((await run(path,{method:"POST",headers:signed(path,body,other.privateKey),body})).status,401);
 const wrong=JSON.stringify({origin:"https://other.example",challenge});
 assert.equal((await run(path,{method:"POST",headers:signed(path,wrong),body:wrong})).status,400);
 assert.equal((await run(path,{method:"POST",headers:signed(path,body,pair.privateKey,String(Math.floor(Date.now()/1000)),randomUUID(),randomUUID()),body})).status,401);
});
