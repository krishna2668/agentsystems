export const gatewayOrigin='https://gateway.example.invalid';
export const mcpResource=gatewayOrigin+'/mcp';
export const authProject='https://example.supabase.co';
const idPattern=/^[A-Za-z0-9_-]{1,200}$/;
const callbackPattern=/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{1,200})$/;
export function validAuthorizationId(id){return typeof id==='string'&&idPattern.test(id);}
export function validReview(r,id){
 return !!r&&r.authorization_id===id&&typeof r.client_id==='string'&&typeof r.client_name==='string'&&r.client_name.length<=200&&r.resource===mcpResource&&callbackPattern.test(r.redirect_uri||'')&&['pending','approved'].includes(r.state)&&typeof r.scope==='string'&&r.scope.length<=512;
}
export function validCallback(value,expected,decision){
 try{
   if(!callbackPattern.test(expected))return false;
   const u=new URL(value),base=new URL(expected);
   if(u.origin!==base.origin||u.pathname!==base.pathname||u.username||u.password||u.hash)return false;
   return decision==='approve'?u.searchParams.getAll('code').length===1&&!!u.searchParams.get('code')&&!u.searchParams.has('error'):
     u.searchParams.get('error')==='access_denied'&&!u.searchParams.has('code');
 }catch{return false;}
}
