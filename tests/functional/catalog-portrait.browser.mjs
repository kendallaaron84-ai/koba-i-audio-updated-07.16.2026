import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const css = fs.readFileSync(path.join(root, "assets/bloom-style.css"), "utf8");
const catalog = fs.readFileSync(path.join(root, "assets/jubilee-core.js"), "utf8");
const dimensions = [[1800, 2440], [1024, 1536], [500, 500], [1600, 900]];
const products = dimensions.map(([w, h], index) => ({ assetKey: `ebk_portrait_fixture_${index}`, title: `Complete artwork ${w} × ${h}`, type: "ebook", price: index % 2 ? 0 : 12.99, description: "Private browser-test fixture.", coverUrl: `/cover/${w}/${h}.svg` }));
let mutations = 0;
let origin;
const server = http.createServer((request, response) => {
  if (request.method !== "GET") { mutations += 1; response.writeHead(405); response.end(); return; }
  if (request.url.startsWith("/catalog")) { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ success: true, products: products.map(p => ({ ...p, coverUrl: origin + p.coverUrl })) })); return; }
  const image = request.url.match(/^\/cover\/(\d+)\/(\d+)\.svg$/);
  if (image) { const [, w, h] = image; response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#49111a"/><rect x="12" y="12" width="${Number(w)-24}" height="${Number(h)-24}" fill="none" stroke="#d4af37" stroke-width="20"/><text x="50%" y="50%" fill="#f7efdc" font-size="${Number(w)/12}" text-anchor="middle">${w} × ${h}</text></svg>`); return; }
  const ink = request.url === "/ink";
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>html,body{margin:0}body{padding:16px;background:#080706}main{max-width:1120px;margin:auto}${css}
  /* Existing theme specificity must continue to win over shared defaults. */
  .ink-oil-bookshelf-page{background:#f7efdc;padding:20px}.ink-oil-bookshelf-page .jubilee-bookshelf-card{height:560px}.ink-oil-bookshelf-page .jubilee-card-cover{height:auto;aspect-ratio:1800/2440;object-fit:contain;flex:0 0 auto;background:rgba(73,17,26,.04)}.ink-oil-bookshelf-page .jubilee-card-face{background:#f7efdc;color:#241713;border-color:#b18b3d}.ink-oil-bookshelf-page .jubilee-card-title{color:#49111a}
  </style><main class="${ink ? "ink-oil-bookshelf-page" : ""}"><div class="jubilee-catalog-root" id="fixture" data-scope="tenant"></div></main><script>window.JubileeConfig={dashboardUrl:location.origin,apiUrl:location.origin+"/catalog"};</script><script>${catalog}</script>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  for (const theme of ["audio", "ink"]) for (const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    await page.goto(origin + (theme === "ink" ? "/ink" : "/"));
    await page.waitForSelector(".jubilee-card-cover");
    await page.waitForFunction(() => [...document.querySelectorAll(".jubilee-card-cover")].every(i => i.complete && i.naturalWidth > 0));
    const result = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      cards: [...document.querySelectorAll(".jubilee-bookshelf-card")].map(card => {
        const image = card.querySelector("img"), face = card.querySelector(".jubilee-card-front"), box = image.getBoundingClientRect(), title = card.querySelector("h4").getBoundingClientRect(), action = card.querySelector("[data-koba-primary-action]").getBoundingClientRect();
        return { fit: getComputedStyle(image).objectFit, ratio: box.width / box.height, height: card.getBoundingClientRect().height, titleOffset: title.y - card.getBoundingClientRect().y, clipped: face.scrollHeight > face.clientHeight + 1, actionInside: action.bottom <= face.getBoundingClientRect().bottom + 1, color: getComputedStyle(face).backgroundColor, natural:[image.naturalWidth,image.naturalHeight] };
      }),
      purchaseButtons: document.querySelectorAll("button[data-koba-purchase]").length,
      freeLinks: [...document.querySelectorAll("a[data-koba-primary-action]")].every(a => a.href.includes("/reader/free?assetId="))
    }));
    assert.equal(result.documentOverflow, false);
    assert.equal(result.cards.length, 4);
    for (const card of result.cards) { assert.equal(card.fit, "contain"); assert.ok(Math.abs(card.ratio - 1800/2440) < .002); assert.equal(card.height,560); assert.equal(card.clipped,false); assert.equal(card.actionInside,true); assert.equal(card.color,theme === "ink" ? "rgb(247, 239, 220)" : "rgb(22, 27, 34)"); }
    assert.ok(result.cards.every(c => Math.abs(c.titleOffset-result.cards[0].titleOffset)<1));
    assert.deepEqual(result.cards.map(c=>c.natural),dimensions);
    assert.equal(result.purchaseButtons,4); // front and back for each paid fixture
    assert.equal(result.freeLinks,true);
    await page.locator(".jubilee-bookshelf-card").first().focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(()=>document.querySelector(".jubilee-bookshelf-card").getAttribute("aria-expanded")==="true");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".jubilee-bookshelf-card").first().getAttribute("aria-expanded"),"false");
    if(viewport.width < 640) { await page.locator(".jubilee-bookshelf-track").evaluate(e=>e.scrollTo({left:e.scrollWidth,behavior:"instant"})); assert.ok(await page.locator(".jubilee-bookshelf-track").evaluate(e=>e.scrollLeft>0)); }
    fs.mkdirSync(path.join(here,"evidence"),{recursive:true});
    await page.screenshot({path:path.join(here,"evidence",`catalog-portrait-${theme}-${viewport.width}.png`),fullPage:true});
    evidence.push({theme,viewport,result}); await page.close();
  }
  assert.equal(mutations,0);
  fs.writeFileSync(path.join(here,"evidence/catalog-portrait.json"),JSON.stringify({result:"PASS",mutations,evidence},null,2));
  console.log(`CATALOG_PORTRAIT_PASS: ${evidence.length} browser layouts, four original proportions, no mutations`);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
