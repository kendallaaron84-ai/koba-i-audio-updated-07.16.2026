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

function sourceBetween(startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `${label} must be extractable from production source`);
  return source.slice(start, end);
}

const anchorController = sourceBetween("function normalizedContentAnchor(value)", "// KOBA_REFLOWABLE_CONTENT_ANCHOR_END", "content-anchor controller");
const paginationController = sourceBetween("function scrollToCurrentVisualPage(behavior = \"smooth\")", "function bindActivePaginationEvents()", "pagination controller");
const bindingController = sourceBetween("function bindActivePaginationEvents()", "async function renderPage(options = {})", "pagination event binding");
const resizeController = sourceBetween("window.addEventListener(\"resize\", () => {", "readerShell.addEventListener(\"pointermove\"", "resize and ResizeObserver handlers");
const preferencesController = sourceBetween("function applyReaderPreferences(save = true)", "async function toggleFullscreenMode()", "preference re-pagination handler");
const fullscreenController = sourceBetween("document.addEventListener(\"fullscreenchange\", () => {", "fullscreenButton.addEventListener(\"click\"", "fullscreen re-pagination handler");

assert.match(source, /contentAnchor:\s*currentContentAnchor/);
assert.match(bindingController, /currentVisualPageCount > 1 \|\| !normalizedContentAnchor\(currentContentAnchor\)/);
assert.match(readerCss, /\.koba-reader-copy figure,[\s\S]*break-inside:\s*avoid/);
assert.match(readerCss, /\.koba-reader-copy img,[\s\S]*object-fit:\s*contain/);

const imageSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941" viewBox="0 0 1672 941"><rect width="1672" height="941" fill="#a9552d"/><circle cx="836" cy="470" r="250" fill="#f4efe6"/></svg>');
const longAfter = Array.from({ length: 30 }, (_, index) => `Paragraph Two continuation ${index + 1} preserves the reader's selected logical content through reflow.`).join(" ");
const html = `<!doctype html><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;background:#0f141c}
  #page{box-sizing:border-box;overflow-x:auto;overflow-y:hidden;column-fill:auto;column-gap:0;scroll-behavior:auto}
  .koba-reader-copy{width:min(100%,760px);margin:0 auto;font-family:Georgia,serif;font-size:var(--koba-reader-size,20px);line-height:var(--koba-reader-leading,1.9);color:#221f1a}
  p{margin:0 0 1.5rem}
  figure{width:100%;max-width:100%;margin:1.75rem auto;break-inside:avoid}
  figure img{display:block;width:auto;height:auto;max-width:100%;max-height:min(82vh,52rem);object-fit:contain;margin:0 auto .6rem}
  figcaption{max-width:42rem;margin:0 auto;text-align:center;font-size:.875em;line-height:1.45}
</style>
<article id="page" class="koba-reader-paginated">
  <div class="koba-reader-copy">
    <p id="before">Paragraph One: The local author opens a manuscript and begins the story.</p>
    <figure id="illustration"><img id="art" src="data:image/svg+xml,${imageSvg}" alt="Synthetic mixed-content illustration"><figcaption id="caption">The caption remains with its illustration.</figcaption></figure>
    <p id="after">${longAfter}</p>
  </div>
</article>
<button id="fullscreenButton" type="button"></button>
<script>
  const pageNode=document.querySelector('#page');
  const container=pageNode;
  const viewportCard=pageNode;
  const readerShell=pageNode;
  const fullscreenButton=document.querySelector('#fullscreenButton');
  const pageColorSelect={value:'#fffdf7'};
  const fontSelect={value:'Georgia, serif'};
  const fontSizeRange={value:'20'};
  const lineHeightRange={value:'1.9'};
  const marginSelect={value:'760px'};
  const readerPages=[{node:pageNode}];
  let currentIndex=0;
  let currentVisualPage=0;
  let currentVisualPageCount=1;
  let currentContentAnchor=null;
  let restoreContentAnchorOnNextMeasure=false;
  const reduceMotion=true;
  let resizeTimer;
  let lastSavedProgress=null;
  function activePaginatedNode(){return readerPages[currentIndex].node;}
  function updateReaderControls(){}
  function saveReaderProgress(){lastSavedProgress={sectionIndex:currentIndex,visualPage:currentVisualPage,...(currentContentAnchor?{contentAnchor:{...currentContentAnchor}}:{})};}
  function saveReaderPreferences(){}
  function showHUD(){}
  function captureAnnotationSelection(){}
  function showNextPage(){}
  function showPreviousPage(){}
  function refreshIllustratedLayout(){return false;}
  ${anchorController}
  ${paginationController}
  ${bindingController}
  ${resizeController}
  ${preferencesController}
  ${fullscreenController}
  bindActivePaginationEvents();

  async function settle(delay=0){await new Promise(resolve=>setTimeout(resolve,delay));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  async function establishLayout(width,height){pageNode.style.width=width+'px';pageNode.style.height=height+'px';await settle();measureActivePagination();await settle(180);return window.snapshot();}
  async function resizeThroughProduction(width,height){pageNode.style.width=width+'px';pageNode.style.height=height+'px';window.dispatchEvent(new Event('resize'));await settle(360);return window.snapshot();}
  function visualPageForElementFragment(element,fragmentIndex=0){const rects=[...element.getClientRects()];const rect=rects[Math.min(Math.max(0,fragmentIndex),Math.max(0,rects.length-1))];return rect?rectVisualPage(rect,pageNode,Math.max(1,pageNode.clientWidth)):null;}
  window.snapshot=()=>{
    const image=document.querySelector('#art');const figure=document.querySelector('#illustration');const caption=document.querySelector('#caption');const after=document.querySelector('#after');const imageRect=image.getBoundingClientRect();
    return {order:[...document.querySelector('.koba-reader-copy').children].map(node=>node.id),currentVisualPage,currentVisualPageCount,currentContentAnchor,lastSavedProgress,elementPages:{before:visualPageForElementFragment(document.querySelector('#before')),illustration:visualPageForElementFragment(figure),afterFirst:visualPageForElementFragment(after),afterLast:visualPageForElementFragment(after,after.getClientRects().length-1)},afterFragmentCount:after.getClientRects().length,image:{count:document.querySelectorAll('#art').length,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:imageRect.width,height:imageRect.height,objectFit:getComputedStyle(image).objectFit},figure:{rectCount:figure.getClientRects().length,breakInside:getComputedStyle(figure).breakInside,captionParent:caption.parentElement?.id,captionCount:document.querySelectorAll('#caption').length},overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
  };
  window.establishLayout=establishLayout;
  window.resizeThroughProduction=resizeThroughProduction;
  window.goToAfterLastFragment=async()=>{const after=document.querySelector('#after');const fragmentIndex=Math.max(0,after.getClientRects().length-1);currentVisualPage=visualPageForElementFragment(after,fragmentIndex);pageNode.scrollLeft=currentVisualPage*Math.max(1,pageNode.clientWidth);await settle(180);return window.snapshot();};
  window.resizeWithDelayedImage=async(width,height)=>{const image=document.querySelector('#art');image.removeAttribute('src');await settle(40);const loaded=new Promise(resolve=>image.addEventListener('load',resolve,{once:true}));window.setTimeout(()=>{image.src='data:image/svg+xml,${imageSvg}'},80);await loaded;return resizeThroughProduction(width,height);};
  window.changeFontThroughProduction=async value=>{fontSizeRange.value=String(value);applyReaderPreferences();await settle(220);return window.snapshot();};
  window.fullscreenGeometryThroughProduction=async(width,height)=>{pageNode.style.width=width+'px';pageNode.style.height=height+'px';document.dispatchEvent(new Event('fullscreenchange'));await settle(300);return window.snapshot();};
  window.exerciseFallback=async(anchor,visualPage)=>{currentContentAnchor=anchor;currentVisualPage=visualPage;measureActivePagination({preserveContentAnchor:true});await settle(180);return window.snapshot();};
  window.exerciseLegacyProgress=async progress=>{currentIndex=Number(progress?.sectionIndex)||0;currentVisualPage=Number(progress?.visualPage)||0;currentContentAnchor=normalizedContentAnchor(progress?.contentAnchor);measureActivePagination({preserveContentAnchor:currentContentAnchor!==null});await settle(180);return window.snapshot();};
</script>`;

const server = http.createServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); response.end(html); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/mixed-content-pagination`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.KOBA_BROWSER_EXECUTABLE || undefined });
let evidence;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#art')?.complete);
    const desktop = await page.evaluate(() => window.establishLayout(808,520));
    assert.deepEqual(desktop.order,["before","illustration","after"]);
    assert.ok(desktop.currentVisualPageCount >= 3,"desktop fixture must repaginate");
    assert.ok(desktop.afterFragmentCount >= 2,"Paragraph Two must exercise multi-fragment anchoring");
    assert.equal(desktop.image.count,1);
    assert.equal(desktop.image.complete,true);
    assert.equal(desktop.image.objectFit,"contain");
    assert.ok(Math.abs((desktop.image.width/desktop.image.height)-(1672/941))<0.02,"image aspect ratio must be preserved");
    assert.equal(desktop.figure.rectCount,1,"figure must remain a single visual unit");
    assert.equal(desktop.figure.breakInside,"avoid");
    assert.equal(desktop.figure.captionParent,"illustration");
    assert.equal(desktop.figure.captionCount,1);
    assert.equal(desktop.overflow,false);

    const positioned = await page.evaluate(() => window.goToAfterLastFragment());
    assert.equal(positioned.currentVisualPage,positioned.elementPages.afterLast,"test must begin at the final Paragraph Two fragment");
    assert.equal(positioned.currentContentAnchor.blockIndex,2);
    assert.ok(positioned.currentContentAnchor.fragmentIndex >= 1);
    const selectedAnchor={...positioned.currentContentAnchor};

    const onePage = await page.evaluate(() => window.resizeThroughProduction(1100,4000));
    assert.equal(onePage.currentVisualPageCount,1,"fixture must exercise the exact one-page settle branch");
    assert.deepEqual(onePage.currentContentAnchor,selectedAnchor,"one-page scroll settle must retain the selected logical anchor");
    const onePageReturn = await page.evaluate(() => window.resizeThroughProduction(808,520));
    assert.equal(onePageReturn.currentVisualPage,onePageReturn.elementPages.afterLast,"return from one page must restore the selected Paragraph Two fragment");
    assert.deepEqual(onePageReturn.currentContentAnchor,selectedAnchor);

    const mobile = await page.evaluate(() => window.resizeThroughProduction(334,620));
    assert.deepEqual(mobile.currentContentAnchor,selectedAnchor,"real scroll debounce must not replace the logical anchor in a compressed layout");
    assert.deepEqual(mobile.order,["before","illustration","after"]);
    assert.equal(mobile.image.count,1);
    assert.equal(mobile.figure.rectCount,1);
    assert.equal(mobile.figure.captionParent,"illustration");
    assert.equal(mobile.overflow,false);

    const tablet = await page.evaluate(() => window.resizeThroughProduction(659,789));
    assert.equal(tablet.currentContentAnchor.blockIndex,2,"tablet repagination must retain Paragraph Two");
    const returnedDesktop = await page.evaluate(() => window.resizeThroughProduction(808,520));
    assert.equal(returnedDesktop.currentVisualPage,returnedDesktop.elementPages.afterLast,"desktop return must restore the selected Paragraph Two fragment");
    assert.deepEqual(returnedDesktop.currentContentAnchor,selectedAnchor);

    const delayedImage = await page.evaluate(() => window.resizeWithDelayedImage(808,520));
    assert.equal(delayedImage.image.complete,true);
    assert.equal(delayedImage.image.count,1);
    assert.equal(delayedImage.currentContentAnchor.blockIndex,2,"delayed image load must not reset logical progress");

    const enlarged = await page.evaluate(() => window.changeFontThroughProduction(26));
    assert.equal(enlarged.currentContentAnchor.blockIndex,2,"actual preference handler must retain Paragraph Two");
    assert.deepEqual(enlarged.order,["before","illustration","after"]);
    assert.equal(enlarged.image.count,1);
    assert.equal(enlarged.figure.captionParent,"illustration");

    const fullscreenLike = await page.evaluate(() => window.fullscreenGeometryThroughProduction(1100,780));
    assert.equal(fullscreenLike.currentContentAnchor.blockIndex,2,"actual fullscreenchange handler must retain Paragraph Two");
    assert.equal(fullscreenLike.image.count,1);
    assert.equal(fullscreenLike.figure.rectCount,1);
    assert.equal(fullscreenLike.overflow,false);

    await page.evaluate(() => window.resizeThroughProduction(808,520));
    const legacy = await page.evaluate(() => window.exerciseLegacyProgress({sectionIndex:0,visualPage:1}));
    assert.equal(legacy.currentVisualPage,1,"legacy progress without contentAnchor must retain visualPage behavior");
    const malformed = await page.evaluate(() => window.exerciseLegacyProgress({sectionIndex:0,visualPage:1,contentAnchor:{blockIndex:'bad',fragmentIndex:-1}}));
    assert.equal(malformed.currentVisualPage,1,"malformed anchor must fall back to legacy visualPage");
    const missingBlock = await page.evaluate(() => window.exerciseFallback({blockIndex:999,fragmentIndex:0},1));
    assert.equal(missingBlock.currentVisualPage,1,"missing block anchor must fall back deterministically");
    const oversizedFragment = await page.evaluate(() => window.exerciseFallback({blockIndex:2,fragmentIndex:999},0));
    assert.equal(oversizedFragment.currentVisualPage,oversizedFragment.elementPages.afterLast,"oversized fragment must clamp to the block's final fragment");

    evidence={status:"PASS",desktop,positioned,onePage,onePageReturn,mobile,tablet,returnedDesktop,delayedImage,enlarged,fullscreenLike,legacy,malformed,missingBlock,oversizedFragment};
  } finally { await context.close(); }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const evidencePath=path.join(here,"evidence","mixed-content-pagination.json");
fs.writeFileSync(evidencePath,`${JSON.stringify(evidence,null,2)}\n`);
console.log(`MIXED_CONTENT_PAGINATION_PASS: ${JSON.stringify({anchor:evidence.positioned.currentContentAnchor,onePageCount:evidence.onePage.currentVisualPageCount,onePageAnchor:evidence.onePage.currentContentAnchor,returnedPage:evidence.onePageReturn.currentVisualPage,legacyPage:evidence.legacy.currentVisualPage})}`);
