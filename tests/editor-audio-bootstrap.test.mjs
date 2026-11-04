import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
const source=readFileSync(new URL("../assets/jubilee-core.js",import.meta.url),"utf8");
function fixture(overrides={}){
 const book={assetKey:"abk_private_fixture",studioKey:"KOBA-AUDIO-12345678",mediaType:"audiobook",title:"Synthetic private audio",chapters:[{id:"one",title:"First",url:"/protected/audio/one"},{id:"two",title:"Last",url:"/protected/audio/two"}],...overrides};
 const root={textContent:"",getAttribute:name=>({"data-asset":"abk_private_fixture","data-studio-key":"KOBA-AUDIO-12345678","data-editor-preview":"true","data-paid-publication":"true"})[name]||""};
 const events=[],calls=[],player={};
 const window={};Object.defineProperty(window,"KobaReaderHandoff",{get(){throw new Error("Editorial review must not read consumer sessions");}});
 const document={readyState:"loading",querySelectorAll:()=>[],getElementById:id=>id==="jubilee-bloom-root"?root:id==="koba-bloom-root"?player:id==="koba-editor-preview-data"?{textContent:JSON.stringify({success:true,products:[book]})}:null,addEventListener:(name,callback,options)=>events.push({name,callback,options})};
 runInNewContext(source,{document,window,JubileeConfig:{dashboardUrl:"https://dashboard.example.invalid"},console,URL,URLSearchParams,localStorage:{getItem(){throw new Error("No consumer registry access");}},fetch(){throw new Error("No consumer manifest or checkout requests");}});
 window.initKobaBloomPlayer=(element,data,mode)=>calls.push({element,data,mode});
 return{root,events,calls,window,book};
}
test("private audio reuses the existing Bloom initializer after footer scripts and needs no Stripe or consumer token",()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.events[0].name,"DOMContentLoaded");assert.equal(f.events[0].options.once,true);f.events[0].callback();assert.equal(f.calls.length,1);assert.equal(f.calls[0].mode,"full");assert.equal(f.calls[0].data.chapters.length,2);assert.equal(f.calls[0].data.chapters[1].url,"/protected/audio/two");
});
test("wrong asset, tenant or media kind cannot enter the editorial audio player",()=>{
 for(const changes of [{assetKey:"abk_other"},{studioKey:"KOBA-AUDIO-OTHER"},{mediaType:"ebook"}]){const f=fixture(changes);f.events[0].callback();assert.equal(f.calls.length,0);assert.match(f.root.textContent,/unavailable/);}
});
