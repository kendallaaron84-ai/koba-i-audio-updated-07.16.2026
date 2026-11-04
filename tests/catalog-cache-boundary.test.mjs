import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source=readFileSync(new URL("../koba-i-audio.php",import.meta.url),"utf8");
test("both successful and failed catalog proxy responses prohibit shared caching before lookup",()=>{
 const proxy=source.slice(source.indexOf("function koba_proxy_storefront_catalog($request) {"),source.indexOf("function koba_request_storefront_catalog("));
 assert.ok(proxy.indexOf("nocache_headers();")>0);
 assert.ok(proxy.indexOf("header('Cache-Control: private, no-store, max-age=0');")<proxy.indexOf("get_option('koba_storefront_site_token'"));
 assert.match(proxy,/koba_request_storefront_catalog\(\$url, \$token\)/);
 assert.match(proxy,/koba_refresh_storefront_site_identity\(\)/);
});
