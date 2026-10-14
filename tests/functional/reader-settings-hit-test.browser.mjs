import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");
const source = fs.readFileSync(path.join(pluginRoot, "koba-i-audio.php"), "utf8");
const baseline = JSON.parse(fs.readFileSync(path.join(here, "evidence", "reader-settings-hit-test-baseline.json"), "utf8"));

assert.equal(baseline.viewport.width, 390);
assert.equal(baseline.closed.hitId, "font-size");
assert.equal(baseline.closed.value, "18");
assert.equal(baseline.afterSwipe.value, "26", "the committed before-fix evidence must retain the original 18-to-26 mutation");
assert.equal(baseline.duringFade.pointerEvents, "auto", "the committed before-fix evidence must retain the interactive fade state");

const styleAnchor = source.indexOf("<!-- 🎨 DYNAMIC RESPONSIVE STYLING GRIDS ENGINE -->");
const styleStart = source.indexOf("<style>", styleAnchor) + "<style>".length;
const styleEnd = source.indexOf("</style>", styleStart);
assert.ok(styleAnchor >= 0 && styleStart > 0 && styleEnd > styleStart, "production reader CSS must be extractable");
const readerCss = source.slice(styleStart, styleEnd);

const panelStyleMatch = source.match(/settingsPanel\.style\.cssText = "([^"]+)";/);
assert.ok(panelStyleMatch, "production Settings panel inline style must be extractable");
const panelStyle = panelStyleMatch[1];
assert.match(panelStyle, /display:none/);
assert.match(panelStyle, /pointer-events:none/);

const stateStartMarker = "// KOBA_READER_SETTINGS_STATE_START";
const stateEndMarker = "// KOBA_READER_SETTINGS_STATE_END";
const stateStart = source.indexOf(stateStartMarker);
const stateEnd = source.indexOf(stateEndMarker, stateStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart, "production Settings state controller must be extractable");
const settingsStateController = source.slice(stateStart + stateStartMarker.length, stateEnd);

assert.match(source, /fontSizeRange\.addEventListener\("input", \(\) => applyReaderPreferences\(true\)\)/);
assert.match(source, /lineHeightRange\.addEventListener\("input", \(\) => applyReaderPreferences\(true\)\)/);
assert.doesNotMatch(source, /touch-action:\s*none/);

const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>
  html,body{margin:0;width:100%;height:100%;background:#0f141c}${readerCss}
</style>
<div class="koba-reader-shell" style="width:100%;height:100dvh;box-sizing:border-box;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0f141c">
  <div class="koba-reader-stage">
    <main class="koba-reader-page"><div id="koba-ebook-canvas-root" style="width:100%;height:100%"><div id="reading-surface" class="manuscript-text-container koba-reader-paginated" style="width:100%;height:100%">Reader content</div></div></main>
    <footer class="koba-reader-hud" style="width:min(82vw,920px);display:grid;grid-template-columns:1fr auto auto auto 1fr;align-items:center;gap:14px;padding:10px 14px;box-sizing:border-box;background:rgba(15,20,28,.92);z-index:100"><button>Previous</button><span>1 of 2</span><button id="settings-button" aria-controls="settings" aria-expanded="false">Aa</button><button id="fullscreen-button">Fullscreen</button><button>Next</button></footer>
    <div id="settings" class="koba-reader-settings" hidden inert aria-hidden="true" style="${panelStyle}">
      <label style="display:flex;flex-direction:column;gap:7px;color:white">Text Size<input id="font-size" type="range" min="14" max="26" step="1" value="18"></label>
      <label style="display:flex;flex-direction:column;gap:7px;color:white">Line Spacing<input id="line-height" type="range" min="1.4" max="2.4" step="0.1" value="1.9"></label>
    </div>
  </div>
</div>
<script>
  const settingsPanel=document.querySelector('#settings');
  const settingsButton=document.querySelector('#settings-button');
  const fontSizeRange=document.querySelector('#font-size');
  const lineHeightRange=document.querySelector('#line-height');
  const readerShell=document.querySelector('.koba-reader-shell');
  const resetHUDTimeout=()=>{};
  window.preferenceEvents=[];
  window.navigationCount=0;
  window.readerProgress={chapterId:'chapter-a',pageId:'page-3'};
  window.annotations=[{id:'note-1',text:'kept'}];
  localStorage.setItem('koba_reader_progress_fixture',JSON.stringify(window.readerProgress));
  localStorage.setItem('koba_reader_annotations_fixture',JSON.stringify(window.annotations));
  function persistPreferences(){
    const preferences={fontSize:fontSizeRange.value,lineHeight:lineHeightRange.value};
    localStorage.setItem('koba_reader_preferences_v1',JSON.stringify(preferences));
    window.preferenceEvents.push(preferences);
  }
  fontSizeRange.addEventListener('input',persistPreferences);
  lineHeightRange.addEventListener('input',persistPreferences);
  ${settingsStateController}
  window.openSettingsPanel=openSettingsPanel;
  window.closeSettingsPanel=closeSettingsPanel;
  window.snapshot=(coordinates=null)=>{
    const panelRect=settingsPanel.getBoundingClientRect();
    const fontRect=fontSizeRange.getBoundingClientRect();
    const lineRect=lineHeightRange.getBoundingClientRect();
    const pageRect=document.querySelector('.koba-reader-page').getBoundingClientRect();
    const point=coordinates||{x:fontRect.left+fontRect.width/2,y:fontRect.top+fontRect.height/2};
    const hit=document.elementFromPoint(point.x,point.y);
    return {
      hidden:settingsPanel.hidden,
      inert:settingsPanel.inert,
      ariaHidden:settingsPanel.getAttribute('aria-hidden'),
      ariaExpanded:settingsButton.getAttribute('aria-expanded'),
      display:getComputedStyle(settingsPanel).display,
      pointerEvents:getComputedStyle(settingsPanel).pointerEvents,
      opacity:getComputedStyle(settingsPanel).opacity,
      activeId:document.activeElement?.id||'',
      panelRect:{left:panelRect.left,top:panelRect.top,right:panelRect.right,bottom:panelRect.bottom,width:panelRect.width,height:panelRect.height},
      fontRect:{left:fontRect.left,top:fontRect.top,right:fontRect.right,bottom:fontRect.bottom,width:fontRect.width,height:fontRect.height},
      lineRect:{left:lineRect.left,top:lineRect.top,right:lineRect.right,bottom:lineRect.bottom,width:lineRect.width,height:lineRect.height},
      pageRect:{left:pageRect.left,top:pageRect.top,right:pageRect.right,bottom:pageRect.bottom,width:pageRect.width,height:pageRect.height},
      hitId:hit?.id||'',hitTag:hit?.tagName||'',
      fontSize:fontSizeRange.value,lineHeight:lineHeightRange.value,
      preferenceEvents:[...window.preferenceEvents],navigationCount:window.navigationCount,
      progress:localStorage.getItem('koba_reader_progress_fixture'),
      annotations:localStorage.getItem('koba_reader_annotations_fixture'),
      preferences:localStorage.getItem('koba_reader_preferences_v1')
    };
  };
</script>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/reader-settings`;

const matrix = [
  { name: "phone-390-portrait", width: 390, height: 844, touch: true },
  { name: "phone-390-landscape", width: 844, height: 390, touch: true },
  { name: "phone-430-portrait", width: 430, height: 932, touch: true },
  { name: "phone-430-landscape", width: 932, height: 430, touch: true },
  { name: "tablet-768-portrait", width: 768, height: 1024, touch: true },
  { name: "tablet-768-landscape", width: 1024, height: 768, touch: true },
  { name: "desktop-1024", width: 1024, height: 768, touch: false },
];

async function touchDrag(session, rect, fromFraction, toFraction) {
  const y = rect.top + Math.max(1, rect.height / 2);
  const startX = rect.left + Math.max(2, rect.width * fromFraction);
  const endX = rect.left + Math.min(rect.width - 2, rect.width * toFraction);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: endX, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of matrix) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const page = await context.newPage();
    try {
      await page.goto(url);
      const initial = await page.evaluate(() => window.snapshot({ x: innerWidth / 2, y: innerHeight * 0.75 }));
      assert.equal(initial.hidden, true, `${viewport.name}: closed panel must retain hidden`);
      assert.equal(initial.inert, true, `${viewport.name}: closed panel must be inert`);
      assert.equal(initial.ariaHidden, "true", `${viewport.name}: closed panel must be hidden from accessibility APIs`);
      assert.equal(initial.ariaExpanded, "false", `${viewport.name}: trigger must expose closed state`);
      assert.equal(initial.display, "none", `${viewport.name}: inline grid must not override closed state`);
      assert.equal(initial.pointerEvents, "none", `${viewport.name}: closed panel must not receive pointer input`);
      assert.equal(initial.panelRect.width, 0, `${viewport.name}: closed panel must not occupy layout`);
      assert.notEqual(initial.hitId, "font-size", `${viewport.name}: closed Text Size must not be hit-testable`);
      assert.notEqual(initial.hitId, "line-height", `${viewport.name}: closed Line Spacing must not be hit-testable`);

      await page.evaluate(() => window.openSettingsPanel());
      const open = await page.evaluate(() => window.snapshot());
      assert.equal(open.hidden, false, `${viewport.name}: open panel must clear hidden`);
      assert.equal(open.inert, false, `${viewport.name}: open panel must accept keyboard input`);
      assert.equal(open.ariaHidden, "false", `${viewport.name}: open panel must be exposed accessibly`);
      assert.equal(open.ariaExpanded, "true", `${viewport.name}: trigger must expose open state`);
      assert.equal(open.display, "grid", `${viewport.name}: open panel must retain its grid layout`);
      assert.equal(open.pointerEvents, "auto", `${viewport.name}: open panel must accept intentional input`);
      assert.equal(open.hitId, "font-size", `${viewport.name}: intentional open Text Size range must be hit-testable`);
      assert.ok(open.panelRect.width > 0 && open.panelRect.height > 0, `${viewport.name}: open panel must have usable geometry`);
      assert.ok(open.panelRect.left >= 0 && open.panelRect.right <= viewport.width, `${viewport.name}: panel must remain within viewport width`);

      if (viewport.touch) {
        const session = await context.newCDPSession(page);
        await touchDrag(session, open.fontRect, 0.05, 0.95);
      } else {
        await page.mouse.move(open.fontRect.left + 4, open.fontRect.top + open.fontRect.height / 2);
        await page.mouse.down();
        await page.mouse.move(open.fontRect.right - 4, open.fontRect.top + open.fontRect.height / 2);
        await page.mouse.up();
      }
      const intentional = await page.evaluate(() => window.snapshot());
      assert.notEqual(intentional.fontSize, "18", `${viewport.name}: intentional open adjustment must remain functional`);
      assert.ok(intentional.preferenceEvents.length > 0, `${viewport.name}: intentional adjustment must retain persistence events`);

      await page.evaluate(() => {
        const font = document.querySelector('#font-size');
        const line = document.querySelector('#line-height');
        font.value = '18';
        line.value = '1.9';
        window.preferenceEvents.length = 0;
        line.focus();
      });
      await page.keyboard.press("ArrowRight");
      const keyboard = await page.evaluate(() => window.snapshot());
      assert.equal(keyboard.lineHeight, "2", `${viewport.name}: keyboard range adjustment must remain available while open`);
      assert.equal(keyboard.activeId, "line-height", `${viewport.name}: open range must retain keyboard focus`);

      await page.evaluate(() => window.closeSettingsPanel());
      const closing = await page.evaluate(coords => window.snapshot(coords), {
        x: open.fontRect.left + open.fontRect.width / 2,
        y: open.fontRect.top + open.fontRect.height / 2,
      });
      assert.equal(closing.hidden, false, `${viewport.name}: visual fade may remain mounted for 200 ms`);
      assert.equal(closing.inert, true, `${viewport.name}: closing panel must become keyboard-inert immediately`);
      assert.equal(closing.ariaHidden, "true", `${viewport.name}: closing panel must become accessibly hidden immediately`);
      assert.equal(closing.ariaExpanded, "false", `${viewport.name}: trigger must expose close immediately`);
      assert.equal(closing.pointerEvents, "none", `${viewport.name}: closing panel must leave hit testing immediately`);
      assert.notEqual(closing.hitId, "font-size", `${viewport.name}: closing Text Size must not receive input during fade`);
      assert.notEqual(closing.hitId, "line-height", `${viewport.name}: closing Line Spacing must not receive input during fade`);
      assert.equal(closing.activeId, "settings-button", `${viewport.name}: focus must return to the Settings trigger`);

      await page.evaluate(() => document.querySelector('#line-height').focus());
      await page.keyboard.press("ArrowRight");
      const afterBlockedKeyboard = await page.evaluate(() => window.snapshot());
      assert.notEqual(afterBlockedKeyboard.activeId, "line-height", `${viewport.name}: closing inert range must reject programmatic focus`);
      assert.equal(afterBlockedKeyboard.lineHeight, "2", `${viewport.name}: closing inert range must reject keyboard adjustment`);

      const session = await context.newCDPSession(page);
      await touchDrag(session, open.fontRect, 0.05, 0.95);
      const afterBlockedDrag = await page.evaluate(coords => window.snapshot(coords), {
        x: open.fontRect.left + open.fontRect.width / 2,
        y: open.fontRect.top + open.fontRect.height / 2,
      });
      assert.equal(afterBlockedDrag.fontSize, "18", `${viewport.name}: the original 18-to-26 closed/closing drag must be blocked`);
      assert.equal(afterBlockedDrag.lineHeight, "2", `${viewport.name}: unrelated line spacing must remain unchanged`);

      for (let index = 0; index < 25; index += 1) {
        const y = Math.min(viewport.height - 20, Math.max(20, open.fontRect.top + open.fontRect.height / 2));
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: viewport.width * 0.75, y }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: viewport.width * 0.25, y }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await page.waitForTimeout(225);
      await page.evaluate(() => document.querySelector('#font-size').focus());
      const closed = await page.evaluate(coords => window.snapshot(coords), {
        x: open.fontRect.left + open.fontRect.width / 2,
        y: open.fontRect.top + open.fontRect.height / 2,
      });
      assert.equal(closed.hidden, true, `${viewport.name}: panel must finish hidden after 200 ms`);
      assert.equal(closed.display, "none", `${viewport.name}: panel must finish removed from layout`);
      assert.equal(closed.pointerEvents, "none", `${viewport.name}: panel must remain outside hit testing`);
      assert.notEqual(closed.activeId, "font-size", `${viewport.name}: script focus must not enter a hidden inert range`);
      assert.equal(closed.fontSize, "18", `${viewport.name}: 25 closed reader swipes must not alter font size`);
      assert.equal(closed.lineHeight, "2", `${viewport.name}: 25 closed reader swipes must not alter line spacing`);
      assert.equal(closed.navigationCount, 0, `${viewport.name}: settings isolation test must not synthesize navigation`);
      assert.equal(closed.progress, JSON.stringify({ chapterId: "chapter-a", pageId: "page-3" }), `${viewport.name}: durable reading progress must remain unchanged`);
      assert.equal(closed.annotations, JSON.stringify([{ id: "note-1", text: "kept" }]), `${viewport.name}: annotations must remain unchanged`);
      assert.equal(JSON.parse(closed.preferences).fontSize, "18", `${viewport.name}: persisted preference must reflect only intentional input`);
      assert.equal(JSON.parse(closed.preferences).lineHeight, "2", `${viewport.name}: keyboard preference must remain persisted`);

      results.push({ viewport, initial, open, intentional, keyboard, closing, afterBlockedKeyboard, afterBlockedDrag, closed });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const evidence = {
  status: "PASS",
  baseline: {
    commit: "080bb05a256600e5bb398f0542e186402e561f56",
    viewport: baseline.viewport,
    originalValue: baseline.closed.value,
    mutatedValue: baseline.afterSwipe.value,
    closedHit: baseline.closed.hitId,
    fadePointerEvents: baseline.duringFade.pointerEvents,
  },
  fixedMatrix: results.map(result => ({
    viewport: result.viewport,
    initialClosed: {
      hidden: result.initial.hidden,
      inert: result.initial.inert,
      display: result.initial.display,
      pointerEvents: result.initial.pointerEvents,
      hitId: result.initial.hitId,
      panelSize: { width: result.initial.panelRect.width, height: result.initial.panelRect.height },
    },
    intentionalOpen: {
      display: result.open.display,
      pointerEvents: result.open.pointerEvents,
      fontHit: result.open.hitId,
      fontSizeAfterDrag: result.intentional.fontSize,
      preferenceEventCount: result.intentional.preferenceEvents.length,
      lineHeightAfterKeyboard: result.keyboard.lineHeight,
      keyboardFocus: result.keyboard.activeId,
    },
    immediateClose: {
      hidden: result.closing.hidden,
      inert: result.closing.inert,
      ariaHidden: result.closing.ariaHidden,
      pointerEvents: result.closing.pointerEvents,
      hitId: result.closing.hitId,
      focus: result.closing.activeId,
      lineHeightAfterBlockedKeyboard: result.afterBlockedKeyboard.lineHeight,
      focusAfterBlockedKeyboard: result.afterBlockedKeyboard.activeId,
      fontSizeAfterBlockedDrag: result.afterBlockedDrag.fontSize,
    },
    finalClosed: {
      hidden: result.closed.hidden,
      display: result.closed.display,
      pointerEvents: result.closed.pointerEvents,
      fontSizeAfter25Swipes: result.closed.fontSize,
      lineHeightAfter25Swipes: result.closed.lineHeight,
      progressPreserved: result.closed.progress === JSON.stringify({ chapterId: "chapter-a", pageId: "page-3" }),
      annotationsPreserved: result.closed.annotations === JSON.stringify([{ id: "note-1", text: "kept" }]),
    },
  })),
  physicalDeviceGate: "REQUIRED_BEFORE_RELEASE",
};
fs.writeFileSync(path.join(here, "evidence", "reader-settings-hit-test-fixed.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`READER_SETTINGS_VISIBILITY_PASS: ${JSON.stringify({ baseline: "18-to-26 reproduced", fixedViewports: results.map(result => result.viewport.name), closedDragValues: results.map(result => result.afterBlockedDrag.fontSize) })}`);
