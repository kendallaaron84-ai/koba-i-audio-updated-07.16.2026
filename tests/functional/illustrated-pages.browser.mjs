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
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="#f3ead7"/><rect x="60" y="60" width="1080" height="1680" fill="none" stroke="#6f2d21" stroke-width="12"/><text x="600" y="900" text-anchor="middle" font-size="90">Atomic page plate</text></svg>`;

const server = http.createServer((request, response) => {
  if (request.url === "/page.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(svg); return; }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>html,body,#reader{margin:0;width:100%;height:100%;overflow:hidden}${styles}</style><div id="reader"></div><script>${engine}</script><script>
    const page = id => ({id,width:1200,height:1800,url:'/page.svg'});
    const book={layoutMode:'illustrated_pages',illustratedPageSettings:{spreadStart:'left',allowSpreads:true,pageBackground:'#111111'},chapters:[{id:'one',pages:[page('1'),page('2')]},{id:'two',pages:[page('3')]}]};
    const reader=document.querySelector('#reader'); const built=KobaIllustratedPages.buildReaderPages(book,{width:innerWidth,height:innerHeight}); KobaIllustratedPages.maintainActiveWindow(built,0,'#111111'); reader.replaceChildren(built[0].node); reader.dataset.groups=JSON.stringify(built.map(item=>item.pages.length)); window.testState={reader,built};
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
      groups: JSON.parse(document.querySelector("#reader").dataset.groups),
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      images: [...document.images].map(image => ({ loaded: image.complete && image.naturalWidth > 0, ratio: image.clientWidth / image.clientHeight, width: image.clientWidth, height: image.clientHeight })),
    }));
    assert.equal(evidence.overflow, true, `${viewport.width}px must not overflow horizontally`);
    assert.ok(evidence.images.every(image => image.loaded && Math.abs(image.ratio - (2 / 3)) < 0.02));
    assert.ok(evidence.images.every(image => image.width <= viewport.width && image.height <= viewport.height));
    assert.equal(evidence.groups.at(-1), 1, "chapter boundary page must remain single");
    if (viewport.width <= 430) assert.deepEqual(evidence.groups, [1, 1, 1]);
    else assert.deepEqual(evidence.groups, [2, 1]);
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
