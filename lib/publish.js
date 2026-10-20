"use strict";

// Publishes one logo per source file to BOTH image paths.
//
// Alliance ids and corporation ids never collide, so a single `logo/` folder can
// hold both kinds without asking the database which is which:
//
//   <id>_<size>.png  ->  <data root>/gameStore/images/Alliance/   (alliance store)
//   <id>_<size>.png  ->  <data root>/corporation-logo/            (image edge wrapper)
//
// The file that nothing requests simply sits there. The command layer, which can
// read the database safely, adds the friendly "this id is neither an alliance nor
// a corporation" warning.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readImageInfo } = require("./imageInfo");
const { renderSizes, SIZES } = require("./render");

const SOURCE_PATTERN = /^(\d+)\.(png|jpe?g)$/i;

function publishedRootFor(root) {
  const dataRoot = String(process.env.EVEJS_DATA_ROOT || "").trim();
  return path.join(dataRoot ? path.resolve(dataRoot) : path.join(root, "_local"), "corporation-logo");
}

function listSources(logoDir) {
  try {
    return fs.readdirSync(logoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SOURCE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function listWrongNames(logoDir) {
  try {
    return fs.readdirSync(logoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !SOURCE_PATTERN.test(entry.name)
        && /\.(png|jpe?g)$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    return [];
  }
}

function writeAtomic(filePath, bytes) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, filePath);
}

function publishedPath(publishedDir, entityID, size) {
  return path.join(publishedDir, `${entityID}_${size}.png`);
}

function findPublished(publishedDir, entityID, size) {
  const numericID = Number(entityID);
  if (!(numericID > 0)) return null;
  const order = size
    ? [Number(size), ...[...SIZES].sort((a, b) => b - a)]
    : [...SIZES].sort((a, b) => b - a);
  for (const candidate of order) {
    const filePath = publishedPath(publishedDir, numericID, candidate);
    try {
      if (fs.statSync(filePath).isFile()) return filePath;
    } catch (error) {
      // Try the next size.
    }
  }
  return null;
}

function publishAllianceSizes(store, entityID, rendered) {
  if (!store || typeof store.storeAllianceLogo !== "function") return false;
  for (const entry of rendered) {
    const result = store.storeAllianceLogo(entityID, entry.png, { sizes: [entry.size] });
    if (!result || result.success !== true) return false;
  }
  return true;
}

function publishCorporationSizes(publishedDir, entityID, rendered) {
  for (const entry of rendered) {
    writeAtomic(publishedPath(publishedDir, entityID, entry.size), entry.png);
  }
}

function scanAndApply(options = {}) {
  const logoDir = options.logoDir;
  const publishedDir = options.publishedDir;
  const allianceStore = options.allianceStore;
  const log = typeof options.log === "function" ? options.log : () => {};
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const applied = options.applied instanceof Map ? options.applied : new Map();
  const force = options.force === true;
  const sizes = Array.isArray(options.sizes) && options.sizes.length ? options.sizes : SIZES;

  const result = { applied: [], skipped: [], failed: [], scanned: 0 };
  if (!logoDir || !publishedDir) {
    logError("logo or published directory is missing - nothing was published");
    return result;
  }
  fs.mkdirSync(publishedDir, { recursive: true });

  for (const name of listWrongNames(logoDir)) {
    result.failed.push({ file: name, reason: "name must be <id>.png|jpg|jpeg" });
    logError(`${name}: name must be <id>.png|jpg|jpeg; skipped`);
  }

  const files = listSources(logoDir);
  result.scanned = files.length + result.failed.length;

  for (const name of files) {
    const entityID = Number(SOURCE_PATTERN.exec(name)[1]);
    if (!(entityID > 0)) {
      result.failed.push({ file: name, reason: "invalid id" });
      logError(`${name}: id is not a positive number`);
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

    let rendered;
    try {
      rendered = renderSizes(buffer, info, sizes);
    } catch (error) {
      result.failed.push({ file: name, reason: "decode failed" });
      logError(`${name}: could not be decoded: ${error && error.message}`);
      continue;
    }

    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (!force && applied.get(entityID) === digest) {
      result.skipped.push({ file: name, reason: "unchanged" });
      continue;
    }

    let alliancePublished = false;
    try {
      alliancePublished = publishAllianceSizes(allianceStore, entityID, rendered);
    } catch (error) {
      alliancePublished = false;
      logError(`${name}: alliance store failed for ${entityID}: ${error && error.message}`);
    }
    try {
      publishCorporationSizes(publishedDir, entityID, rendered);
    } catch (error) {
      result.failed.push({ file: name, reason: "write failed" });
      logError(`${name}: could not publish corporation ${entityID}: ${error && error.message}`);
      continue;
    }

    applied.set(entityID, digest);
    result.applied.push({
      file: name,
      entityID,
      width: info.width,
      height: info.height,
      sourceFormat: info.format,
      sizes: sizes.slice(),
      alliancePublished,
    });
    log(`id ${entityID}: ${name} (${info.format.toUpperCase()} ${info.width}x${info.height}) `
      + `published for sizes ${sizes.join("/")}`
      + `${alliancePublished ? "" : " (alliance store unavailable)"}`);
  }

  return result;
}

function deletePublished(publishedDir, entityID, sizes = SIZES) {
  let removed = 0;
  for (const size of sizes) {
    const filePath = publishedPath(publishedDir, entityID, size);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removed += 1;
      }
    } catch (error) {
      // Keep going; the remaining sizes still get their chance.
    }
  }
  return removed;
}

function removeAlliancePublished(store, entityID, sizes = SIZES) {
  let removed = 0;
  try {
    const paths = typeof store.listAllianceLogoPaths === "function"
      ? store.listAllianceLogoPaths(entityID)
      : [];
    for (const entry of paths) {
      if (!sizes.includes(entry.size)) continue;
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
        removed += 1;
      }
    }
  } catch (error) {
    // Reported by the caller when the count looks wrong.
  }
  return removed;
}

const STATE_FILE = ".autoLogo-state.json";

function loadState(publishedDir) {
  const filePath = path.join(publishedDir, STATE_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const published = new Map();
    if (parsed && parsed.published && typeof parsed.published === "object") {
      for (const [key, value] of Object.entries(parsed.published)) {
        const entityID = Number(key);
        if (Number.isFinite(entityID) && entityID > 0 && typeof value === "string") {
          published.set(entityID, value);
        }
      }
    }
    return { published };
  } catch (error) {
    return { published: new Map() };
  }
}

function saveState(publishedDir, published) {
  const filePath = path.join(publishedDir, STATE_FILE);
  try {
    fs.mkdirSync(publishedDir, { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
      version: 1,
      published: Object.fromEntries([...published.entries()].map(([id, hash]) => [String(id), hash])),
    }, null, 2));
    fs.renameSync(temporary, filePath);
  } catch (error) {
    // State is an optimisation for deleting removed sources; publishing still works.
  }
}

module.exports = {
  SOURCE_PATTERN,
  deletePublished,
  findPublished,
  listSources,
  listWrongNames,
  loadState,
  publishedPath,
  publishedRootFor,
  publishAllianceSizes,
  publishCorporationSizes,
  removeAlliancePublished,
  saveState,
  scanAndApply,
  writeAtomic,
};
