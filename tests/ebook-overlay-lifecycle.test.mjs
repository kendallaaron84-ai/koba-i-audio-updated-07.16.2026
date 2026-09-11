import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("authorized e-reader initialization dismisses the pending vault overlay", async () => {
  const plugin = await readFile(new URL("koba-i-audio.php", pluginRoot), "utf8");
  const requestStart = plugin.lastIndexOf("requestAuthorizedPublication()");
  const successStart = plugin.indexOf(".then(data => {", requestStart);
  const failureStart = plugin.indexOf(".catch(error => {", successStart);
  const successBranch = plugin.slice(successStart, failureStart);

  assert.ok(successStart >= 0 && failureStart > successStart);
  assert.match(
    successBranch,
    /renderPage\(\);[\s\S]*?window\.revealMediaCanvas\(\);/
  );
  assert.match(
    plugin,
    /window\.revealMediaCanvas = function\(\)[\s\S]*?vaultDoor\.style\.display = "none"[\s\S]*?playerWrapper\.style\.display = "block"/
  );
});

test("e-reader authorization failure reveals the existing safe error state", async () => {
  const plugin = await readFile(new URL("koba-i-audio.php", pluginRoot), "utf8");
  const failureStart = plugin.indexOf(".catch(error => {", plugin.indexOf("requestAuthorizedPublication()"));
  const failureEnd = plugin.indexOf("function saveReaderPreferences", failureStart);
  const failureBranch = plugin.slice(failureStart, failureEnd);

  assert.ok(failureStart >= 0 && failureEnd > failureStart);
  assert.match(failureBranch, /Unable to open this publication/);
  assert.match(failureBranch, /container\.replaceChildren\(failure\);/);
  assert.match(failureBranch, /window\.revealMediaCanvas\(\);/);
});
