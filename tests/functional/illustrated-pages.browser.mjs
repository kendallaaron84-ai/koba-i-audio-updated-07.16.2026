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

assert.match(productionReader, /class="koba-reader-shell"[\s\S]*class="koba-reader-stage"[\s\S]*class="koba-reader-page"[\s\S]*id="koba-ebook-canvas-root"[\s\S]*class="manuscript-text-container"/);
assert.match(productionReader, /const signature = rebuilt\.map\(item => item\.pages\.length\)\.join\(\",\"\)/);
assert.match(productionReader, /illustratedGroupSignature = illustratedPages\.map\(item => item\.pages\.length\)\.join\(\",\"\)/);
assert.doesNotMatch(productionReader, /item\.node\.children\.length/);

const server = http.createServer((request, response) => {
  if (request.url === "/page.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(svg); return; }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>html,body,.koba-reader-shell,.koba-reader-stage,.koba-reader-page,#koba-ebook-canvas-root,.manuscript-text-container{box-sizing:border-box;margin:0;width:100%;height:100%;overflow:hidden}${styles}</style><div class="koba-reader-shell"><div class="koba-reader-stage"><main class="koba-reader-page"><div id="koba-ebook-canvas-root"><div class="manuscript-text-container"></div></div></main></div></div><button id="previous">Previous</button><button id="next">Next</button><script>${engine}</script><script>
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
    const render=()=>{ KobaIllustratedPages.maintainActiveWindow(built,currentIndex,'#111111'); reader.replaceChildren(built[currentIndex].node); };
    const refresh=()=>{ const rebuilt=KobaIllustratedPages.buildReaderPages(book,{width:reader.clientWidth||innerWidth,height:reader.clientHeight||innerHeight}); const nextSignature=rebuilt.map(item=>item.pages.length).join(','); if(nextSignature!==signature){ KobaIllustratedPages.maintainActiveWindow(built,-10,'#111111'); built=rebuilt; signature=nextSignature; currentIndex=Math.min(currentIndex,built.length-1); render(); } };
    document.querySelector('#previous').addEventListener('click',()=>{ currentIndex=Math.max(0,currentIndex-1); render(); });
    document.querySelector('#next').addEventListener('click',()=>{ currentIndex=Math.min(built.length-1,currentIndex+1); render(); });
    addEventListener('resize',refresh);
    render(); reader.dataset.groups=JSON.stringify(built.map(item=>item.pages.length)); window.testState={reader,get built(){return built},get currentIndex(){return currentIndex},refresh};
  </script>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
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
  console.log(`Illustrated page browser matrix passed: ${JSON.stringify(matrixEvidence)}`);
} finally {
  await browser.close();
  server.close();
}
