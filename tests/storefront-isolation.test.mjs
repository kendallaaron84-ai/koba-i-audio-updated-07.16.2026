import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the catalog browser no longer authorizes with a public StudioKey", async () => {
  const core = await readFile(new URL("assets/jubilee-core.js", root), "utf8");
  const catalogFunction = core.slice(core.indexOf("async function renderAuthorLibrary"), core.indexOf("function renderCatalogError"));
  assert.doesNotMatch(catalogFunction, /X-Studio-Key/);
  assert.doesNotMatch(catalogFunction, /searchParams\.set\("author"/);
  assert.match(catalogFunction, /searchParams\.set\("scope"/);
});

test("WordPress stores the signed site credential and proxies catalog requests server-side", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  assert.match(php, /koba_storefront_site_token/);
  assert.match(php, /register_rest_route\('kobai\/v1', '\/storefront-catalog'/);
  assert.match(php, /'Authorization' => 'Bearer ' \. \$token/);
  assert.match(php, /rest_url\('kobai\/v1\/storefront-catalog'\)/);
});

test("shortcode global scope remains a request hint and defaults fail-closed to tenant", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  assert.match(php, /'scope'\s*=>\s*'tenant'/);
  assert.match(php, /\$args\['scope'\] === 'global' \? 'global' : 'tenant'/);
  assert.doesNotMatch(php, /KOBA-AUDIO-E63DC9CA/);
});

test("the proxy forwards only allowlisted catalog filters", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  assert.match(php, /in_array\(\$scope, array\('tenant', 'global'\), true\)/);
  assert.match(php, /in_array\(\$type, array\('audiobook', 'ebook', 'publication'\), true\)/);
  assert.doesNotMatch(php, /\$request->get_param\('studioKey'\)/);
});

test("an invalid stored storefront identity refreshes once and retries once", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  const proxy = php.slice(
    php.indexOf("function koba_proxy_storefront_catalog"),
    php.indexOf("function koba_request_storefront_catalog")
  );

  assert.match(proxy, /wp_remote_retrieve_response_code\(\$response\) === 401/);
  assert.match(proxy, /\(\$payload\['code'\] \?\? ''\) === 'STOREFRONT_SITE_IDENTITY_INVALID'/);
  assert.match(proxy, /!\$identity_refreshed/);
  assert.equal((proxy.match(/koba_refresh_storefront_site_identity\(\)/g) || []).length, 2);
  assert.equal((proxy.match(/koba_request_storefront_catalog\(\$url,/g) || []).length, 2);
  assert.match(proxy, /return koba_storefront_identity_refresh_error\(\);/);
});

test("the refreshed site token remains server-side and StudioKey is never catalog authorization", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  const requestHelper = php.slice(
    php.indexOf("function koba_request_storefront_catalog"),
    php.indexOf("function koba_refresh_storefront_site_identity")
  );
  const refreshHelper = php.slice(
    php.indexOf("function koba_refresh_storefront_site_identity"),
    php.indexOf("function koba_storefront_identity_refresh_error")
  );

  assert.match(requestHelper, /'Authorization' => 'Bearer ' \. \$token/);
  assert.doesNotMatch(requestHelper, /studio_key|X-Studio-Key/);
  assert.match(refreshHelper, /update_option\('koba_storefront_site_token', \$token\)/);
});

test("identity refresh uses the site's verified origin binding", async () => {
  const php = await readFile(new URL("koba-i-audio.php", root), "utf8");
  const verifier = php.slice(
    php.indexOf("function koba_request_storefront_site_identity"),
    php.indexOf("// 3. REGISTER POST TYPE")
  );

  assert.match(verifier, /get_option\('koba_license_associated_website', home_url\('\/'\)\)/);
  assert.match(verifier, /wp_json_encode\(array\('domain' => \$verified_site_origin\)\)/);
});
