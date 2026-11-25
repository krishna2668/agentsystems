import {test} from "node:test";
import assert from "node:assert/strict";
import {knowledgeDefinitions,executeKnowledgeTool} from "./knowledge.mjs";
const p="12345678-1234-4234-8234-123456789abc";
const fixture=()=>{const calls=[];return {calls,host:{ownerRequest:async(method,path,body)=>{calls.push({method,path,body});return {ok:true};}}}};
test("knowledge tools cannot commit learning or grant authority",async()=>{
 const {host,calls}=fixture();
 assert.equal(knowledgeDefinitions.length,7);
 await assert.rejects(executeKnowledgeTool("commit_learning",{proposal_id:p},host),/Unknown/);
 await assert.rejects(executeKnowledgeTool("create_knowledge_profile",{scope:"authority",label:"bad"},host),/Invalid/);
 assert.equal(calls.length,0);
});
test("bounded retrieval explicitly selects owner scopes",async()=>{
 const {host,calls}=fixture();
 await assert.rejects(executeKnowledgeTool("get_context",{profile_ids:[p,p]},host),/Invalid/);
 await assert.rejects(executeKnowledgeTool("get_context",{profile_ids:[p],owner_id:p},host),/Invalid/);
 await assert.rejects(executeKnowledgeTool("get_context",{profile_ids:[p],limit:21},host),/Invalid/);
 await executeKnowledgeTool("get_context",{profile_ids:[p],query:"digest"},host);
 assert.deepEqual(calls,[{method:"POST",path:"/owner/knowledge/context",body:{profile_ids:[p],query:"digest"}}]);
});
test("distinct verified evidence route and reserved namespace",async()=>{
 const {host,calls}=fixture();
 await assert.rejects(executeKnowledgeTool("record_observation",{profile_id:p,idempotency_key:"verified-job:fake",source_kind:"execution",source_ref:"x",body:"claim"},host),/Reserved/);
 await executeKnowledgeTool("record_job_evidence",{profile_id:p,job_id:p},host);
 assert.equal(calls[0].path,"/owner/knowledge/job-evidence");
});
test("retry-safe proposal cannot set approval flag",async()=>{
 const {host,calls}=fixture();
 const a={profile_id:p,key:"lesson",expected_revision:0,evidence_id:p,kind:"hypothesis",body:"Claim",rationale:"Review required",idempotency_key:"learn-1"};
 await assert.rejects(executeKnowledgeTool("propose_learning",{...a,confirmed:true},host),/Invalid/);
 await executeKnowledgeTool("propose_learning",a,host);
 assert.deepEqual(calls[0].body,a);
});
test("profile discovery and history have fixed routes",async()=>{
 const {host,calls}=fixture();
 await executeKnowledgeTool("list_knowledge_profiles",{},host);
 await executeKnowledgeTool("get_knowledge_history",{entry_id:p},host);
 assert.deepEqual(calls.map(c=>c.path),["/owner/knowledge/profiles","/owner/knowledge/history"]);
});
test("missing owner connection fails closed",async()=>{
 await assert.rejects(executeKnowledgeTool("list_knowledge_profiles",{},null),/Authenticated owner/);
});
