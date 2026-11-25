import {pathToFileURL} from 'node:url';

export async function preflight({account,script,token,fetcher=fetch}) {
  if(!/^[a-f0-9]{32}$/.test(account||'') || !/^[-a-z0-9_]+$/.test(script||'') || !token) throw Error('Missing target or credentials');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/';
  const request=async(name)=>fetcher(base+name+'/settings',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
  const target=await request(script);
  if(!target.ok) throw Error('Target access failed: HTTP '+target.status);
  const result=await target.json();
  if(result.success!==true || !Array.isArray(result.result?.bindings)) throw Error('Target settings not confirmed');
  const bindings=result.result.bindings.map(b=>b.name).sort();
  // A distinct known Worker exists in this shared account. Read-only denial verifies
  // the actual credential's boundary; never mutate that Worker.
  if(script==='agentsystems-gateway'){
    const other=await request('runorc-mcp-worker');
    if(![401,403,404].includes(other.status)) throw Error('Unrelated Worker access not denied: HTTP '+other.status);
  }
  return {target:script,bindings,unrelatedWorkerAccess:script==='agentsystems-gateway'?'denied':'not_checked',initialized:JSON.stringify(bindings)===JSON.stringify(['MCP_ENABLED','REQUEST_LIMIT','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVER_KEY','SUPABASE_URL'])};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const e=process.env;
    console.log(JSON.stringify(await preflight({account:e.CLOUDFLARE_ACCOUNT_ID,script:e.CLOUDFLARE_WORKER_NAME,token:e.CLOUDFLARE_API_TOKEN})));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
