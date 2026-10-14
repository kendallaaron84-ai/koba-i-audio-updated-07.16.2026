import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedPort = Number(process.argv.find(value => /^--port=\d+$/.test(value))?.split("=")[1] || 4173);

function pageSvg(number, title, accent) {
  const escapedTitle = title.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="#f6efe3"/><rect x="52" y="52" width="1096" height="1696" rx="22" fill="none" stroke="${accent}" stroke-width="18"/><circle cx="600" cy="650" r="360" fill="${accent}" opacity=".18"/><path d="M180 1160 Q600 720 1020 1160 L1020 1500 L180 1500Z" fill="${accent}" opacity=".72"/><text x="600" y="260" text-anchor="middle" font-family="Georgia,serif" font-size="76" fill="#17223b">${escapedTitle}</text><text x="600" y="1640" text-anchor="middle" font-family="system-ui,sans-serif" font-size="48" fill="#17223b">PAGE ${number}</text></svg>`;
}

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>KOBA-I Reader 6.2.1 RC Preview</title><link rel="stylesheet" href="/assets/illustrated-pages.css"><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#071124;color:#fff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#071124,#16264a);min-height:100vh}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:#08101fcc;border-bottom:1px solid #354466;position:sticky;top:0;z-index:5}.top strong{color:#f9b437}.mode,.controls{display:flex;gap:8px;flex-wrap:wrap}button{min-height:44px;border:1px solid #53627e;border-radius:8px;background:#18243c;color:#fff;padding:8px 14px;font-weight:700}button:hover,button:focus-visible{border-color:#f9b437;outline:2px solid transparent}.active{background:#f9b437;color:#13203b}.shell{height:calc(100dvh - 70px);display:grid;grid-template-rows:minmax(0,1fr) auto;padding:12px;gap:10px}.stage{min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid #354466;border-radius:12px;background:#0c1322;position:relative}.reader{width:100%;height:100%;min-height:0}.footer{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}.status{min-width:190px;text-align:center;color:#ced6e6}.reflow{height:100%;overflow:auto;background:#f6efe3;color:#17223b;padding:clamp(24px,6vw,90px);font:var(--reader-size,20px)/var(--reader-line,1.6) Georgia,serif}.reflow h1{font-size:2em}.settings{position:absolute;inset:auto 12px 12px auto;z-index:4;width:min(330px,calc(100% - 24px));background:#101b31;border:1px solid #687895;border-radius:12px;padding:18px;gap:14px}.settings label{display:grid;gap:6px}.settings[hidden]{display:none!important}.settings .close{justify-self:end}.hint{position:absolute;left:12px;top:12px;background:#071124cc;padding:8px 10px;border-radius:8px;color:#d8dfec;font-size:13px;pointer-events:none}.koba-illustrated-page-view{height:100%}@media(max-width:680px){.top{align-items:flex-start;flex-direction:column}.shell{height:calc(100dvh - 126px);padding:6px}.hint{font-size:11px}}
</style></head><body><header class="top"><strong>KOBA-I Reader 6.2.1 RC — isolated fixture</strong><div class="mode"><button id="illustratedMode" class="active">Portrait illustrations</button><button id="textMode">Reflowable text</button><button id="settingsButton" aria-expanded="false">Settings</button></div></header><main class="shell koba-reader-shell"><section class="stage koba-reader-stage"><div class="hint">Select a page to expand • swipe or use Previous/Next</div><div id="reader" class="reader"></div><section id="settingsPanel" class="settings" hidden inert aria-hidden="true"><button id="settingsClose" class="close">Close settings</button><label>Text size <input id="fontSize" type="range" min="16" max="32" value="20"><output id="fontOutput">20px</output></label><label>Line spacing <input id="lineHeight" type="range" min="1.2" max="2" step="0.1" value="1.6"><output id="lineOutput">1.6</output></label></section></section><footer class="footer"><button id="previous">Previous</button><span id="status" class="status"></span><button id="next">Next</button><button id="fullscreen">Fullscreen</button></footer></main><script src="/assets/illustrated-pages.js"></script><script>
(function(){
const book={layoutMode:'illustrated_pages',illustratedPageSettings:{allowSpreads:true,spreadStart:'left',plateBackground:'#0c1322'},chapters:[{id:'chapter-one',title:'A Synthetic Story',pages:[1,2,3,4].map(function(n){return{id:'page-'+n,chapterPageIndex:n-1,position:n,width:1200,height:1800,alt:'Synthetic portrait illustration page '+n,url:'/fixture/page-'+n+'.svg'};})},{id:'chapter-two',title:'Second Chapter',pages:[5,6].map(function(n){return{id:'page-'+n,chapterPageIndex:n-5,position:n,width:1200,height:1800,alt:'Synthetic portrait illustration page '+n,url:'/fixture/page-'+n+'.svg'};})}]};
const reader=document.getElementById('reader'),status=document.getElementById('status'),stage=document.querySelector('.stage');let mode='illustrated',presentations=[],activeIndex=0,selected=JSON.parse(localStorage.getItem('koba_rc_selected')||'null'),closeTimer=0,touchStart=null;
function viewport(){return{width:Math.max(1,stage.clientWidth-24),height:Math.max(1,stage.clientHeight-24)};}
function chosen(p){if(selected&&p.chapterId===selected.chapterId&&p.pageIds.includes(selected.pageId))return selected;const page=p.pages[0];return{chapterId:p.chapterId,pageId:String(page.id),chapterPageIndex:Number(page.chapterPageIndex)||0};}
function persist(identity){selected=identity;localStorage.setItem('koba_rc_selected',JSON.stringify(identity));}
function rebuild(focusIdentity){const preferred=focusIdentity||selected;presentations=KobaIllustratedPages.buildReaderPages(book,viewport());let found=preferred?KobaIllustratedPages.locateProgress(presentations,preferred):0;activeIndex=Math.max(0,Math.min(found,presentations.length-1));render(focusIdentity);}
function render(focusIdentity){if(mode==='text'){reader.innerHTML='<article class="reflow"><h1>A Reflowable Reading Sample</h1><p>Use Settings to change this text intentionally. Close the panel, swipe across the reading area, and confirm the typography does not move.</p><p>Your preference persists after refresh while the synthetic illustrated-page position remains stored by chapter and page identity.</p><p>This offline preview contains no customer text, protected media, credentials, or network service.</p></article>';status.textContent='Reflowable sample';applyTypography();return;}const p=presentations[activeIndex];if(!p)return;const identity=chosen(p);persist(identity);const node=KobaIllustratedPages.maintainActiveWindow(presentations,activeIndex,book.illustratedPageSettings.plateBackground);reader.replaceChildren(node);status.textContent=p.label+' • '+identity.chapterId+' / '+identity.pageId;if(focusIdentity)requestAnimationFrame(function(){KobaIllustratedPages.focusPageTrigger(focusIdentity);});}
window.addEventListener('koba:illustrated-page-selected',function(event){if(event.detail)persist(event.detail);});
function move(delta){if(mode!=='illustrated')return;activeIndex=Math.max(0,Math.min(presentations.length-1,activeIndex+delta));persist(chosen(presentations[activeIndex]));render();}
document.getElementById('previous').onclick=function(){move(-1)};document.getElementById('next').onclick=function(){move(1)};
document.getElementById('illustratedMode').onclick=function(){mode='illustrated';this.classList.add('active');document.getElementById('textMode').classList.remove('active');rebuild();};document.getElementById('textMode').onclick=function(){mode='text';this.classList.add('active');document.getElementById('illustratedMode').classList.remove('active');render();};
reader.addEventListener('touchstart',function(event){if(event.touches.length===1)touchStart={x:event.touches[0].clientX,y:event.touches[0].clientY};},{passive:true});reader.addEventListener('touchend',function(event){if(!touchStart||event.changedTouches.length!==1)return;const dx=event.changedTouches[0].clientX-touchStart.x,dy=event.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);},{passive:true});
window.addEventListener('keydown',function(event){if(document.querySelector('.koba-illustrated-zoom-overlay'))return;if(event.key==='ArrowRight')move(1);if(event.key==='ArrowLeft')move(-1);});
let resizeTimer=0;window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){if(mode!=='illustrated')return;const identity=KobaIllustratedPages.getExpandedViewerIdentity()||selected;KobaIllustratedPages.closeExpandedViewer({restoreFocus:false});rebuild(identity);},100);});
document.getElementById('fullscreen').onclick=function(){if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen();};
const panel=document.getElementById('settingsPanel'),settingsButton=document.getElementById('settingsButton'),settingsClose=document.getElementById('settingsClose');function openSettings(){clearTimeout(closeTimer);panel.hidden=false;panel.inert=false;panel.style.display='grid';panel.style.pointerEvents='auto';panel.setAttribute('aria-hidden','false');settingsButton.setAttribute('aria-expanded','true');settingsClose.focus();}function closeSettings(){clearTimeout(closeTimer);panel.style.pointerEvents='none';panel.inert=true;panel.setAttribute('aria-hidden','true');settingsButton.setAttribute('aria-expanded','false');const finish=function(){panel.hidden=true;panel.style.display='none';settingsButton.focus();};closeTimer=setTimeout(finish,200);}settingsButton.onclick=function(){if(!panel.hidden&&panel.getAttribute('aria-hidden')!=='true')closeSettings();else openSettings();};settingsClose.onclick=closeSettings;
const font=document.getElementById('fontSize'),line=document.getElementById('lineHeight');font.value=localStorage.getItem('koba_rc_font')||'20';line.value=localStorage.getItem('koba_rc_line')||'1.6';function applyTypography(){document.documentElement.style.setProperty('--reader-size',font.value+'px');document.documentElement.style.setProperty('--reader-line',line.value);document.getElementById('fontOutput').value=font.value+'px';document.getElementById('lineOutput').value=line.value;}font.oninput=function(){localStorage.setItem('koba_rc_font',font.value);applyTypography();};line.oninput=function(){localStorage.setItem('koba_rc_line',line.value);applyTypography();};applyTypography();rebuild();
})();
</script></body></html>`;

const pages = ["#a9552d", "#1f4d68", "#7b4961", "#48634a", "#755a28", "#344d7b"];
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(html);
    return;
  }
  if (url.pathname === "/assets/illustrated-pages.js" || url.pathname === "/assets/illustrated-pages.css") {
    const file = path.join(root, url.pathname.slice(1));
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "Cache-Control": "no-store" });
    response.end(content);
    return;
  }
  const fixture = /^\/fixture\/page-(\d+)\.svg$/.exec(url.pathname);
  if (fixture && Number(fixture[1]) >= 1 && Number(fixture[1]) <= pages.length) {
    const number = Number(fixture[1]);
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    response.end(pageSvg(number, number <= 4 ? "A SYNTHETIC STORY" : "SECOND CHAPTER", pages[number - 1]));
    return;
  }
  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, version: "6.2.1", productionServices: false }));
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
});

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`KOBA-I Reader 6.2.1 RC preview: http://127.0.0.1:${requestedPort}`);
  console.log("Localhost only; synthetic fixtures; no production credentials or services.");
});
