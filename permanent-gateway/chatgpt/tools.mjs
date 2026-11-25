// Hosting-neutral tool definitions and owner API adapter. No database-admin path.
// The MCP host must authenticate the owner and provide an owner-scoped API client.
// A model-supplied boolean is never proof of human consent.
const CODE=/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const codeSchema={type:"string",description:"12-character request code displayed by Worker",minLength:12,maxLength:14};
const idSchema={type:"string",format:"uuid"};
const schema=(properties,required)=>({type:"object",properties,required,additionalProperties:false});
const duration={type:"integer",minimum:1,maximum:10};
const meta=(readOnlyHint,idempotentHint)=>({readOnlyHint,destructiveHint:false,idempotentHint,openWorldHint:false});
export const definitions=Object.freeze([
 {name:"inspect_worker_request",description:"Look up a device-initiated connection request. This does not authorize a device.",inputSchema:schema({code:codeSchema},["code"]),annotations:meta(true,true)},
 {name:"approve_worker_request",description:"Authorize the exact previously reviewed device request. Requires genuine owner confirmation through the connected host.",inputSchema:schema({code:codeSchema,request_id:idSchema},["code","request_id"]),annotations:meta(false,true)},
 {name:"list_workers",description:"List the authenticated owner's registered Workers, including revoked devices.",inputSchema:schema({},[]),annotations:meta(true,true)},
 {name:"submit_connection_test",description:"Submit a bounded harmless SHA-256 connection test to a selected active Worker. Reuse the same idempotency key on retries.",inputSchema:schema({device_id:idSchema,idempotency_key:{type:"string",minLength:1,maxLength:128}},["device_id","idempotency_key"]),annotations:meta(false,true)},
 {name:"submit_animatic",description:"Submit the bounded silent four-beat pilot renderer to a media-enabled Worker. Reuse the same idempotency key on retries.",inputSchema:schema({device_id:idSchema,idempotency_key:{type:"string",minLength:1,maxLength:128},establish:duration,notice:duration,approach:duration,share:duration},["device_id","idempotency_key","establish","notice","approach","share"]),annotations:meta(false,true)},
 {name:"create_pilot_project",description:"Create an editable umbrella pilot and render revision 1 on a project-capable Worker. Keep project ID and idempotency key stable on retry.",inputSchema:schema({device_id:idSchema,project_id:idSchema,idempotency_key:{type:"string",minLength:1,maxLength:128},establish:duration,notice:duration,approach:duration,share:duration},["device_id","project_id","idempotency_key","establish","notice","approach","share"]),annotations:meta(false,true)},
 {name:"edit_pilot_notice",description:"Set the notice reaction on an existing pilot project and render the next revision. Requires the current completed base revision. Reuse key on exact retry.",inputSchema:schema({device_id:idSchema,project_id:idSchema,idempotency_key:{type:"string",minLength:1,maxLength:128},expected_revision:{type:"integer",minimum:1,maximum:15},enabled:{type:"boolean"}},["device_id","project_id","idempotency_key","expected_revision","enabled"]),annotations:meta(false,true)},
 {name:"read_pilot_project",description:"Read latest submitted pilot revision, status, and render job reference. Does not assert creative quality.",inputSchema:schema({project_id:idSchema},["project_id"]),annotations:meta(true,true)},
 {name:"get_media_artifact",description:"Retrieve the integrity manifest and authenticated download page for a completed media job. Does not return raw media as model text or assert creative quality.",inputSchema:schema({job_id:idSchema},["job_id"]),annotations:meta(true,true)},
 {name:"get_worker_result",description:"Retrieve the durable status and verified result of a previously submitted job.",inputSchema:schema({job_id:idSchema},["job_id"]),annotations:meta(true,true)}
]);
function fail(message){throw new Error(message);}
function normalizedCode(value){if(typeof value!=="string")fail("Invalid request code");const code=value.trim().toUpperCase().replace(/-/g,"");if(!CODE.test(code))fail("Invalid request code");return code;}
function uuid(value){if(typeof value!=="string"||!UUID.test(value))fail("Invalid identifier");return value;}
function keys(args,expected){if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).length!==expected.length||expected.some(k=>!Object.hasOwn(args,k)))fail("Invalid tool arguments");}
export async function executeTool(name,args,host){
 if(!host||typeof host.ownerRequest!=="function")fail("Authenticated owner connection required");
 switch(name){
  case "inspect_worker_request":{
   keys(args,["code"]);return host.ownerRequest("POST","/owner/enrollments/lookup",{code:normalizedCode(args.code)});
  }
  case "approve_worker_request":{
   keys(args,["code","request_id"]);
   const code=normalizedCode(args.code),request_id=uuid(args.request_id);
   const review=await host.ownerRequest("POST","/owner/enrollments/lookup",{code});
   if(review?.request_id!==request_id||!["pending","approved"].includes(review.state))fail("Request changed, expired or revoked; inspect again");
   // Host must independently establish the owner's consent for this exact operation.
   // This interface is intentionally fail-closed until a supported consent adapter exists.
   if(typeof host.confirmOwnerAction!=="function"||await host.confirmOwnerAction({action:"approve_worker_request",request_id,fingerprint:review.fingerprint})!==true)fail("Owner approval required");
   return host.ownerRequest("POST","/owner/enrollments/approve",{code,request_id,confirmed:true});
  }
  case "list_workers":{
   keys(args,[]);return host.ownerRequest("GET","/owner/devices");
  }
  case "submit_connection_test":{
   keys(args,["device_id","idempotency_key"]);
   const device_id=uuid(args.device_id),key=args.idempotency_key;
   if(typeof key!=="string"||!key.length||key.length>128)fail("Invalid idempotency key");
   const list=await host.ownerRequest("GET","/owner/devices");
   if(!list?.devices?.some(d=>d.id===device_id&&d.revoked===false))fail("Active Worker required");
   return host.ownerRequest("POST","/owner/jobs",{capability:"file.sha256",device_id,idempotency_key:key,input_b64:"aGVsbG8="});
  }
  case "submit_animatic":{
   keys(args,["device_id","idempotency_key","establish","notice","approach","share"]);
   const device_id=uuid(args.device_id),key=args.idempotency_key,values=[args.establish,args.notice,args.approach,args.share];
   if(typeof key!=="string"||key.length<1||key.length>128||values.some(v=>!Number.isInteger(v)||v<1||v>10)||values.reduce((a,v)=>a+v,0)>30)fail("Invalid animatic specification");
   const list=await host.ownerRequest("GET","/owner/devices");
   if(!list?.devices?.some(d=>d.id===device_id&&d.revoked===false&&(d.media_version===1||d.media_version===2)&&d.media_enabled===true))fail("Media-enabled Worker required");
   return host.ownerRequest("POST","/owner/jobs",{capability:"media.animatic.render",device_id,idempotency_key:key,spec:"v1:"+values.join(":")});
  }
  case "create_pilot_project":
  case "edit_pilot_notice":{
   const create=name==="create_pilot_project";
   keys(args,create?["device_id","project_id","idempotency_key","establish","notice","approach","share"]:["device_id","project_id","idempotency_key","expected_revision","enabled"]);
   const device_id=uuid(args.device_id),project_id=uuid(args.project_id),key=args.idempotency_key;
   if(typeof key!=="string"||key.length<1||key.length>128)fail("Invalid idempotency key");
   const values=[args.establish,args.notice,args.approach,args.share];
   if(create?values.some(v=>!Number.isInteger(v)||v<1||v>10)||values.reduce((a,v)=>a+v,0)>30:!Number.isInteger(args.expected_revision)||args.expected_revision<1||args.expected_revision>15||typeof args.enabled!=="boolean")fail("Invalid project operation");
   return host.ownerRequest("POST","/owner/projects",{device_id,project_id,idempotency_key:key,expected_revision:create?0:args.expected_revision,timing:create?"v1:"+values.join(":"):null,notice:create?null:args.enabled});
  }
  case "read_pilot_project":{
   keys(args,["project_id"]);return host.ownerRequest("GET","/owner/projects/"+uuid(args.project_id));
  }
  case "get_media_artifact":{
   keys(args,["job_id"]);return host.ownerRequest("GET","/owner/jobs/"+uuid(args.job_id)+"/artifact");
  }
  case "get_worker_result":{
   keys(args,["job_id"]);return host.ownerRequest("GET","/owner/jobs/"+uuid(args.job_id));
  }
  default:fail("Unknown tool");
 }
}
