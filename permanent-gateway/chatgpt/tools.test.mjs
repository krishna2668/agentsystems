import {test} from "node:test";
import assert from "node:assert/strict";
import {definitions,executeTool} from "./tools.mjs";
const request_id="12345678-1234-4234-8234-123456789abc",device_id="22345678-1234-4234-8234-123456789abc";
const code="ABCD-EFGH-2345";
function fixture(options={}){
 const calls=[];
 const host={ownerRequest:async(method,path,body)=>{
  calls.push({method,path,body});
  if(path.endsWith("/lookup"))return {request_id,state:"pending",fingerprint:"example"};
  if(path.endsWith("/approve"))return {state:"approved",device_id};
  if(path==="/owner/devices")return {devices:[{id:device_id,revoked:false,media_version:1,media_enabled:true}]};
  if(path==="/owner/jobs")return {job_id:request_id,status:"queued"};
  return {job_id:request_id,status:"completed"};
 },...options};
 return {host,calls};
}
test("tool registry contains no administrator or credential tools",()=>{
 assert.equal(definitions.length,10);
 assert.ok(definitions.every(t=>t.inputSchema.additionalProperties===false));
 assert.equal(definitions.find(t=>t.name==="approve_worker_request").annotations.readOnlyHint,false);
});
test("missing authenticated connection fails closed",async()=>{
 await assert.rejects(executeTool("list_workers",{},null),/Authenticated owner/);
});
test("inspect is read-only and normalizes code",async()=>{
 const {host,calls}=fixture();
 const r=await executeTool("inspect_worker_request",{code:code.toLowerCase()},host);
 assert.equal(r.request_id,request_id);assert.deepEqual(calls,[{method:"POST",path:"/owner/enrollments/lookup",body:{code:"ABCDEFGH2345"}}]);
});
test("approval cannot be inferred from the model or a missing consent adapter",async()=>{
 const {host,calls}=fixture();
 await assert.rejects(executeTool("approve_worker_request",{code,request_id,confirmed:true},host),/Invalid tool arguments/);
 assert.equal(calls.length,0);
 await assert.rejects(executeTool("approve_worker_request",{code,request_id},host),/Owner approval required/);
 assert.ok(calls.every(c=>!c.path.endsWith("/approve")));
});
test("explicit trusted consent is bound to reviewed request",async()=>{
 const {host,calls}=fixture({confirmOwnerAction:async a=>a.action==="approve_worker_request"&&a.request_id===request_id&&a.fingerprint==="example"});
 const r=await executeTool("approve_worker_request",{code,request_id},host);
 assert.equal(r.device_id,device_id);assert.equal(calls.at(-1).body.confirmed,true);
 await assert.rejects(executeTool("approve_worker_request",{code,request_id:device_id},host),/Request changed/);
});
test("connection test only targets an active worker and fixed payload",async()=>{
 const {host,calls}=fixture();
 await executeTool("submit_connection_test",{device_id,idempotency_key:"test-1"},host);
 assert.deepEqual(calls.at(-1).body,{capability:"file.sha256",device_id,idempotency_key:"test-1",input_b64:"aGVsbG8="});
 await assert.rejects(executeTool("submit_connection_test",{device_id:request_id,idempotency_key:"test-2"},host),/Active Worker required/);
});
test("result lookup is scoped and rejects path injection",async()=>{
 const {host,calls}=fixture();
 await assert.rejects(executeTool("get_worker_result",{job_id:"../../admin"},host),/Invalid identifier/);
 assert.equal(calls.length,0);
 await executeTool("get_worker_result",{job_id:request_id},host);
 assert.equal(calls[0].path,"/owner/jobs/"+request_id);
});

test("bounded animatic and manifest routes; no media permission delegation",async()=>{
 const {host,calls}=fixture();const args={device_id,idempotency_key:"pilot",establish:4,notice:4,approach:5,share:7};
 await executeTool("submit_animatic",args,host);
 assert.equal(calls.at(-1).body.spec,"v1:4:4:5:7");
 await assert.rejects(executeTool("submit_animatic",{...args,establish:10,notice:10,share:10},host),/Invalid animatic/);
 await executeTool("get_media_artifact",{job_id:request_id},host);
 assert.equal(calls.at(-1).path,"/owner/jobs/"+request_id+"/artifact");
 await assert.rejects(executeTool("worker_media_permission",{},host),/Unknown tool/);
});

test("project create, targeted edit and read use stable IDs and expected revision",async()=>{
 const {host,calls}=fixture(), common={device_id,project_id:request_id,idempotency_key:"project-1"};
 await executeTool("create_pilot_project",{...common,establish:2,notice:3,approach:4,share:5},host);
 assert.deepEqual(calls.at(-1).body,{...common,expected_revision:0,timing:"v1:2:3:4:5",notice:null});
 await executeTool("edit_pilot_notice",{...common,idempotency_key:"edit-1",expected_revision:1,enabled:true},host);
 assert.equal(calls.at(-1).body.notice,true);assert.equal(calls.at(-1).body.expected_revision,1);
 await assert.rejects(executeTool("edit_pilot_notice",{...common,expected_revision:0,enabled:true},host),/Invalid project/);
 await executeTool("read_pilot_project",{project_id:request_id},host);assert.equal(calls.at(-1).path,"/owner/projects/"+request_id);
});
