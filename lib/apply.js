"use strict";

// Scans the mod's `logo/` folder and publishes one alliance logo per file.
//
// Naming is the whole interface: `<allianceID>.png`, `<allianceID>.jpg` or
// `<allianceID>.jpeg`. Nothing is renamed and no index file is needed. The file
// is validated (real PNG/JPEG, positive size), scaled down when it exceeds the
// allowed edge, and handed to the vendor's own `storeAllianceLogo`, which writes
// the six `<allianceID>_<size>.png` files the image service serves.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readImageInfo } = require("./imageInfo");
const { toPng, MAX_EDGE } = require("./convert");

const FILE_PATTERN = /^(\d+)\.(png|jpe?g)$/i;

function listLogoFiles(logoDir) {
  try {
    return fs.readdirSync(logoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function scanAndApply(options = {}) {
  const logoDir = options.logoDir;
  const store = options.store;
  const log = typeof options.log === "function" ? options.log : () => {};
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const allianceIDs = options.allianceIDs instanceof Set ? options.allianceIDs : null;
  const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : MAX_EDGE;
  const applied = options.applied instanceof Map ? options.applied : new Map();
  const force = options.force === true;

  const result = { applied: [], skipped: [], failed: [], scanned: 0 };
  if (!logoDir || !store || typeof store.storeAllianceLogo !== "function") {
    logError("alliance logo store is unavailable - nothing was applied");
    return result;
  }

  let files;
  try {
    files = listLogoFiles(logoDir);
  } catch (error) {
    logError(`could not read ${logoDir}: ${error && error.message}`);
    return result;
  }
  result.scanned = files.length;

  // Image-looking files whose name is not <allianceID>.png|jpg|jpeg are almost
  // always a dropped image with a wrong name; report them instead of ignoring it.
  try {
    for (const entry of fs.readdirSync(logoDir, { withFileTypes: true })) {
      if (!entry.isFile() || FILE_PATTERN.test(entry.name)) continue;
      if (!/\.(png|jpe?g)$/i.test(entry.name)) continue;
      result.failed.push({ file: entry.name, reason: "name must be <allianceID>.png|jpg|jpeg" });
      logError(`${entry.name}: name must be <allianceID>.png|jpg|jpeg; skipped`);
    }
  } catch (error) {
    logError(`could not list ${logoDir}: ${error && error.message}`);
  }

  for (const name of files) {
    const match = FILE_PATTERN.exec(name);
    const allianceID = Number(match[1]);
    if (!(allianceID > 0)) {
      result.failed.push({ file: name, reason: "invalid alliance id" });
      logError(`${name}: alliance id is not a positive number`);
      continue;
    }
    if (allianceIDs && !allianceIDs.has(allianceID)) {
      result.failed.push({ file: name, reason: "unknown alliance" });
      logError(`${name}: alliance ${allianceID} does not exist; known alliances: `
        + [...allianceIDs].sort((a, b) => a - b).join(", "));
      continue;
    }

    let buffer;
    try {
      buffer = fs.readFileSync(path.join(logoDir, name));
    } catch (error) {
      result.failed.push({ file: name, reason: "unreadable" });
      logError(`${name}: could not be read: ${error && error.message}`);
      continue;
    }

    const info = readImageInfo(buffer);
    if (!info) {
      result.failed.push({ file: name, reason: "not a PNG or JPEG" });
      logError(`${name}: not a PNG or JPEG image; skipped`);
      continue;
    }

    let converted;
    try {
      converted = toPng(buffer, info, { maxEdge });
    } catch (error) {
      result.failed.push({ file: name, reason: "decode failed" });
      logError(`${name}: could not be decoded: ${error && error.message}`);
      continue;
    }

    const digest = crypto.createHash("sha256").update(converted.png).digest("hex");
    if (!force && applied.get(allianceID) === digest) {
      result.skipped.push({ file: name, reason: "unchanged" });
      continue;
    }

    let stored;
    try {
      stored = store.storeAllianceLogo(allianceID, converted.png);
    } catch (error) {
      stored = { success: false, errorMsg: error && error.message };
    }
    if (!stored || stored.success !== true) {
      result.failed.push({ file: name, reason: (stored && stored.errorMsg) || "store failed" });
      logError(`${name}: alliance ${allianceID} logo was not stored: `
        + `${(stored && stored.errorMsg) || "unknown error"}`);
      continue;
    }

    applied.set(allianceID, digest);
    result.applied.push({
      file: name,
      allianceID,
      width: converted.width,
      height: converted.height,
      resized: converted.resized,
      sourceFormat: info.format,
      byteLength: converted.png.length,
    });
    log(`alliance ${allianceID}: ${name} (${info.format.toUpperCase()} `
      + `${info.width}x${info.height}) published as PNG ${converted.width}x${converted.height}`
      + `${converted.resized ? " (scaled down)" : ""} for sizes `
      + `${(stored.data && stored.data.sizes || []).join("/")}`);
  }

  return result;
}

module.exports = { FILE_PATTERN, listLogoFiles, scanAndApply };
