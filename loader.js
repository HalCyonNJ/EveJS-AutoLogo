"use strict";

// autoLogo - one loader for alliance and corporation logos. No commands.
//
// The folder is the whole interface:
//
//   mods/autoLogo/logo/<id>.png|jpg|jpeg   -> published to both image paths
//   delete or rename the file              -> both published copies are removed
//
// Alliance ids and corporation ids never collide, so one folder serves both. A
// source is rendered into the six square sizes once and written to
// `gameStore/images/Alliance/` (through the vendor store) and to
// `corporation-logo/` (served by wrapping the image edge resolver in memory).
//
// The image edge is forked from the game server and inherits this preload, so it
// installs the resolver wrapper there. Only the game server process scans.
// Nothing here writes to the gameStore and no EveJS source file is edited.

const fs = require("node:fs");
const path = require("node:path");
const { isMainThread } = require("node:worker_threads");
const {
  deletePublished,
  findPublished,
  listSources,
  loadState,
  publishedRootFor,
  removeAlliancePublished,
  saveState,
  scanAndApply,
} = require("./lib/publish");
const { installResolver } = require("./lib/resolver");

const MOD_VERSION = "1.1.0";
const KEY = Symbol.for("evejs.autoLogo.v1");
const SWEEP_INTERVAL_MS = 60 * 1000;
const WATCH_DEBOUNCE_MS = 1000;

function canonical(file) {
  return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
}

function resolveRoot(start = __dirname) {
  let directory = path.resolve(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(directory, "server", "package.json"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

function isGameServerProcess(root) {
  const entry = process.argv[1] ? canonical(process.argv[1]) : "";
  return entry === canonical(path.join(root, "server"))
    || entry === canonical(path.join(root, "server", "index.js"));
}

function install(root = resolveRoot()) {
  if (!isMainThread) return null;
  if (globalThis[KEY]) return globalThis[KEY];
  if (!root) {
    console.error("[autoLogo] EveJS root not found; mod inactive");
    return null;
  }

  const logoDir = path.join(__dirname, "logo");
  const publishedDir = publishedRootFor(root);
  const log = (message) => console.log(`[autoLogo] ${message}`);
  const logError = (message) => console.error(`[autoLogo] ${message}`);

  let allianceStore = null;
  try {
    allianceStore = require(path.join(
      root, "server", "src", "services", "corporation", "allianceImageStore.js",
    ));
  } catch (error) {
    logError(`alliance image store is unavailable: ${error && error.message}`);
  }

  installResolver({ root, publishedDir, log });

  if (!isGameServerProcess(root)) {
    globalThis[KEY] = { active: true, version: MOD_VERSION, role: "resolver-only", publishedDir };
    return globalThis[KEY];
  }

  // id -> sha256 of the source that produced its published files. This is what
  // makes "delete the image" also remove the published copies after a restart:
  // only ids this mod published are ever touched.
  const state = loadState(publishedDir);
  const applied = state.published;
  let lastProblems = [];

  const sweep = (force = false) => {
    try {
      const result = scanAndApply({
        logoDir,
        publishedDir,
        allianceStore,
        log,
        logError,
        applied,
        force,
      });
      if (result) lastProblems = result.failed;
      // Sources that disappeared: remove their published files from both sides.
      const present = new Set(listSources(logoDir).map((name) => Number(name.slice(0, name.indexOf(".")))));
      for (const entityID of [...applied.keys()]) {
        if (present.has(entityID)) continue;
        const allianceRemoved = removeAlliancePublished(allianceStore, entityID);
        const corporationRemoved = deletePublished(publishedDir, entityID);
        applied.delete(entityID);
        log(`id ${entityID}: source removed, deleted ${allianceRemoved + corporationRemoved} `
          + `published file(s)`);
      }
      saveState(publishedDir, applied);
      return result;
    } catch (error) {
      logError(`scan failed: ${error && error.message}`);
      return null;
    }
  };

  fs.mkdirSync(logoDir, { recursive: true });
  fs.mkdirSync(publishedDir, { recursive: true });
  const initial = sweep();
  log(`v${MOD_VERSION} active - ${logoDir} -> ${publishedDir}`);
  log(`sources: ${listSources(logoDir).length}; published ids: ${applied.size}`);
  if (lastProblems.length > 0) {
    logError(`${lastProblems.length} file(s) were ignored: `
      + lastProblems.map((problem) => `${problem.file} (${problem.reason})`).join(", "));
  }

  let timer = null;
  try {
    fs.watch(logoDir, { persistent: false }, (event, filename) => {
      const name = filename ? String(filename) : "";
      if (name && !/^\d+\.(png|jpe?g)$/i.test(name)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        sweep();
      }, WATCH_DEBOUNCE_MS);
    });
  } catch (error) {
    logError(`folder watch unavailable, relying on the periodic sweep: ${error && error.message}`);
  }
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (sweepTimer && typeof sweepTimer.unref === "function") sweepTimer.unref();

  globalThis[KEY] = {
    active: true,
    version: MOD_VERSION,
    role: "server",
    logoDir,
    publishedDir,
    applied,
    result: initial,
    sweep,
    findPublished,
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(sweepTimer);
    },
  };
  return globalThis[KEY];
}

module.exports = {
  KEY,
  MOD_VERSION,
  install,
  isGameServerProcess,
  resolveRoot,
};

if (require.main !== module) install();
