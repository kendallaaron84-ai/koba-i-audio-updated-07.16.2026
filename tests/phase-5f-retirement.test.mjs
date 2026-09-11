import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const pluginRoot = new URL("../", import.meta.url);

async function executePublication({ principalType = "firebase_uid", paid = true, session = true } = {}) {
  const source = await readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8");
  const requests = [];
  const redirects = [];
  const initialized = [];
  const storage = new Map();
  const root = {
    getAttribute(name) {
      return {
        "data-asset": "abk_book",
        "data-studio-key": "studio_a",
        "data-paid-publication": paid ? "true" : "false",
      }[name] || "";
    },
  };
  const nodes = {
    "jubilee-bloom-root": root,
    "koba-bloom-root": {},
    "bloom-player-wrapper": { style: { setProperty() {} } },
    "koba-vault-door": { style: {}, innerHTML: "" },
    "koba-ui-error-region": { textContent: "" },
  };
  const canonicalSession = session
    ? {
        tenantId: "studio_a",
        assetId: "abk_book",
        principalType,
        globalReaderToken: `${principalType}.token`,
      }
    : null;
  const location = {
    search: "",
    href: "https://author.example/koba_publication/book/",
    replace(value) { redirects.push(value); },
    assign(value) { redirects.push(value); },
  };
  const window = {
    location,
    KobaReaderHandoff: {
      ready: Promise.resolve(),
      sessionForAsset() { return canonicalSession; },
      clearTenant() {},
    },
    initKobaBloomPlayer(playerRoot, data, mode) { initialized.push({ playerRoot, data, mode }); },
    alert() {},
  };
  const context = {
    window,
    document: {
      readyState: "complete",
      getElementById(id) { return nodes[id] || null; },
      addEventListener() {},
    },
    JubileeConfig: {
      dashboardUrl: "https://dashboard.koba-i.com",
      pluginUrl: "https://author.example/wp-content/plugins/koba-i-audio",
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            products: [{ assetId: "abk_book", assetKey: "abk_book", title: "Book", chapters: [] }],
          };
        },
      };
    },
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { initialized, requests, redirects, nodes };
}

for (const principalType of ["firebase_uid", "anonymous_free"]) {
  test(`canonical ${principalType} publication reaches the protected manifest and player`, async () => {
    const result = await executePublication({ principalType, paid: principalType === "firebase_uid" });
    assert.equal(result.redirects.length, 0);
    assert.equal(result.requests.length, 1);
    assert.match(result.requests[0].url, /\/api\/media\/manifest\?asset=abk_book$/);
    assert.equal(result.requests[0].options.headers.Authorization, `Bearer ${principalType}.token`);
    assert.equal(result.initialized.length, 1);
    assert.equal(result.initialized[0].data.assetKey, "abk_book");
  });
}

test("missing canonical paid authorization routes to the reader launcher without SMS fallback", async () => {
  const result = await executePublication({ paid: true, session: false });
  assert.deepEqual(result.redirects, ["https://dashboard.koba-i.com/reader/open?assetId=abk_book"]);
  assert.equal(result.requests.length, 0);
});

test("missing canonical free authorization routes to the Turnstile launcher without SMS fallback", async () => {
  const result = await executePublication({ paid: false, session: false });
  assert.deepEqual(result.redirects, ["https://dashboard.koba-i.com/reader/free?assetId=abk_book"]);
  assert.equal(result.requests.length, 0);
});

test("active plugin source contains no Sovereign Vault, SMS, PIN, or legacy token fallback", async () => {
  const [core, php, streaming] = await Promise.all([
    readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8"),
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
    readFile(new URL("includes/streaming.php", pluginRoot), "utf8"),
  ]);
  for (const source of [core, php]) {
    assert.doesNotMatch(source, /Sovereign Vault Gateway|Send Access Code|\/api\/auth\/sms-|koba_reader_token_|reader_access_key/i);
  }
  assert.doesNotMatch(streaming, /register_rest_route\(\s*'koba-ia\/v2'\s*,\s*'\/stream/i);
});
