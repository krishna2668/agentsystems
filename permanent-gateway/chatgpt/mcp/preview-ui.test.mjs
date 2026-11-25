import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const bundle=readFileSync(new URL('./preview/client.bundle.js',import.meta.url),'utf8');
const url='https://gateway.example.invalid/artifacts/12345678-1234-4234-8234-123456789abc';
function run({canvas=true}={}){
 let copied,selected=false,focused=false,color,click;
 const rects=[];
 const nodes={
  'preview-url':{value:url,focus(){focused=true},select(){selected=true}},
  'preview-qr':{hidden:true,getContext(){if(!canvas)throw Error('unavailable');return {set fillStyle(v){color=v},fillRect(...a){rects.push([color,...a])}}}},
  'copy-link':{hidden:true,addEventListener(_,cb){click=cb}},
  'copy-status':{textContent:''},'scan-help':{hidden:true}
 };
 const navigator={clipboard:{async writeText(v){copied=v}}};
 vm.runInNewContext(bundle,{document:{getElementById:id=>nodes[id]},navigator});
 return {nodes,navigator,rects,click:()=>click(),copied:()=>copied,selected:()=>selected&&focused};
}
test('preview renders a local QR and copies the original link',async()=>{
 const x=run();
 assert.equal(x.nodes['preview-qr'].hidden,false);
 assert.equal(x.nodes['scan-help'].hidden,false);
 assert.ok(x.rects.length>100);
 assert.equal(x.nodes['copy-link'].hidden,false);
 await x.click();assert.equal(x.copied(),url);
 assert.equal(x.nodes['copy-status'].textContent,'Link copied.');
 x.navigator.clipboard.writeText=async()=>{throw Error('permission denied')};
 await x.click();assert.ok(x.selected());
});
test('copy remains available when QR drawing fails',async()=>{
 const x=run({canvas:false});
 assert.equal(x.nodes['preview-qr'].hidden,true);
 assert.equal(x.nodes['scan-help'].hidden,true);
 await x.click();assert.equal(x.copied(),url);
});
