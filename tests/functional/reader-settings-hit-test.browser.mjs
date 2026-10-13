import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");
const source = fs.readFileSync(path.join(pluginRoot, "koba-i-audio.php"), "utf8");
const styleAnchor = source.indexOf("<!-- 🎨 DYNAMIC RESPONSIVE STYLING GRIDS ENGINE -->");
const styleStart = source.indexOf("<style>", styleAnchor) + "<style>".length;
const styleEnd = source.indexOf("</style>", styleStart);
assert.ok(styleAnchor >= 0 && styleStart > 0 && styleEnd > styleStart, "production reader CSS must be extractable");
const readerCss = source.slice(styleStart, styleEnd);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
try {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><style>
    html,body{margin:0;width:100%;height:100%;background:#0f141c}${readerCss}
  </style>
  <div class="koba-reader-shell" style="width:100%;height:100dvh;box-sizing:border-box;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0f141c">
    <div class="koba-reader-stage">
      <main class="koba-reader-page"><div id="koba-ebook-canvas-root" style="width:100%;height:100%"><div class="manuscript-text-container koba-reader-paginated" style="width:100%;height:100%">Reader content</div></div></main>
      <footer class="koba-reader-hud" style="width:min(82vw,920px);display:grid;grid-template-columns:1fr auto auto auto 1fr;align-items:center;gap:14px;padding:10px 14px;box-sizing:border-box;background:rgba(15,20,28,.92);z-index:100"><button>Previous</button><span>1 of 2</span><button id="settings-button">Aa</button><button>Fullscreen</button><button>Next</button></footer>
      <div id="settings" class="koba-reader-settings" hidden style="width:min(82vw,920px);box-sizing:border-box;padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;background:rgba(15,20,28,.96);margin-top:2px;opacity:0;transition:opacity 200ms ease-in-out;z-index:90">
        <label style="display:flex;flex-direction:column;gap:7px;color:white">Text Size<input id="font-size" type="range" min="14" max="26" step="1" value="18"></label>
      </div>
    </div>
  </div>
  <script>
    const settingsPanel=document.querySelector('#settings');
    const range=document.querySelector('#font-size');
    window.rangeEvents=[];
    range.addEventListener('input',()=>window.rangeEvents.push(range.value));
    window.openSettings=()=>{settingsPanel.hidden=false;void settingsPanel.offsetHeight;settingsPanel.style.opacity='1'};
    window.beginCloseSettings=()=>{settingsPanel.style.opacity='0';setTimeout(()=>{settingsPanel.hidden=true},200)};
    window.snapshot=()=>{
      const panelRect=settingsPanel.getBoundingClientRect();
      const rangeRect=range.getBoundingClientRect();
      const pageRect=document.querySelector('.koba-reader-page').getBoundingClientRect();
      const x=rangeRect.left+rangeRect.width/2;
      const y=rangeRect.top+rangeRect.height/2;
      const hit=document.elementFromPoint(x,y);
      return {hidden:settingsPanel.hidden,display:getComputedStyle(settingsPanel).display,pointerEvents:getComputedStyle(settingsPanel).pointerEvents,panelRect:{left:panelRect.left,top:panelRect.top,right:panelRect.right,bottom:panelRect.bottom},rangeRect:{left:rangeRect.left,top:rangeRect.top,right:rangeRect.right,bottom:rangeRect.bottom},pageRect:{left:pageRect.left,top:pageRect.top,right:pageRect.right,bottom:pageRect.bottom},hitId:hit?.id||'',hitTag:hit?.tagName||'',value:range.value,events:[...window.rangeEvents]};
    };
  </script>`);

  const closed = await page.evaluate(() => window.snapshot());
  assert.equal(closed.hidden, true);
  assert.equal(closed.display, "grid", "inline display:grid overrides the hidden attribute in the current reader");
  assert.equal(closed.hitId, "font-size", "the apparently closed Settings range remains in the hit-test path");

  await page.evaluate(() => window.openSettings());
  const open = await page.evaluate(() => window.snapshot());
  assert.equal(open.hidden, false);
  assert.equal(open.hitId, "font-size", "the open native range is in the reader hit-test path");
  const intersectsPage = open.panelRect.left < open.pageRect.right && open.panelRect.right > open.pageRect.left && open.panelRect.top < open.pageRect.bottom && open.panelRect.bottom > open.pageRect.top;
  assert.equal(intersectsPage, true, "the open mobile bottom sheet overlaps the reader page");

  const session = await context.newCDPSession(page);
  const y = open.rangeRect.top + (open.rangeRect.bottom - open.rangeRect.top) / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: open.rangeRect.left + 8, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: open.rangeRect.right - 8, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const afterSwipe = await page.evaluate(() => window.snapshot());
  assert.notEqual(afterSwipe.value, "18", "trusted touch drag must reproduce the native range mutation");
  assert.ok(afterSwipe.events.length > 0, "trusted touch drag must emit the reader's persistence event");

  await page.evaluate(() => window.beginCloseSettings());
  const duringFade = await page.evaluate(() => window.snapshot());
  assert.equal(duringFade.hidden, false);
  assert.equal(duringFade.hitId, "font-size", "current fade-out leaves Settings hit-testable for 200 ms");

  const evidence = { status: "SECOND_ROOT_CAUSE_REPRODUCED", viewport: { width: 390, height: 844 }, closed, open, afterSwipe, duringFade };
  fs.mkdirSync(path.join(here, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(here, "evidence", "reader-settings-hit-test-baseline.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`SECOND_ROOT_CAUSE_REPRODUCED: ${JSON.stringify({ hiddenAttribute: closed.hidden, closedDisplay: closed.display, closedHit: closed.hitId, valueBefore: open.value, valueAfter: afterSwipe.value, events: afterSwipe.events, fadeHit: duringFade.hitId })}`);
} finally {
  await browser.close();
}
