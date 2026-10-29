"use strict";

// Run: node test/run.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PNG } = require("../vendor/pngjs");
const jpeg = require("../vendor/jpeg-js");
const { readImageInfo } = require("../lib/imageInfo");
const { renderSizes, toSquare } = require("../lib/render");
const { matchCorporationLogo } = require("../lib/match");
const {
  deletePublished,
  findPublished,
  loadState,
  publishedPath,
  removeAlliancePublished,
  saveState,
  scanAndApply,
} = require("../lib/publish");
const { MOD_VERSION, isGameServerProcess, resolveRoot } = require("../loader");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}\n     ${error && error.message}`);
  }
}

function makePng(width, height, color = [40, 80, 160, 255]) {
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    png.data[index * 4] = color[0];
    png.data[index * 4 + 1] = color[1];
    png.data[index * 4 + 2] = color[2];
    png.data[index * 4 + 3] = color[3];
  }
  return PNG.sync.write(png);
}

function makeJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4, 255);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 180;
    data[index * 4 + 1] = 30;
    data[index * 4 + 2] = 30;
    data[index * 4 + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 85).data;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeAllianceStore() {
  const calls = [];
  return {
    calls,
    storeAllianceLogo(entityID, bytes, options) {
      calls.push({ entityID, bytes: Buffer.from(bytes), sizes: options && options.sizes });
      return { success: true, data: { sizes: (options && options.sizes) || [] } };
    },
    listAllianceLogoPaths(entityID) {
      return [];
    },
  };
}

test("imageInfo: PNG and JPEG sizes", () => {
  assert.deepStrictEqual(readImageInfo(makePng(12, 30)), { format: "png", width: 12, height: 30 });
  assert.deepStrictEqual(readImageInfo(makeJpeg(20, 10)), { format: "jpeg", width: 20, height: 10 });
});

test("toSquare: aspect preserved and centred with transparent padding", () => {
  const rgba = Buffer.alloc(100 * 50 * 4, 255);
  const square = toSquare(rgba, 100, 50, 64);
  assert.strictEqual(square.length, 64 * 64 * 4);
  assert.strictEqual(square[3], 0);
  const middle = (32 * 64 + 32) * 4;
  assert.strictEqual(square[middle + 3], 255);
});

test("renderSizes: every size is a real square PNG", () => {
  const buffer = makePng(200, 100);
  const rendered = renderSizes(buffer, readImageInfo(buffer), [32, 64]);
  assert.strictEqual(rendered.length, 2);
  for (const entry of rendered) {
    assert.deepStrictEqual(readImageInfo(entry.png), { format: "png", width: entry.size, height: entry.size });
  }
});

test("matchCorporationLogo: legacy and REST forms, everything else null", () => {
  assert.deepStrictEqual(matchCorporationLogo("/Corporation/98000001_64.png"), { corporationID: 98000001, size: 64 });
  assert.deepStrictEqual(matchCorporationLogo("/Corporation/98000001.png"), { corporationID: 98000001, size: null });
  assert.deepStrictEqual(matchCorporationLogo("/corporations/98000001/logo?size=128&ext=png"), { corporationID: 98000001, size: 128 });
  assert.strictEqual(matchCorporationLogo("/Corporation/abc_64.png"), null);
  assert.strictEqual(matchCorporationLogo("/Alliance/98000001_64.png"), null);
});

test("scanAndApply: publishes to both the alliance store and the corporation folder", () => {
  const dir = tempDir("al-src-");
  const out = tempDir("al-out-");
  fs.writeFileSync(path.join(dir, "98000001.png"), makePng(100, 50));
  const store = fakeAllianceStore();
  const result = scanAndApply({
    logoDir: dir,
    publishedDir: out,
    allianceStore: store,
    log: () => {},
    logError: () => {},
    sizes: [32, 64],
  });
  assert.strictEqual(result.applied.length, 1);
  assert.strictEqual(result.applied[0].alliancePublished, true);
  assert.strictEqual(store.calls.length, 2);
  for (const size of [32, 64]) {
    const info = readImageInfo(fs.readFileSync(publishedPath(out, 98000001, size)));
    assert.deepStrictEqual(info, { format: "png", width: size, height: size });
  }
});

test("scanAndApply: a JPEG source is rendered as PNG", () => {
  const dir = tempDir("al-jpg-");
  const out = tempDir("al-jpg-out-");
  fs.writeFileSync(path.join(dir, "98000002.jpg"), makeJpeg(60, 30));
  const result = scanAndApply({ logoDir: dir, publishedDir: out, allianceStore: fakeAllianceStore(), sizes: [32] });
  assert.strictEqual(result.applied.length, 1);
  assert.strictEqual(readImageInfo(fs.readFileSync(publishedPath(out, 98000002, 32))).format, "png");
});

test("scanAndApply: wrong names are reported", () => {
  const dir = tempDir("al-bad-");
  const out = tempDir("al-bad-out-");
  fs.writeFileSync(path.join(dir, "my-logo.png"), makePng(8, 8));
  const errors = [];
  const result = scanAndApply({
    logoDir: dir,
    publishedDir: out,
    allianceStore: fakeAllianceStore(),
    log: () => {},
    logError: (line) => errors.push(line),
  });
  assert.strictEqual(result.failed.length, 1);
  assert.match(errors.join("\n"), /name must be <id>/u);
});

test("scanAndApply: unchanged source is skipped, force republishes", () => {
  const dir = tempDir("al-skip-");
  const out = tempDir("al-skip-out-");
  fs.writeFileSync(path.join(dir, "98000001.png"), makePng(40, 40));
  const applied = new Map();
  const base = {
    logoDir: dir,
    publishedDir: out,
    allianceStore: fakeAllianceStore(),
    applied,
    log: () => {},
    logError: () => {},
    sizes: [32],
  };
  scanAndApply(base);
  assert.strictEqual(scanAndApply(base).skipped.length, 1);
  assert.strictEqual(scanAndApply({ ...base, force: true }).applied.length, 1);
});

test("findPublished: exact size first, then the largest available", () => {
  const out = tempDir("al-find-");
  fs.writeFileSync(publishedPath(out, 42, 256), makePng(256, 256));
  assert.strictEqual(findPublished(out, 42, 256), publishedPath(out, 42, 256));
  assert.strictEqual(findPublished(out, 42, 32), publishedPath(out, 42, 256));
  assert.strictEqual(findPublished(out, 43, 64), null);
});

test("state round-trips and only tracks ids this mod published", () => {
  const out = tempDir("al-state-");
  const published = new Map([[98000001, "abc"], [99000001, "def"]]);
  saveState(out, published);
  const loaded = loadState(out);
  assert.deepStrictEqual([...loaded.published.entries()].sort(), [[98000001, "abc"], [99000001, "def"]]);
  assert.deepStrictEqual([...loadState(tempDir("al-empty-")).published.entries()], []);
});

test("removed source: both published sets are deleted", () => {
  const out = tempDir("al-remove-");
  fs.writeFileSync(publishedPath(out, 98000001, 32), makePng(32, 32));
  fs.writeFileSync(publishedPath(out, 98000001, 64), makePng(64, 64));
  assert.strictEqual(deletePublished(out, 98000001), 2);
  assert.strictEqual(findPublished(out, 98000001, 32), null);
  const store = {
    listAllianceLogoPaths: (id) => [
      { size: 32, filePath: path.join(out, `${id}_32.png`) },
      { size: 64, filePath: path.join(out, `${id}_64.png`) },
    ],
  };
  fs.writeFileSync(path.join(out, "5_32.png"), "x");
  fs.writeFileSync(path.join(out, "5_64.png"), "x");
  assert.strictEqual(removeAlliancePublished(store, 5), 2);
});

test("resolver wrapper: published corporation file wins, others fall through", () => {
  const root = tempDir("al-root-");
  const published = tempDir("al-pub-");
  fs.mkdirSync(path.join(root, "server", "src", "_secondary", "image"), { recursive: true });
  fs.writeFileSync(path.join(root, "server", "package.json"), "{}");
  fs.writeFileSync(path.join(root, "server", "src", "_secondary", "image", "imageRequestResolver.js"),
    "module.exports = { resolveImageRequest: (u) => ({ filePath: 'vendor:' + u, contentType: 'image/png' }) };");
  fs.writeFileSync(publishedPath(published, 42, 64), makePng(64, 64));
  const { installResolver } = require("../lib/resolver");
  installResolver.installed = false;
  assert.strictEqual(installResolver({ root, publishedDir: published, log: () => {} }), true);
  const resolver = require(path.join(root, "server", "src", "_secondary", "image", "imageRequestResolver.js"));
  assert.strictEqual(resolver.resolveImageRequest("/Corporation/42_64.png").filePath, publishedPath(published, 42, 64));
  assert.strictEqual(resolver.resolveImageRequest("/Corporation/99_64.png").filePath, "vendor:/Corporation/99_64.png");
  assert.match(resolver.resolveImageRequest("/Alliance/42_64.png").filePath, /^vendor:/u);
});

test("loader: version, root detection and process role", () => {
  assert.strictEqual(MOD_VERSION, "1.1.1");
  assert.strictEqual(resolveRoot(tempDir("al-root2-")), null);
  assert.strictEqual(isGameServerProcess("/nonexistent"), false);
});

console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\nFAILED: ${failure.name}`);
    console.error(failure.error && failure.error.stack || failure.error);
  }
  process.exitCode = 1;
}
