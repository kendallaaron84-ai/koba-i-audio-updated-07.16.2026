import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");
const source = fs.readFileSync(path.join(pluginRoot, "koba-i-audio.php"), "utf8");
const readerCss = fs.readFileSync(path.join(pluginRoot, "assets", "bloom-style.css"), "utf8");
const startMarker = "// KOBA_REFLOWABLE_CONTENT_ANCHOR_START";
const endMarker = "// KOBA_REFLOWABLE_CONTENT_ANCHOR_END";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, "production content-anchor controller must be extractable");
const anchorController = source.slice(start + startMarker.length, end);

assert.match(source, /contentAnchor:\s*currentContentAnchor/);
assert.match(source, /measureActivePagination\(\{ preserveContentAnchor: true \}\)/);
assert.match(readerCss, /\.koba-reader-copy figure,[\s\S]*break-inside:\s*avoid/);
assert.match(readerCss, /\.koba-reader-copy img,[\s\S]*object-fit:\s*contain/);

const imageSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941" viewBox="0 0 1672 941"><rect width="1672" height="941" fill="#a9552d"/><circle cx="836" cy="470" r="250" fill="#f4efe6"/></svg>');
const html = `<!doctype html><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;background:#0f141c}
  #page{box-sizing:border-box;overflow-x:auto;overflow-y:hidden;column-fill:auto;column-gap:0;scroll-behavior:auto}
  .koba-reader-copy{width:min(100%,760px);margin:0 auto;font-family:Georgia,serif;font-size:var(--font-size,20px);line-height:1.9;color:#221f1a}
  p{margin:0 0 1.5rem}
  figure{width:100%;max-width:100%;margin:1.75rem auto;break-inside:avoid}
  figure img{display:block;width:auto;height:auto;max-width:100%;max-height:min(82vh,52rem);object-fit:contain;margin:0 auto .6rem}
  figcaption{max-width:42rem;margin:0 auto;text-align:center;font-size:.875em;line-height:1.45}
</style>
<article id="page" class="koba-reader-paginated">
  <div class="koba-reader-copy">
    <p id="before">Paragraph One: The local author opens a manuscript and begins the story.</p>
    <figure id="illustration"><img id="art" src="data:image/svg+xml,${imageSvg}" alt="Synthetic mixed-content illustration"><figcaption id="caption">The caption remains with its illustration.</figcaption></figure>
    <p id="after">Paragraph Two: The next scene follows the illustration in reading order.</p>
  </div>
</article>
<script>
  const pageNode=document.querySelector('#page');
  let currentVisualPage=0;
  let currentVisualPageCount=1;
  let currentContentAnchor=null;
  const readerPages=[{node:pageNode}];
  let currentIndex=0;
  function activePaginatedNode(){return readerPages[currentIndex].node;}
  ${anchorController}
  async function settle(){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  async function layout(width,height,preserveContentAnchor=false){
    pageNode.style.width=width+'px';pageNode.style.height=height+'px';
    await settle();
    const pageWidth=Math.max(1,pageNode.clientWidth);
    pageNode.style.columnWidth=pageWidth+'px';pageNode.style.columnGap='0px';
    await settle();
    currentVisualPageCount=Math.max(1,Math.round(pageNode.scrollWidth/pageWidth));
    const preservedAnchor=preserveContentAnchor?normalizedContentAnchor(currentContentAnchor):null;
    const restored=preserveContentAnchor?visualPageForContentAnchor(preservedAnchor,pageNode):null;
    currentVisualPage=Number.isInteger(restored)?Math.min(Math.max(0,restored),currentVisualPageCount-1):Math.min(Math.max(0,currentVisualPage),currentVisualPageCount-1);
    pageNode.scrollLeft=currentVisualPage*pageWidth;
    currentContentAnchor=Number.isInteger(restored)&&preservedAnchor?preservedAnchor:contentAnchorForVisualPage(pageNode);
    await settle();
    return window.snapshot();
  }
  function visualPageForElement(element){
    const rect=[...element.getClientRects()][0];
    return rect?rectVisualPage(rect,pageNode,Math.max(1,pageNode.clientWidth)):null;
  }
  window.snapshot=()=>{
    const image=document.querySelector('#art');
    const figure=document.querySelector('#illustration');
    const caption=document.querySelector('#caption');
    const imageRect=image.getBoundingClientRect();
    return {
      order:[...document.querySelector('.koba-reader-copy').children].map(node=>node.id),
      currentVisualPage,currentVisualPageCount,currentContentAnchor,
      elementPages:{before:visualPageForElement(document.querySelector('#before')),illustration:visualPageForElement(figure),after:visualPageForElement(document.querySelector('#after'))},
      image:{count:document.querySelectorAll('#art').length,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:imageRect.width,height:imageRect.height,objectFit:getComputedStyle(image).objectFit},
      figure:{rectCount:figure.getClientRects().length,breakInside:getComputedStyle(figure).breakInside,captionParent:caption.parentElement?.id,captionCount:document.querySelectorAll('#caption').length},
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    };
  };
  window.layout=layout;
  window.goToAfter=()=>{currentVisualPage=visualPageForElement(document.querySelector('#after'));pageNode.scrollLeft=currentVisualPage*Math.max(1,pageNode.clientWidth);currentContentAnchor=contentAnchorForVisualPage(pageNode);return window.snapshot();};
  window.setFontSize=value=>{currentContentAnchor=contentAnchorForVisualPage(pageNode)||currentContentAnchor;document.documentElement.style.setProperty('--font-size',value+'px');};
</script>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/mixed-content-pagination`;

const browser = await chromium.launch({ headless: true });
let evidence;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#art')?.complete);
    const desktop = await page.evaluate(() => window.layout(808,520));
    assert.deepEqual(desktop.order,["before","illustration","after"]);
    assert.ok(desktop.currentVisualPageCount >= 2,"desktop fixture must repaginate");
    assert.equal(desktop.image.count,1);
    assert.equal(desktop.image.complete,true);
    assert.equal(desktop.image.objectFit,"contain");
    assert.ok(Math.abs((desktop.image.width/desktop.image.height)-(1672/941))<0.02,"image aspect ratio must be preserved");
    assert.equal(desktop.figure.rectCount,1,"figure must remain a single visual unit");
    assert.equal(desktop.figure.breakInside,"avoid");
    assert.equal(desktop.figure.captionParent,"illustration");
    assert.equal(desktop.figure.captionCount,1);
    assert.equal(desktop.overflow,false);

    const positioned = await page.evaluate(() => window.goToAfter());
    assert.equal(positioned.currentVisualPage,positioned.elementPages.after,"test must begin on Paragraph Two");
    assert.deepEqual(positioned.currentContentAnchor,{blockIndex:2,fragmentIndex:0});

    const mobile = await page.evaluate(() => window.layout(334,620,true));
    assert.equal(mobile.currentVisualPage,mobile.elementPages.after,"mobile repagination must retain Paragraph Two");
    assert.deepEqual(mobile.order,["before","illustration","after"]);
    assert.equal(mobile.image.count,1);
    assert.equal(mobile.figure.rectCount,1);
    assert.equal(mobile.figure.captionParent,"illustration");
    assert.equal(mobile.overflow,false);

    const tablet = await page.evaluate(() => window.layout(659,789,true));
    assert.equal(tablet.currentVisualPage,tablet.elementPages.after,"tablet repagination must retain Paragraph Two");

    const returnedDesktop = await page.evaluate(() => window.layout(808,520,true));
    assert.equal(returnedDesktop.currentVisualPage,returnedDesktop.elementPages.after,"desktop return must restore Paragraph Two instead of the earlier illustration page");
    assert.deepEqual(returnedDesktop.currentContentAnchor,{blockIndex:2,fragmentIndex:0});

    await page.evaluate(() => window.setFontSize(26));
    const enlarged = await page.evaluate(() => window.layout(808,520,true));
    assert.equal(enlarged.currentVisualPage,enlarged.elementPages.after,"font-size repagination must retain Paragraph Two");
    assert.deepEqual(enlarged.order,["before","illustration","after"]);
    assert.equal(enlarged.image.count,1);
    assert.equal(enlarged.figure.captionParent,"illustration");

    const fullscreenLike = await page.evaluate(() => window.layout(1100,780,true));
    assert.equal(fullscreenLike.currentVisualPage,fullscreenLike.elementPages.after,"fullscreen geometry change must retain Paragraph Two");
    assert.equal(fullscreenLike.image.count,1);
    assert.equal(fullscreenLike.figure.rectCount,1);
    assert.equal(fullscreenLike.overflow,false);

    evidence={status:"PASS",desktop,positioned,mobile,tablet,returnedDesktop,enlarged,fullscreenLike};
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const evidencePath=path.join(here,"evidence","mixed-content-pagination.json");
fs.writeFileSync(evidencePath,`${JSON.stringify(evidence,null,2)}\n`);
console.log(`MIXED_CONTENT_PAGINATION_PASS: ${JSON.stringify({anchor:evidence.positioned.currentContentAnchor,desktopPage:evidence.returnedDesktop.currentVisualPage,mobilePage:evidence.mobile.currentVisualPage,fontPage:evidence.enlarged.currentVisualPage})}`);
