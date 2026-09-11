import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const pluginRoot = new URL("../", import.meta.url);
function encoded(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function jwt(overrides = {}) { return `${encoded({ alg: "none" })}.${encoded({ exp: 2_000_000_000, tenantId: "studio_a", principalType: "firebase_uid", ...overrides })}.signature`; }

async function executeHandoff({ responseStatus = 200, responsePayload, hash = "#koba_reader_handoff=session.token", storageEntries = [] } = {}) {
  const source = await readFile(new URL("assets/reader-handoff.js", pluginRoot), "utf8");
  const storage = new Map(storageEntries);
  const session = new Map();
  const requests = [];
  const window = { location: { origin: "https://author.example", hash, pathname: "/koba_publication/book/", search: "" }, history: { replaceState(_state, _title, value) { window.replacedUrl = value; window.location.hash = ""; } }, atob: (value) => Buffer.from(value, "base64").toString("binary") };
  const root = { getAttribute(name) { return { "data-asset": "abk_book", "data-studio-key": "studio_a" }[name] || ""; } };
  const context = { window, document: { title: "Book", getElementById(id) { return id === "jubilee-bloom-root" ? root : null; } }, JubileeConfig: { dashboardUrl: "https://dashboard.koba-i.com", studioKey: "studio_a" }, localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } }, sessionStorage: { getItem(key) { return session.get(key) || null; }, setItem(key, value) { session.set(key, value); }, removeItem(key) { session.delete(key); } }, fetch: async (url, options) => { requests.push({ url, options }); return { ok: responseStatus >= 200 && responseStatus < 300, status: responseStatus, async json() { return responsePayload || { success: true, assetId: "abk_book", tenantId: "studio_a", principalType: "firebase_uid", readerToken: jwt(), expiresAt: 2_000_000_000_000 }; } }; }, URL, console };
  vm.runInNewContext(source, context);
  let error = null;
  try { await window.KobaReaderHandoff.ready; } catch (caught) { error = caught; }
  return { window, storage, session, requests, error };
}

test("canonical handoff is exchanged once, removed from the URL, and stored for the existing bearer manifest path", async () => {
  const result = await executeHandoff();
  assert.equal(result.error, null);
  assert.equal(result.window.replacedUrl, "/koba_publication/book/");
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].url, "https://dashboard.koba-i.com/api/reader/media/handoff/exchange");
  assert.deepEqual(JSON.parse(result.requests[0].options.body), { handoff: "session.token", assetId: "abk_book" });
  const registry = JSON.parse(result.storage.get("koba_reader_session"));
  assert.equal(registry.tenants.studio_a.principalType, "firebase_uid");
  assert.equal(registry.tenants.studio_a.assetId, "abk_book");
  assert.equal(result.window.KobaReaderHandoff.sessionForAsset("abk_book", "studio_a").globalReaderToken, jwt());
});

test("e-reader recovers the persisted firebase_uid token after the handoff bootstrap boundary", async () => {
  const firstLoad = await executeHandoff();
  assert.equal(firstLoad.error, null);
  const secondLoad = await executeHandoff({
    hash: "",
    storageEntries: [["koba_reader_session", firstLoad.storage.get("koba_reader_session")]]
  });
  assert.equal(secondLoad.error, null);
  assert.equal(secondLoad.requests.length, 0);
  const recovered = secondLoad.window.KobaReaderHandoff.sessionForAsset("abk_book", "studio_a");
  assert.equal(recovered.principalType, "firebase_uid");
  assert.equal(recovered.globalReaderToken, jwt());
});

test("e-reader rejects persisted firebase_uid tokens for another asset or tenant", async () => {
  const firstLoad = await executeHandoff();
  const storageEntries = [["koba_reader_session", firstLoad.storage.get("koba_reader_session")]];
  const secondLoad = await executeHandoff({ hash: "", storageEntries });
  assert.equal(secondLoad.window.KobaReaderHandoff.sessionForAsset("ebk_other", "studio_a"), null);
  assert.equal(secondLoad.window.KobaReaderHandoff.sessionForAsset("abk_book", "studio_b"), null);
});

test("malformed canonical token claims fail instead of becoming a legacy session", async () => {
  const result = await executeHandoff({ responsePayload: { success: true, assetId: "abk_book", tenantId: "studio_a", principalType: "firebase_uid", readerToken: jwt({ principalType: undefined }), expiresAt: 2_000_000_000_000 } });
  assert.match(result.error.message, /canonical reader token claims/i);
  assert.equal(result.storage.has("koba_reader_session"), false);
});

test("canonical exchange rejection remains explicitly canonical and cannot silently open SMS fallback", async () => {
  const result = await executeHandoff({ responseStatus: 403, responsePayload: { success: false, code: "READER_MEDIA_ENTITLEMENT_REQUIRED", error: "Entitlement required." } });
  assert.equal(result.error.canonicalHandoff, true);
  const core = await readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8");
  assert.match(core, /error\.canonicalHandoff = true/);
  assert.match(core, /sessionForAsset\(assetKey, studioKey\)/);
  assert.doesNotMatch(core, /\/api\/auth\/sms-|Send Access Code|Sovereign Vault Gateway/i);
});

test("anonymous free handoff is asset/origin scoped and does not overwrite the signed-in reader registry", async () => {
  const freeToken = jwt({ principalType: "anonymous_free", assetId: "abk_book", origin: "https://author.example" });
  const result = await executeHandoff({ responsePayload: { success: true, assetId: "abk_book", tenantId: "studio_a", principalType: "anonymous_free", readerToken: freeToken, expiresAt: 2_000_000_000_000 } });
  assert.equal(result.error, null);
  assert.equal(result.storage.has("koba_reader_session"), false);
  const pass = JSON.parse(result.session.get("koba_anonymous_free_passes"));
  assert.equal(pass.principalType, "anonymous_free");
  assert.equal(pass.assetId, "abk_book");
  assert.equal(result.window.KobaReaderHandoff.sessionForAsset("abk_other", "studio_a"), null);
  assert.equal(result.window.KobaReaderHandoff.sessionForAsset("abk_book", "studio_a").globalReaderToken, freeToken);
});

test("canonical reader handoff coexists with shortcode, activation, catalog, audio, video, and e-reader surfaces", async () => {
  const [core, php] = await Promise.all([readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8"), readFile(new URL("koba-i-audio.php", pluginRoot), "utf8")]);
  assert.doesNotMatch(core, /koba_reader_token_|completeListenerCheckout|\/api\/auth\/sms-|Sovereign Vault Gateway/i);
  assert.match(core, /sessionForAsset\(assetKey, studioKey\)/);
  assert.match(core, /\/reader\/open\?assetId=/);
  assert.match(core, /\/reader\/free\?assetId=/);
  assert.match(php, /add_shortcode\('jubilee_catalog'/);
  assert.match(php, /function koba_render_bloom_player_shortcode/);
  assert.match(php, /function koba_handle_license_submit/);
  assert.match(php, /koba_render_bloom_player_ui/);
  assert.match(php, /koba_render_sovereign_reader_engine/);
  assert.match(php, /koba-reader-handoff-js/);
  assert.doesNotMatch(php, /\/api\/auth\/sms-|Send Access Code|Sovereign Vault Gateway/i);
});
