"use strict";

// Run: node test/run.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PNG } = require("../vendor/pngjs");
const jpeg = require("../vendor/jpeg-js");
const { readImageInfo } = require("../lib/imageInfo");
const { toPng } = require("../lib/convert");
const { scanAndApply, listLogoFiles } = require("../lib/apply");
const { resolveRoot, MOD_VERSION } = require("../loader");

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

function makePng(width, height, color = [30, 60, 90, 255]) {
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
    data[index * 4] = 200;
    data[index * 4 + 1] = 10;
    data[index * 4 + 2] = 10;
    data[index * 4 + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 85).data;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("readImageInfo: PNG dimensions", () => {
  const info = readImageInfo(makePng(10, 20));
  assert.deepStrictEqual(info, { format: "png", width: 10, height: 20 });
});

test("readImageInfo: JPEG dimensions", () => {
  const info = readImageInfo(makeJpeg(24, 16));
  assert.deepStrictEqual(info, { format: "jpeg", width: 24, height: 16 });
});

test("readImageInfo: rejects non-images", () => {
  assert.strictEqual(readImageInfo(Buffer.from("not an image")), null);
  assert.strictEqual(readImageInfo(Buffer.alloc(0)), null);
});

test("toPng: small PNG is published byte for byte", () => {
  const source = makePng(64, 32);
  const result = toPng(source, { format: "png", width: 64, height: 32 });
  assert.strictEqual(result.resized, false);
  assert.strictEqual(result.png.equals(source), true);
  assert.strictEqual(result.width, 64);
  assert.strictEqual(result.height, 32);
});

test("toPng: JPEG becomes a PNG with the same dimensions", () => {
  const source = makeJpeg(40, 24);
  const result = toPng(source, { format: "jpeg", width: 40, height: 24 });
  assert.strictEqual(result.png[0], 0x89);
  assert.strictEqual(result.png.toString("ascii", 1, 4), "PNG");
  assert.strictEqual(result.width, 40);
  assert.strictEqual(result.height, 24);
});

test("toPng: an oversized PNG is scaled to the 1280 edge", () => {
  const source = makePng(2000, 1000);
  const result = toPng(source, { format: "png", width: 2000, height: 1000 });
  assert.strictEqual(result.resized, true);
  assert.strictEqual(result.width, 1280);
  assert.strictEqual(result.height, 640);
  assert.strictEqual(readImageInfo(result.png).width, 1280);
});

test("toPng: an oversized JPEG is scaled too", () => {
  const result = toPng(makeJpeg(1600, 1600), { format: "jpeg", width: 1600, height: 1600 });
  assert.strictEqual(result.width, 1280);
  assert.strictEqual(result.height, 1280);
});

test("listLogoFiles: only <id>.png|jpg|jpeg", () => {
  const dir = tempDir("aal-list-");
  fs.writeFileSync(path.join(dir, "99000001.png"), "x");
  fs.writeFileSync(path.join(dir, "99000002.JPG"), "x");
  fs.writeFileSync(path.join(dir, "99000003.jpeg"), "x");
  fs.writeFileSync(path.join(dir, "README.txt"), "x");
  fs.writeFileSync(path.join(dir, "logo.gif"), "x");
  assert.deepStrictEqual(listLogoFiles(dir), ["99000001.png", "99000002.JPG", "99000003.jpeg"]);
});

test("scanAndApply: publishes each valid file through the store", () => {
  const dir = tempDir("aal-apply-");
  const source = makePng(100, 50);
  fs.writeFileSync(path.join(dir, "99000001.png"), source);
  fs.writeFileSync(path.join(dir, "99000001.jpg"), makeJpeg(30, 20));
  const calls = [];
  const store = {
    storeAllianceLogo(allianceID, bytes) {
      calls.push({ allianceID, bytes });
      return { success: true, data: { allianceID, sizes: [32, 64, 128, 256, 512, 1024] } };
    },
  };
  const logs = [];
  const result = scanAndApply({
    logoDir: dir,
    store,
    allianceIDs: new Set([99000001, 99000002]),
    applied: new Map(),
    log: (line) => logs.push(line),
    logError: (line) => logs.push(`ERR ${line}`),
  });
  // Both files target the same alliance, and the PNG sorts after the JPEG.
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls.map((call) => call.allianceID), [99000001, 99000001]);
  assert.strictEqual(calls[0].bytes[0], 0x89);
  assert.strictEqual(calls[1].bytes.equals(source), true);
  assert.strictEqual(result.applied.length, 2);
  assert.strictEqual(result.failed.length, 0);
});

test("scanAndApply: unknown alliance, bad file name and junk are refused", () => {
  const dir = tempDir("aal-unknown-");
  fs.writeFileSync(path.join(dir, "99000009.png"), makePng(8, 8));
  fs.writeFileSync(path.join(dir, "99000001.png"), Buffer.from("not an image"));
  fs.writeFileSync(path.join(dir, "notes.png"), makePng(8, 8));
  const calls = [];
  const errors = [];
  const result = scanAndApply({
    logoDir: dir,
    store: { storeAllianceLogo: (id, bytes) => { calls.push(id); return { success: true, data: { sizes: [] } }; } },
    allianceIDs: new Set([99000001]),
    applied: new Map(),
    log: () => {},
    logError: (line) => errors.push(line),
  });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.failed.length, 3);
  assert.match(errors.join("\n"), /alliance 99000009 does not exist/u);
  assert.match(errors.join("\n"), /notes\.png: name must be/u);
  assert.match(errors.join("\n"), /not a PNG or JPEG/u);
});

test("scanAndApply: an unchanged file is skipped on the next scan", () => {
  const dir = tempDir("aal-unchanged-");
  fs.writeFileSync(path.join(dir, "99000001.png"), makePng(16, 16));
  const applied = new Map();
  let calls = 0;
  const store = { storeAllianceLogo: () => { calls += 1; return { success: true, data: { sizes: [] } }; } };
  scanAndApply({ logoDir: dir, store, applied, log: () => {}, logError: () => {} });
  const second = scanAndApply({ logoDir: dir, store, applied, log: () => {}, logError: () => {} });
  assert.strictEqual(calls, 1);
  assert.strictEqual(second.skipped.length, 1);
});

test("loader: resolves the EveJS root and reports a version", () => {
  assert.strictEqual(MOD_VERSION, "1.0.0");
  assert.strictEqual(resolveRoot(tempDir("aal-root-")), null);
});

test("commands.parse: /alogo subcommands", () => {
  const { parse } = require("../lib/commands");
  assert.deepStrictEqual(parse("/alogo flush"), { action: "flush" });
  assert.deepStrictEqual(parse("/alogo delete 99000001"), { action: "delete", allianceID: 99000001 });
  assert.deepStrictEqual(parse("/alogo help"), { action: "help" });
  assert.deepStrictEqual(parse("/alogo"), { action: "help" });
  assert.strictEqual(parse("/alogo delete").message, "usage: /alogo delete <allianceID>");
  assert.strictEqual(parse("/alogo nope").action, "error");
  assert.strictEqual(parse("/alogo delete 1 2").action, "error");
  assert.strictEqual(parse("/ash status"), null);
  assert.strictEqual(parse("hello"), null);
});

test("commands.installChat: passes non-alogo lines through", () => {
  const { installChat } = require("../lib/commands");
  const calls = [];
  const exports = { executeChatCommand: (session, message) => { calls.push(message); return { handled: false }; } };
  installChat(exports, { isStaff: () => true, runCommand: () => "ok" });
  exports.executeChatCommand({}, "/ash status here");
  assert.deepStrictEqual(calls, ["/ash status here"]);
});

test("commands.installChat: staff-only /alogo", () => {
  const { installChat } = require("../lib/commands");
  const exports = { executeChatCommand: () => ({ handled: false }) };
  installChat(exports, { isStaff: () => false, runCommand: () => "should not run" });
  const refused = exports.executeChatCommand({}, "/alogo flush");
  assert.match(refused.message, /staff command/u);
  const staffExports = { executeChatCommand: () => ({ handled: false }) };
  installChat(staffExports, { isStaff: () => true, runCommand: () => "flushed" });
  assert.strictEqual(staffExports.executeChatCommand({}, "/alogo flush").message, "flushed");
});
test("scanAndApply: a wrongly named image is reported, not ignored", () => {
  const dir = tempDir("aal-badname-");
  fs.writeFileSync(path.join(dir, "my-logo.png"), makePng(8, 8));
  fs.writeFileSync(path.join(dir, "logo.gif"), makePng(8, 8));
  const errors = [];
  const result = scanAndApply({
    logoDir: dir,
    store: { storeAllianceLogo: () => ({ success: true, data: { sizes: [] } }) },
    applied: new Map(),
    log: () => {},
    logError: (line) => errors.push(line),
  });
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].file, "my-logo.png");
  assert.match(result.failed[0].reason, /name must be/u);
  assert.match(errors.join("\n"), /my-logo\.png/u);
});
console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\nFAILED: ${failure.name}`);
    console.error(failure.error && failure.error.stack || failure.error);
  }
  process.exitCode = 1;
}
