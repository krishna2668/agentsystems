import {pathToFileURL} from 'node:url';

export async function preflight({account,script,token,deniedWorker,fetcher=fetch}) {
  if(!/^[a-f0-9]{32}$/.test(account||'') || !/^[-a-z0-9_]+$/.test(script||'') || !token) throw Error('Missing target or credentials');
  if(deniedWorker && (!/^[-a-z0-9_]+$/.test(deniedWorker)||deniedWorker===script)) throw Error('Invalid unrelated Worker probe');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/';
  const request=async(name)=>fetcher(base+name+'/settings',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
  const target=await request(script);
  if(!target.ok) throw Error('Target access failed: HTTP '+target.status);
  const result=await target.json();
  if(result.success!==true || !Array.isArray(result.result?.bindings)) throw Error('Target settings not confirmed');
  const bindings=result.result.bindings.map(b=>b.name).sort();
  // Optional deployment-specific negative control. A 404 is inconclusive:
  // the resource may not exist. Never report it as authorization denial.
  let probeStatus=null;
  if(deniedWorker){
    const other=await request(deniedWorker);
    probeStatus=other.status;
    if(![401,403].includes(probeStatus)) throw Error('Unrelated Worker denial not confirmed: HTTP '+probeStatus);
  }
  const required=['MCP_ENABLED','REQUEST_LIMIT','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVER_KEY','SUPABASE_URL'];
  return {target:script,bindings,unrelatedWorkerAccess:deniedWorker?'denied':'not_checked',probeStatus,initialized:required.every(name=>bindings.includes(name))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const e=process.env;
    console.log(JSON.stringify(await preflight({account:e.CLOUDFLARE_ACCOUNT_ID,script:e.CLOUDFLARE_WORKER_NAME,token:e.CLOUDFLARE_API_TOKEN,deniedWorker:e.CLOUDFLARE_DENIED_WORKER})));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
