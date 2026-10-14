import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const engine = fs.readFileSync(path.join(root, "assets", "illustrated-pages.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "assets", "illustrated-pages.css"), "utf8");
const productionReader = fs.readFileSync(path.join(root, "koba-i-audio.php"), "utf8");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="#f3ead7"/><rect x="60" y="60" width="1080" height="1680" fill="none" stroke="#6f2d21" stroke-width="12"/><text x="600" y="900" text-anchor="middle" font-size="90">Atomic page plate</text></svg>`;
let apiRequestCount = 0;

assert.match(productionReader, /class="koba-reader-shell"[\s\S]*class="koba-reader-stage"[\s\S]*class="koba-reader-page"[\s\S]*id="koba-ebook-canvas-root"[\s\S]*class="manuscript-text-container"/);
assert.match(productionReader, /const signature = rebuilt\.map\(item => item\.pages\.length\)\.join\(\",\"\)/);
assert.match(productionReader, /illustratedGroupSignature = illustratedPages\.map\(item => item\.pages\.length\)\.join\(\",\"\)/);
assert.doesNotMatch(productionReader, /item\.node\.children\.length/);
assert.match(productionReader, /getExpandedViewerIdentity\?\.\(\)/);
assert.match(productionReader, /closeExpandedViewer\?\.\(\{ restoreFocus: false \}\)/);
assert.match(productionReader, /activeIllustratedPageIdentity/);
assert.match(productionReader, /resolveIllustratedPageIdentity/);
assert.match(productionReader, /focusPageTrigger\?\.\(options\.focusIdentity\)/);
assert.match(productionReader, /preferredIllustratedIdentity: activeProgress/);
assert.match(productionReader, /function showNextPage\(\)[\s\S]*?closeExpandedViewer\?\.\(\)\) return/);
assert.match(productionReader, /function showPreviousPage\(\)[\s\S]*?closeExpandedViewer\?\.\(\)\) return/);
assert.match(styles, /\.koba-illustrated-zoom-viewport[\s\S]*?touch-action: none/);
assert.match(styles, /@media \(forced-colors: active\)/);
assert.doesNotMatch(styles, /(?:html|body|\.koba-reader-shell)\s*\{[^}]*touch-action:\s*none/);

const server = http.createServer((request, response) => {
  if (request.url === "/page.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(svg); return; }
  if (request.url === "/broken.svg") { response.writeHead(404, { "Content-Type": "image/svg+xml" }); response.end(); return; }
  if (request.url?.startsWith("/api/")) { apiRequestCount += 1; response.writeHead(500); response.end(); return; }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>html,body,.koba-reader-shell,.koba-reader-stage,.koba-reader-page,#koba-ebook-canvas-root,.manuscript-text-container{box-sizing:border-box;margin:0;width:100%;height:100%;overflow:hidden}${styles}</style><div class="koba-reader-shell"><div class="koba-reader-stage"><main class="koba-reader-page"><div id="koba-ebook-canvas-root"><div class="manuscript-text-container"></div></div></main><button id="fullscreen">Fullscreen</button><button id="previous">Previous</button><button id="next">Next</button></div></div><script>${engine}</script><script>
    const page = id => ({id,width:1200,height:1800,url:'/page.svg'});
    const book={layoutMode:'illustrated_pages',illustratedPageSettings:{spreadStart:'left',allowSpreads:true,pageBackground:'#111111'},chapters:[{id:'one',pages:[page('1'),page('2')]},{id:'two',pages:[page('3')]}]};
    const root=document.querySelector('#koba-ebook-canvas-root');
    const reader=root.querySelector('.manuscript-text-container');
    const viewportCard=root.closest('.koba-reader-page');
    const stage=root.closest('.koba-reader-stage');
    const readerShell=root.closest('.koba-reader-shell');
    if (!reader || !viewportCard || !stage || !readerShell) throw new Error('Production reader DOM contract missing');
    let built=KobaIllustratedPages.buildReaderPages(book,{width:reader.clientWidth||innerWidth,height:reader.clientHeight||innerHeight});
    let signature=built.map(item=>item.pages.length).join(',');
    let currentIndex=0;
    let selectedIdentity=null;
    const resolveIdentity=(presentation,preferred)=>{ const exact=presentation?.chapterId===preferred?.chapterId?presentation.pages.find(page=>String(page.id)===String(preferred.pageId)):null; const page=exact||presentation?.pages?.[0]; return page?{chapterId:presentation.chapterId,pageId:String(page.id),chapterPageIndex:Number(page.chapterPageIndex)||0}:null; };
    const saveProgress=()=>{ selectedIdentity=resolveIdentity(built[currentIndex],selectedIdentity); if(selectedIdentity) localStorage.setItem('test_progress',JSON.stringify({layoutMode:'illustrated_pages',...selectedIdentity})); };
    const render=({preferredIdentity=selectedIdentity,focusIdentity=null}={})=>{ KobaIllustratedPages.maintainActiveWindow(built,currentIndex,'#111111'); reader.replaceChildren(built[currentIndex].node); selectedIdentity=resolveIdentity(built[currentIndex],preferredIdentity); saveProgress(); if(focusIdentity) KobaIllustratedPages.focusPageTrigger(focusIdentity); };
    addEventListener('koba:illustrated-page-selected',event=>{ selectedIdentity=resolveIdentity(built[currentIndex],event.detail); saveProgress(); });
    const refresh=()=>{ const active=built[currentIndex]; const expandedIdentity=KobaIllustratedPages.getExpandedViewerIdentity(); const progress=expandedIdentity||resolveIdentity(active,selectedIdentity); KobaIllustratedPages.closeExpandedViewer({restoreFocus:false}); const rebuilt=KobaIllustratedPages.buildReaderPages(book,{width:reader.clientWidth||innerWidth,height:reader.clientHeight||innerHeight}); const nextSignature=rebuilt.map(item=>item.pages.length).join(','); if(nextSignature===signature){selectedIdentity=progress;saveProgress();if(expandedIdentity)KobaIllustratedPages.focusPageTrigger(expandedIdentity);return;} KobaIllustratedPages.maintainActiveWindow(built,-10,'#111111'); built=rebuilt; signature=nextSignature; currentIndex=progress?KobaIllustratedPages.locateProgress(rebuilt,progress):0; selectedIdentity=progress; render({preferredIdentity:progress,focusIdentity:expandedIdentity?progress:null}); };
    document.querySelector('#previous').addEventListener('click',()=>{ currentIndex=Math.max(0,currentIndex-1); selectedIdentity=null; render(); });
    document.querySelector('#next').addEventListener('click',()=>{ currentIndex=Math.min(built.length-1,currentIndex+1); selectedIdentity=null; render(); });
    document.querySelector('#fullscreen').addEventListener('click',()=>readerShell.requestFullscreen());
    addEventListener('keydown',event=>{ const tag=document.activeElement?.tagName?.toLowerCase(); if(tag==='input'||tag==='textarea'||tag==='select'||document.activeElement?.isContentEditable)return; if(event.key==='ArrowRight'){event.preventDefault();currentIndex=Math.min(built.length-1,currentIndex+1);render();} if(event.key==='ArrowLeft'){event.preventDefault();currentIndex=Math.max(0,currentIndex-1);render();} });
    addEventListener('resize',refresh);
    render(); reader.dataset.groups=JSON.stringify(built.map(item=>item.pages.length)); window.testState={reader,get built(){return built},get currentIndex(){return currentIndex},get selectedIdentity(){return selectedIdentity},refresh};
  </script>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browserExecutable = process.env.KOBA_BROWSER_EXECUTABLE || undefined;
const browserLabel = process.env.KOBA_BROWSER_LABEL || (browserExecutable ? path.basename(browserExecutable) : "Playwright Chromium");
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
const matrixEvidence = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 900 }, { width: 1920, height: 1080 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    const evidence = await page.evaluate(() => ({
      groups: JSON.parse(document.querySelector(".manuscript-text-container").dataset.groups),
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      images: [...document.images].map(image => ({ loaded: image.complete && image.naturalWidth > 0, ratio: image.clientWidth / image.clientHeight, width: image.clientWidth, height: image.clientHeight })),
    }));
    assert.equal(evidence.overflow, true, `${viewport.width}px must not overflow horizontally`);
    assert.ok(evidence.images.every(image => image.loaded && Math.abs(image.ratio - (2 / 3)) < 0.02));
    assert.ok(evidence.images.every(image => image.width <= viewport.width && image.height <= viewport.height));
    assert.equal(evidence.groups.at(-1), 1, "chapter boundary page must remain single");
    if (viewport.width <= 430) assert.deepEqual(evidence.groups, [1, 1, 1]);
    else assert.deepEqual(evidence.groups, [2, 1]);

    const selectedPageId = viewport.width > 430 ? "2" : "1";
    const trigger = page.locator(`.koba-illustrated-page-expand[data-page-id='${selectedPageId}']`);
    await trigger.focus();
    const progressBeforeSelection = await page.evaluate(() => localStorage.getItem("test_progress"));
    await trigger.click();
    const progressAfterSelection = await page.evaluate(() => localStorage.getItem("test_progress"));
    if (viewport.width > 430) {
      assert.notEqual(progressAfterSelection, progressBeforeSelection, "selecting the right plate must promote its durable identity");
    } else {
      assert.equal(progressAfterSelection, progressBeforeSelection, "reselecting the current single page must preserve its durable identity");
    }
    assert.equal(JSON.parse(progressAfterSelection).pageId, selectedPageId);
    const opened = await page.evaluate(() => ({
      dialogCount: document.querySelectorAll(".koba-illustrated-zoom-overlay[role='dialog'][aria-modal='true']").length,
      pageId: document.querySelector(".koba-illustrated-zoom-overlay")?.dataset.pageId,
      chapterId: document.querySelector(".koba-illustrated-zoom-overlay")?.dataset.chapterId,
      readerInert: document.querySelector(".koba-reader-shell")?.inert,
      stageInert: document.querySelector(".koba-reader-stage")?.inert,
      stageHidden: document.querySelector(".koba-reader-stage")?.getAttribute("aria-hidden"),
      overlayInsideShell: Boolean(document.querySelector(".koba-reader-shell > .koba-illustrated-zoom-overlay")),
      protectedUrl: document.querySelector(".koba-illustrated-zoom-surface img")?.src,
      originalUrl: document.querySelector(".koba-illustrated-page-expand img")?.src,
      status: document.querySelector(".koba-illustrated-zoom-status")?.textContent,
      activeLabel: document.activeElement?.getAttribute("aria-label"),
      bodyLocked: document.body.style.overflow,
    }));
    assert.equal(opened.dialogCount, 1);
    assert.equal(opened.pageId, selectedPageId);
    assert.equal(opened.chapterId, "one");
    assert.equal(opened.readerInert, false, "the dialog must remain interactive when the reader shell is fullscreen");
    assert.equal(opened.stageInert, true);
    assert.equal(opened.stageHidden, "true");
    assert.equal(opened.overlayInsideShell, true);
    assert.equal(opened.protectedUrl, opened.originalUrl, "expanded view must reuse the authorized image URL without rewriting it");
    assert.equal(opened.status, "100%");
    assert.equal(opened.activeLabel, "Close expanded illustration");
    assert.equal(opened.bodyLocked, "hidden");
    assert.equal(await page.locator(".koba-reader-shell img").count(), evidence.images.length + 1, "expanded view may add exactly one image node");

    const plainWheel = await page.locator(".koba-illustrated-zoom-viewport").evaluate(node => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 150, clientY: 180 });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(plainWheel, false, "ordinary wheel scrolling must remain native and must not zoom");
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%");
    await page.getByRole("button", { name: "Zoom in" }).click();
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "125%");
    await page.locator(".koba-illustrated-zoom-viewport").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => window.testState.currentIndex), 0, "viewer arrow-key panning must not navigate the publication");
    await page.keyboard.press("+");
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "150%");
    await page.keyboard.press("f");
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%");

    await page.locator(".koba-illustrated-zoom-viewport").dispatchEvent("wheel", { deltaY: -120, clientX: 150, clientY: 180, ctrlKey: true });
    assert.notEqual(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%", "desktop wheel must zoom the expanded illustration");
    await page.getByRole("button", { name: "Reset zoom and position" }).click();
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%");
    await page.locator(".koba-illustrated-zoom-viewport").evaluate(node => {
      const emit=(type,scale)=>{ const event=new Event(type,{bubbles:true,cancelable:true}); Object.defineProperties(event,{scale:{value:scale},clientX:{value:150},clientY:{value:180}}); node.dispatchEvent(event); };
      emit('gesturestart',1); emit('gesturechange',1.5); emit('gestureend',1.5);
    });
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "150%", "Safari-style trackpad pinch gestures must zoom without changing ordinary wheel behavior");
    await page.getByRole("button", { name: "Fit the complete illustration in the viewer" }).click();
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%");
    await page.locator(".koba-illustrated-zoom-viewport").dblclick({ position: { x: 120, y: 160 } });
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "200%", "desktop double-click must toggle into a useful zoom level");
    await page.locator(".koba-illustrated-zoom-viewport").dblclick({ position: { x: 120, y: 160 } });
    assert.equal(await page.locator(".koba-illustrated-zoom-status").textContent(), "100%", "a second double-click must return to Fit");

    await page.locator(".koba-illustrated-zoom-viewport").evaluate(node => {
      const emit=(type,id,x,y)=>node.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1}));
      emit('pointerdown',1,120,200); emit('pointerdown',2,220,200); emit('pointermove',2,290,200); emit('pointerup',2,290,200); emit('pointerup',1,120,200);
      emit('pointerdown',3,160,210); emit('pointercancel',3,160,210);
    });
    const pinchStatus = await page.locator(".koba-illustrated-zoom-status").textContent();
    assert.ok(parseInt(pinchStatus, 10) > 100, `pinch must zoom, received ${pinchStatus}`);
    const transformBeforePan = await page.locator(".koba-illustrated-zoom-surface").evaluate(node => node.style.transform);
    await page.locator(".koba-illustrated-zoom-viewport").evaluate(node => {
      const emit=(type,x,y)=>node.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:8,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1}));
      emit('pointerdown',180,220); emit('pointermove',230,260); emit('pointerup',230,260);
    });
    const transformAfterPan = await page.locator(".koba-illustrated-zoom-surface").evaluate(node => node.style.transform);
    assert.notEqual(transformAfterPan, transformBeforePan, "one-finger pan must move a zoomed illustration");
    const panBounds = await page.locator(".koba-illustrated-zoom-viewport").evaluate(viewportNode => {
      const surfaceNode = viewportNode.querySelector('.koba-illustrated-zoom-surface');
      const matrix = new DOMMatrix(getComputedStyle(surfaceNode).transform);
      const imageNode = surfaceNode.querySelector('img');
      const scaleValue = matrix.a;
      const maximumX = Math.max(0, (imageNode.offsetWidth * scaleValue - viewportNode.clientWidth) / 2);
      const maximumY = Math.max(0, (imageNode.offsetHeight * scaleValue - viewportNode.clientHeight) / 2);
      return { x: matrix.e, y: matrix.f, maximumX, maximumY };
    });
    assert.ok(Math.abs(panBounds.x) <= panBounds.maximumX + 0.5, "horizontal pan must remain clamped to the image bounds");
    assert.ok(Math.abs(panBounds.y) <= panBounds.maximumY + 0.5, "vertical pan must remain clamped to the image bounds");

    await page.locator(".koba-illustrated-zoom-viewport").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), "Zoom out", "Tab from the last dialog focus target must wrap to the first enabled control");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('koba-illustrated-zoom-viewport')), true, "Shift+Tab from the first control must wrap to the viewer");
    await page.getByRole("button", { name: "Zoom in" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => window.testState.currentIndex), 0, "toolbar arrow keys must not reach global reader navigation");

    const expandedRatio = await page.locator(".koba-illustrated-zoom-surface img").evaluate(image => ({ natural: image.naturalWidth / image.naturalHeight, declared: image.width / image.height }));
    assert.ok(Math.abs(expandedRatio.natural - expandedRatio.declared) < 0.001, "expanded illustration must preserve its intrinsic aspect ratio");
    assert.equal(await page.evaluate(() => localStorage.getItem("test_progress")), progressAfterSelection, "zoom and pan must not mutate progress after the page selection is recorded");

    await page.keyboard.press("Escape");
    const closed = await page.evaluate(() => ({
      dialogCount: document.querySelectorAll(".koba-illustrated-zoom-overlay").length,
      readerInert: document.querySelector(".koba-reader-shell")?.inert,
      stageInert: document.querySelector(".koba-reader-stage")?.inert,
      stageHidden: document.querySelector(".koba-reader-stage")?.hasAttribute("aria-hidden"),
      focusedPageId: document.activeElement?.dataset?.pageId,
      currentIndex: window.testState.currentIndex,
      progress: localStorage.getItem("test_progress"),
    }));
    assert.equal(closed.dialogCount, 0);
    assert.equal(closed.readerInert, false);
    assert.equal(closed.stageInert, false);
    assert.equal(closed.stageHidden, false);
    assert.equal(closed.focusedPageId, selectedPageId, "closing must restore focus to the exact durable page identity");
    assert.equal(closed.currentIndex, 0);
    assert.equal(closed.progress, progressAfterSelection);
    assert.equal(await page.locator(".koba-reader-shell img").count(), evidence.images.length, "closing must release the one expanded image node immediately");
    assert.equal(await page.evaluate(() => Object.values(localStorage).every(value => !value.includes('/page.svg'))), true, "authorized media URLs must never become progress or preference keys");

    await page.click("#next");
    assert.equal(await page.evaluate(() => window.testState.currentIndex), 1, "Next must advance the fresh reader session");
    await page.click("#previous");
    assert.equal(await page.evaluate(() => window.testState.currentIndex), 0, "Previous must return to the first presentation");
    await page.setViewportSize({ width: viewport.width === 390 ? 430 : viewport.width - 1, height: viewport.height });
    await page.evaluate(() => window.testState.refresh());
    assert.ok(await page.locator(".koba-illustrated-page-view").count(), "resize refresh must leave the first page rendered");
    const residency = await page.evaluate(async () => {
      const makePage=id=>({id,width:2400,height:3600,url:'/page.svg'});
      const largeBook={illustratedPageSettings:{spreadStart:'left',allowSpreads:true},chapters:[{id:'a',pages:Array.from({length:16},(_,i)=>makePage(`a-${i}`))},{id:'b',pages:Array.from({length:16},(_,i)=>makePage(`b-${i}`))}]};
      const items=KobaIllustratedPages.buildReaderPages(largeBook,{width:innerWidth,height:innerHeight}); let maxResident=0;
      const visit=index=>{ KobaIllustratedPages.maintainActiveWindow(items,index,'#111111'); window.testState.reader.replaceChildren(items[index].node); const resident=items.reduce((sum,item)=>sum+(item.node?.querySelectorAll('img').length||0),0); maxResident=Math.max(maxResident,resident); };
      for(let index=0;index<items.length;index++) visit(index);
      for(let index=items.length-1;index>=0;index--) visit(index);
      return {totalPages:32,maxResident,hydratedPresentations:items.filter(item=>item.node).length,firstDisposed:items.length>3?items[0].node===null:true};
    });
    assert.equal(residency.totalPages, 32);
    assert.ok(residency.maxResident <= 6, `bounded window held ${residency.maxResident} images`);
    assert.ok(residency.hydratedPresentations <= 2);
    assert.equal(residency.firstDisposed, false, "backward navigation must rehydrate the first presentation");
    matrixEvidence.push({ viewport, groups: evidence.groups, residency });
    await page.close();
  }
  const identityPage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await identityPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await identityPage.locator(".koba-illustrated-page-expand[data-page-id='2']").click();
  assert.deepEqual(await identityPage.evaluate(() => KobaIllustratedPages.getExpandedViewerIdentity()), { chapterId: "one", pageId: "2", chapterPageIndex: 1 });
  await identityPage.setViewportSize({ width: 390, height: 844 });
  await identityPage.evaluate(() => window.testState.refresh());
  const regrouped = await identityPage.evaluate(() => ({
    dialogCount: document.querySelectorAll('.koba-illustrated-zoom-overlay').length,
    activePageIds: window.testState.built[window.testState.currentIndex].pageIds,
    progress: JSON.parse(localStorage.getItem('test_progress')),
    expandedImages: document.querySelectorAll('.koba-illustrated-zoom-surface img').length,
    focusedPageId: document.activeElement?.dataset?.pageId,
  }));
  assert.equal(regrouped.dialogCount, 0, "orientation regroup must teardown the old expanded DOM before disposing its presentation");
  assert.deepEqual(regrouped.activePageIds, ["2"], "orientation regroup must resume the selected right-page identity, not pages[0]");
  assert.equal(regrouped.progress.pageId, "2");
  assert.equal(regrouped.expandedImages, 0);
  assert.equal(regrouped.focusedPageId, "2", "orientation regroup must restore focus to the rebuilt trigger for the selected page");

  await identityPage.locator(".koba-illustrated-page-expand[data-page-id='2']").click();
  await identityPage.setViewportSize({ width: 1366, height: 900 });
  await identityPage.evaluate(() => window.testState.refresh());
  const reverseRegrouped = await identityPage.evaluate(() => ({
    dialogCount: document.querySelectorAll('.koba-illustrated-zoom-overlay').length,
    activePageIds: window.testState.built[window.testState.currentIndex].pageIds,
    selectedIdentity: window.testState.selectedIdentity,
    progress: JSON.parse(localStorage.getItem('test_progress')),
    focusedPageId: document.activeElement?.dataset?.pageId,
  }));
  assert.equal(reverseRegrouped.dialogCount, 0);
  assert.deepEqual(reverseRegrouped.activePageIds, ["1", "2"], "single-to-spread regroup must rebuild the original spread");
  assert.equal(reverseRegrouped.selectedIdentity.pageId, "2", "single-to-spread regroup must retain the right-hand page identity");
  assert.equal(reverseRegrouped.progress.pageId, "2", "single-to-spread regroup must persist the right-hand page, not pages[0]");
  assert.equal(reverseRegrouped.focusedPageId, "2", "single-to-spread regroup must restore focus to the right-hand page trigger");

  await identityPage.locator(".koba-illustrated-page-expand[data-page-id='2']").click();
  await identityPage.keyboard.press("Escape");
  assert.equal(await identityPage.evaluate(() => document.activeElement?.dataset?.pageId), "2");
  await identityPage.close();

  const fullscreenPage = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  await fullscreenPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await fullscreenPage.click("#fullscreen");
  assert.equal(await fullscreenPage.evaluate(() => document.fullscreenElement?.classList.contains('koba-reader-shell')), true, "test must enter the actual reader-shell fullscreen contract");
  await fullscreenPage.locator(".koba-illustrated-page-expand").first().click();
  assert.equal(await fullscreenPage.evaluate(() => document.fullscreenElement?.contains(document.querySelector('.koba-illustrated-zoom-overlay'))), true, "expanded viewer must remain inside the fullscreen element");
  await fullscreenPage.keyboard.press("Escape");
  if (await fullscreenPage.evaluate(() => Boolean(document.fullscreenElement))) await fullscreenPage.evaluate(() => document.exitFullscreen());
  await fullscreenPage.close();

  const brokenPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await brokenPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await brokenPage.locator(".koba-illustrated-page-expand img").first().evaluate(image => { image.src = '/broken.svg'; });
  await brokenPage.locator(".koba-illustrated-page-expand").first().click();
  await brokenPage.locator(".koba-illustrated-zoom-error:not([hidden])").waitFor();
  assert.equal(await brokenPage.getByRole("button", { name: "Close expanded illustration" }).isEnabled(), true, "a broken expanded image must leave the dialog safely closable");
  await brokenPage.getByRole("button", { name: "Close expanded illustration" }).click();
  await brokenPage.close();

  const teardownPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await teardownPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await teardownPage.locator(".koba-illustrated-page-expand").first().click();
  const teardown = await teardownPage.evaluate(() => {
    const overlayImage = document.querySelector('.koba-illustrated-zoom-surface img');
    KobaIllustratedPages.maintainActiveWindow(window.testState.built, -10, '#111111');
    return { dialogCount: document.querySelectorAll('.koba-illustrated-zoom-overlay').length, releasedSrc: overlayImage.getAttribute('src'), residentImages: document.querySelectorAll('.koba-illustrated-page-view img').length };
  });
  assert.equal(teardown.dialogCount, 0);
  assert.equal(teardown.releasedSrc, null, "disposal teardown must remove the expanded protected source immediately");
  assert.equal(teardown.residentImages, 0);
  await teardownPage.close();

  const duplicateIdentityPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await duplicateIdentityPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await duplicateIdentityPage.evaluate(() => {
    const duplicate = chapterId => ({ id: 'shared-page-id', width: 1200, height: 1800, url: '/page.svg', alt: `Illustration in ${chapterId}` });
    const unique = id => ({ id, width: 1200, height: 1800, url: '/page.svg' });
    const book = { illustratedPageSettings: { allowSpreads: false }, chapters: [
      { id: 'chapter-a', pages: [duplicate('chapter-a')] },
      { id: 'chapter-b', pages: [unique('middle')] },
      { id: 'chapter-c', pages: [duplicate('chapter-c')] },
    ] };
    const items = KobaIllustratedPages.buildReaderPages(book, { width: 390, height: 844 });
    KobaIllustratedPages.maintainActiveWindow(items, 2, '#111111');
    window.testState.reader.replaceChildren(items[2].node);
    window.duplicateIdentityState = { book, items };
  });
  await duplicateIdentityPage.locator(".koba-illustrated-page-expand[data-chapter-id='chapter-c'][data-page-id='shared-page-id']").click();
  await duplicateIdentityPage.evaluate(() => {
    const { items } = window.duplicateIdentityState;
    KobaIllustratedPages.maintainActiveWindow(items, 1, '#111111');
    KobaIllustratedPages.maintainActiveWindow(items, 2, '#111111');
  });
  assert.equal(await duplicateIdentityPage.locator('.koba-illustrated-zoom-overlay').count(), 1, "disposing another chapter with the same pageId must not close the active viewer");
  await duplicateIdentityPage.evaluate(() => {
    const { book } = window.duplicateIdentityState;
    const rebuilt = KobaIllustratedPages.buildReaderPages(book, { width: 390, height: 844 });
    KobaIllustratedPages.maintainActiveWindow(rebuilt, 1, '#111111');
    window.testState.reader.replaceChildren(rebuilt[0].node, rebuilt[2].node);
  });
  await duplicateIdentityPage.keyboard.press('Escape');
  const restoredDuplicateIdentity = await duplicateIdentityPage.evaluate(() => ({
    chapterId: document.activeElement?.dataset?.chapterId,
    pageId: document.activeElement?.dataset?.pageId,
  }));
  assert.deepEqual(restoredDuplicateIdentity, { chapterId: 'chapter-c', pageId: 'shared-page-id' }, "focus fallback must use chapterId + pageId when historical page IDs collide");
  await duplicateIdentityPage.close();

  assert.equal(apiRequestCount, 0, "expanded viewing must not introduce any new API or authorization request");
  console.log(`Illustrated page browser matrix passed in ${browserLabel}: ${JSON.stringify(matrixEvidence)}`);
} finally {
  await browser.close();
  server.close();
}
