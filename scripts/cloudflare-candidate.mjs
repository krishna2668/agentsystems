// Upload a version only; this script cannot promote traffic.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const names = ['MCP_ENABLED','REQUEST_LIMIT','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVER_KEY','SUPABASE_URL'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function metadataFor(settings, revision) {
  const bindings = settings.bindings?.map(b=>b.name).sort();
  if (JSON.stringify(bindings)!==JSON.stringify(names)) throw Error('Unexpected binding inventory; review deployment configuration');
  if (!/^[0-9a-f]{40}$/.test(revision)) throw Error('Invalid source revision');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date||'')) throw Error('Missing compatibility date');
  return {
    main_module:'gateway.mjs', compatibility_date:settings.compatibility_date,
    compatibility_flags:settings.compatibility_flags||[],
    bindings:names.map(name=>({name,type:'inherit',old_name:name,version_id:'latest'})),
    annotations:{'workers/commit_sha':revision,'workers/message':'AgentSystems reviewed gateway candidate'}
  };
}
export async function uploadCandidate({account,script,token,revision,code,fetcher=fetch}) {
  if (!/^[a-f0-9]{32}$/.test(account||'')||!/^[-a-z0-9_]+$/.test(script||'')||!token) throw Error('Release credentials or target not configured');
  if (!code?.length||code.includes('gateway.example.invalid')||code.includes('https://example.supabase.co')) throw Error('Gateway bundle missing deployment configuration');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+script;
  const call=async(path,init={})=>{
    const res=await fetcher(base+path,{...init,headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
    const body=await res.json().catch(()=>null);
    if(!res.ok||body?.success!==true)throw Error('Cloudflare request failed: HTTP '+res.status);
    return body.result;
  };
  const [settings,deployments,versions]=await Promise.all([call('/settings'),call('/deployments'),call('/versions')]);
  const active=deployments.deployments?.[0]?.versions;
  const latest=versions.items?.slice().sort((a,b)=>b.number-a.number)[0];
  if(active?.length!==1||active[0].percentage!==100||!uuid.test(active[0].version_id)||latest?.id!==active[0].version_id)throw Error('Active version differs from latest upload; resolve existing candidate first');
  const meta=metadataFor(settings,revision);
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('gateway.mjs',new Blob([code],{type:'application/javascript+module'}),'gateway.mjs');
  const candidate=await call('/versions?bindings_inherit=strict',{method:'POST',body:form});
  if(!uuid.test(candidate?.id||''))throw Error('Candidate identity not confirmed');
  const after=await call('/deployments');
  if(JSON.stringify(after.deployments?.[0]?.versions)!==JSON.stringify(active))throw Error('Active deployment changed during upload; inspect Cloudflare');
  return {revision,candidate:candidate.id,active:active[0].version_id,sha256:createHash('sha256').update(code).digest('hex')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const env=process.env;
    const result=await uploadCandidate({account:env.CLOUDFLARE_ACCOUNT_ID,script:env.CLOUDFLARE_WORKER_NAME,token:env.CLOUDFLARE_API_TOKEN,revision:env.GITHUB_SHA,code:await readFile('permanent-gateway/chatgpt/mcp/gateway.bundle.mjs','utf8')});
    console.log(JSON.stringify(result));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
