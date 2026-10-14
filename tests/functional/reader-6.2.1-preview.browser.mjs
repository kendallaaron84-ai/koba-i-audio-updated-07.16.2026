import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 4187;
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, ["tools/reader-6.2.1-preview.mjs", `--port=${port}`], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForPreview() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Reader RC preview did not become ready");
}

let browser;
try {
  const health = await waitForPreview();
  assert.deepEqual(health, { ok: true, version: "6.2.1", productionServices: false });
  browser = await chromium.launch({ headless: true, executablePath: process.env.KOBA_BROWSER_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto(origin, { waitUntil: "networkidle" });

  const rightPage = page.locator(".koba-illustrated-page-expand[data-page-id='page-2']");
  await rightPage.click();
  assert.equal(await page.locator(".koba-illustrated-zoom-overlay").getAttribute("data-page-id"), "page-2");
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("koba_rc_selected"))).pageId, "page-2");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".koba-illustrated-zoom-overlay").count(), 0, "viewport regroup closes the expanded viewer");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.pageId), "page-2", "focus returns to the exact selected page after regrouping");
  assert.match(await page.locator("#status").textContent(), /page-2/);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("koba_rc_selected"))).pageId, "page-2");

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForTimeout(250);
  assert.match(await page.locator("#status").textContent(), /page-2/, "right-page identity survives return to a spread");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.pageId), "page-2");

  await page.locator("#textMode").click();
  await page.locator("#settingsButton").click();
  await page.locator("#fontSize").fill("26");
  await page.locator("#settingsClose").click();
  assert.equal(await page.locator("#settingsPanel").getAttribute("aria-hidden"), "true");
  assert.equal(await page.locator("#settingsPanel").evaluate(element => element.inert), true);
  await page.waitForTimeout(230);
  assert.equal(await page.locator("#settingsPanel").evaluate(element => element.hidden), true);
  assert.equal(await page.locator("#settingsButton").getAttribute("aria-expanded"), "false");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#textMode").click();
  assert.equal(await page.locator("#fontSize").inputValue(), "26", "intentional text-size preference persists");
  assert.equal(await page.locator(".reflow").evaluate(element => getComputedStyle(element).fontSize), "26px");

  console.log("READER_6_2_1_PREVIEW_PASS: exact right-page identity, focus restoration, Settings isolation, and preference persistence");
} finally {
  await browser?.close();
  preview.kill();
  await Promise.race([once(preview, "exit"), new Promise(resolve => setTimeout(resolve, 1000))]);
}
