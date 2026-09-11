import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../assets/bloom-player.js", import.meta.url), "utf8");

function loadResumeApi() {
  const window = { JubileeConfig: { studioKey: "studio_a" }, addEventListener() {} };
  const document = { readyState: "loading", addEventListener() {} };
  vm.runInNewContext(source, { window, document, URL, console, navigator: {} });
  return window.KobaBloomResume;
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("resume state is isolated by authoritative tenant and asset", () => {
  const api = loadResumeApi();
  const storage = memoryStorage();
  const a = api.createResumeController({ tenantId: "studio_a", assetId: "abk_one" }, 2, storage, () => 10000);
  const b = api.createResumeController({ tenantId: "studio_b", assetId: "abk_one" }, 2, storage, () => 10000);
  const c = api.createResumeController({ tenantId: "studio_a", assetId: "abk_two" }, 2, storage, () => 10000);
  assert.notEqual(a.storageKey, b.storageKey);
  assert.notEqual(a.storageKey, c.storageKey);
  assert.equal(a.save(1, 42, { force: true }), true);
  assert.deepEqual({ ...a.read() }, { chapterIndex: 1, position: 42, savedAt: 10000 });
  assert.equal(b.read(), null);
  assert.equal(c.read(), null);
});

test("time updates are throttled while forced lifecycle saves remain immediate", () => {
  const api = loadResumeApi();
  const storage = memoryStorage();
  let now = 10000;
  const controller = api.createResumeController({ tenantId: "studio_a", assetId: "abk_one" }, 3, storage, () => now);
  assert.equal(controller.save(0, 5), true);
  now += 1000;
  assert.equal(controller.save(0, 6), false);
  assert.equal(controller.read().position, 5);
  assert.equal(controller.save(0, 6, { force: true }), true);
  assert.equal(controller.read().position, 6);
});

test("corrupt, stale, future, and out-of-range resume records are rejected and removed", () => {
  const api = loadResumeApi();
  const storage = memoryStorage();
  const now = 100 * 24 * 60 * 60 * 1000;
  const controller = api.createResumeController({ tenantId: "studio_a", assetId: "abk_one" }, 2, storage, () => now);

  for (const value of [
    "not-json",
    JSON.stringify({ version: 1, chapterIndex: 2, position: 1, savedAt: now }),
    JSON.stringify({ version: 1, chapterIndex: 0, position: 1, savedAt: 1 }),
    JSON.stringify({ version: 1, chapterIndex: 0, position: 1, savedAt: now + 10 * 60 * 1000 }),
  ]) {
    storage.setItem(controller.storageKey, value);
    assert.equal(controller.read(), null);
    assert.equal(storage.getItem(controller.storageKey), null);
  }
});

test("restored media position must be inside the loaded chapter duration", () => {
  const api = loadResumeApi();
  const storage = memoryStorage();
  const controller = api.createResumeController({ tenantId: "studio_a", assetId: "vid_one" }, 1, storage, () => 10000);
  controller.save(0, 25, { force: true });
  const state = controller.read();
  assert.equal(controller.positionForDuration(state, 60), 25);
  assert.equal(controller.positionForDuration(state, 20), null);
  assert.equal(controller.read(), null);
});

test("Bloom lifecycle wiring saves pause, chapter change, time, and exit without autoplaying restore", () => {
  assert.match(source, /chapterMedia\.onpause = \(\) =>/);
  assert.match(source, /if \(index !== currentIndex\)/);
  assert.match(source, /persistResume\(false\)/);
  assert.match(source, /addEventListener\('pagehide', \(\) => persistResume\(true\)\)/);
  assert.match(source, /addEventListener\('beforeunload', \(\) => persistResume\(true\)\)/);
  assert.match(source, /loadChapter\(currentIndex, \{ restore: Boolean\(pendingResumeState\), autoplay: false \}\)/);
});
