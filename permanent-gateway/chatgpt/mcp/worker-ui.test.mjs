import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('consent/client.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('void initialize().catch(error);','');
const code='ABCDEFGH2345', id='12345678-1234-4234-8234-123456789abc';
function fixture(){
 const nodes=new Map(),calls=[],handlers=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:true,textContent:'',disabled:false,addEventListener:(type,fn)=>handlers.set(id+':'+type,fn),replaceChildren(){},append(){}});return nodes.get(id);};
 const review={request_id:id,state:'pending',fingerprint:'a'.repeat(64),expires_at:Math.floor(Date.now()/1000)+300};
 const context=vm.createContext({document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>({})},location:{pathname:'/workers',href:'https://example.test/workers'},URL,Date,Error,JSON,Array,console,fetch:async(path,options)=>{calls.push([path,options.method,options.body?JSON.parse(options.body):null]);return {ok:true,json:async()=>path.endsWith('/lookup')?review:path.endsWith('/approve')?{state:'approved',device_id:id}:{devices:[]}};}});
 vm.runInContext(source+'\nauth={auth:{getSession:async()=>({data:{session:{access_token:"test-only"}}})}};',context);
 const click=async(key)=>{handlers.get(key)({preventDefault(){}});for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 return {node,calls,click,review};
}
test('review does not authorize, then explicit button approves exact reviewed device',async()=>{
 const {node,calls,click}=fixture();node('deviceCode').value='ABCD-EFGH-2345';
 await click('deviceForm:submit');assert.equal(node('deviceReview').hidden,false);
 assert.equal(calls.length,1);assert.equal(calls[0][0],'/owner/enrollments/lookup');
 await click('approveDevice:click');
 assert.deepEqual(calls[2],['/owner/enrollments/approve','POST',{code,request_id:id,confirmed:true}]);
 assert.equal(node('deviceReview').hidden,true);assert.match(node('notice').textContent,/Device authorized/);
});
test('changing input invalidates reviewed request, prevents approval',async()=>{
 const {node,calls,click}=fixture();node('deviceCode').value=code;
 await click('deviceForm:submit');node('deviceCode').value='ABCDEFGH2346';await click('deviceCode:input');await click('approveDevice:click');
 assert.equal(calls.length,1);assert.equal(node('deviceReview').hidden,true);
});
test('changed device fingerprint prevents approval',async()=>{
 const {node,calls,click,review}=fixture();node('deviceCode').value=code;
 await click('deviceForm:submit');review.fingerprint='b'.repeat(64);await click('approveDevice:click');
 assert.equal(calls.length,2);assert.equal(node('deviceReview').hidden,true);assert.match(node('notice').textContent,/Request changed/);
});
