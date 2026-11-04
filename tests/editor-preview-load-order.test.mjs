import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source=readFileSync(new URL("../koba-i-audio.php",import.meta.url),"utf8");
const start=source.indexOf("async function requestAuthorizedPublication() {");
const end=source.indexOf("// 🏗️ HUD DOM CONSOLE ASSEMBLY",start);
assert.ok(start>0&&end>start);
function fixture(readyState="loading",preview=true){
 const listeners=[],document={readyState,addEventListener:(event,callback,options)=>listeners.push({event,callback,options}),getElementById:id=>{assert.equal(id,"koba-editor-preview-data");return preview?{textContent:JSON.stringify({success:true,products:[{assetKey:"ebk_synthetic",layoutMode:"illustrated_pages"}]})}:null;}};
 const window={};
 const request=runInNewContext(`(${source.slice(start,end).trim()})`,{root:{dataset:{editorPreview:"true"}},document,window});
 return{request,listeners,window};
}
test("inline private preview waits until footer scripts execute before resolving illustrated data",async()=>{
 const f=fixture();let resolved=false;
 const pending=f.request().then(data=>{resolved=true;assert.ok(f.window.KobaIllustratedPages);return data;});
 await Promise.resolve();assert.equal(resolved,false);assert.equal(f.listeners.length,1);
 assert.equal(f.listeners[0].event,"DOMContentLoaded");assert.equal(f.listeners[0].options.once,true);
 f.window.KobaIllustratedPages={buildReaderPages(){}};f.listeners[0].callback();
 const data=await pending;assert.equal(data.products[0].layoutMode,"illustrated_pages");
});
test("a ready document previews immediately without waiting for an event that already fired",async()=>{
 const f=fixture("complete");assert.equal((await f.request()).success,true);assert.equal(f.listeners.length,0);
});
test("missing private snapshot still fails closed",async()=>{
 await assert.rejects(()=>fixture("complete",false).request(),/Private editorial preview is unavailable/);
});
test("consumer authorization and footer script placement remain intact",()=>{
 assert.match(source,/await waitForCanonicalHandoff\(\);/);
 assert.match(source,/sessionForAsset\(assetKey, root.dataset.studioKey/);
 assert.match(source,/'koba-illustrated-pages-js',[\s\S]*?assets\/illustrated-pages\.js[\s\S]*?true\s*\);/);
});
