"use strict";

// autoAllianceLogo - loader entry point.
//
// Retail lets an alliance ask CCP for a custom image; this server publishes one
// from a file instead. Drop `<allianceID>.png`, `<allianceID>.jpg` or
// `<allianceID>.jpeg` into this mod's `logo/` folder and the next scan applies
// it: the vendor's `storeAllianceLogo` writes the six `<id>_<size>.png` files the
// image service serves, so no client patching and no database editing happens.
//
// The folder is meant to be bind-mounted (the installer adds the volume), which
// means a new or replaced image is picked up by the watcher within a second and
// by the periodic sweep at the latest. Nothing is renamed, no index is needed.
// Images may be up to 1280 x 1280; larger ones are scaled down to fit.

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const { scanAndApply, listLogoFiles } = require("./lib/apply");
const commands = require("./lib/commands");
function canonical(file) { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }

const MOD_VERSION = "1.0.0";
const KEY = Symbol.for("evejs.autoAllianceLogo.v1");
const SWEEP_INTERVAL_MS = 60 * 1000;
const WATCH_DEBOUNCE_MS = 1000;

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

// NOTE: the alliance list is deliberately NOT read here. This loader is a
// `--require` preload, so it runs before the gameStore has claimed its
// persistence role; touching gameStore at that point stalls startup. The mod
// needs no database access at all: an unknown alliance id simply writes logo
// files that nothing asks for, and the filename is the only interface.
// The alliance list is only read when a command asks for it: at that point the
// server has long finished loading gameStore, so requiring it is free. Reading it
// during the preload used to stall startup (gameStore claims its persistence role
// there), which is why it is not done in install().
function readAllianceIDs(root) {
  try {
    const database = require(path.join(root, "server", "src", "gameStore", "index.js"));
    const result = database.read("alliances", "/");
    const records = result && result.success !== false && result.data && result.data.records;
    if (!records || typeof records !== "object") return null;
    const ids = new Set();
    for (const record of Object.values(records)) {
      const id = Number(record && record.allianceID);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    return ids;
  } catch (error) {
    return null;
  }
}
function install(root = resolveRoot()) {
  if (!isMainThread) return null;
  if (globalThis[KEY]) return globalThis[KEY];
  if (!root) {
    console.error("[autoAllianceLogo] EveJS root not found; mod inactive");
    return null;
  }

  const logoDir = path.join(__dirname, "logo");
  let store;
  try {
    store = require(path.join(
      root, "server", "src", "services", "corporation", "allianceImageStore.js",
    ));
  } catch (error) {
    console.error(`[autoAllianceLogo] alliance image store is unavailable: ${error && error.message}`);
    return null;
  }

  const applied = new Map();
  const log = (message) => console.log(`[autoAllianceLogo] ${message}`);
  const logError = (message) => console.error(`[autoAllianceLogo] ${message}`);
  let cachedAllianceIDs = null;
  let lastProblems = [];

  const sweep = (force = false) => {
    try {
      const result = scanAndApply({
        logoDir, store, log, logError, applied, force, allianceIDs: cachedAllianceIDs,
      });
      if (result) lastProblems = result.failed;
      return result;
    } catch (error) {
      logError(`scan failed: ${error && error.message}`);
      return null;
    }
  };

  const problemsBlock = () => {
    if (lastProblems.length === 0) return "";
    const lines = lastProblems.slice(0, 12).map((problem) => (
      `  ${problem.file} - ${problem.reason}`
    ));
    if (lastProblems.length > lines.length) lines.push(`  ... and ${lastProblems.length - lines.length} more`);
    return `\nWARNING: ${lastProblems.length} file(s) in logo/ were ignored:\n${lines.join("\n")}`;
  };

  const deleteAlliance = (allianceID) => {
    const removed = { storeFiles: 0, sourceFiles: 0 };
    let paths = [];
    try {
      paths = store.listAllianceLogoPaths(allianceID);
    } catch (error) {
      logError(`could not list alliance ${allianceID} logos: ${error && error.message}`);
    }
    for (const entry of paths) {
      try {
        if (fs.existsSync(entry.filePath)) {
          fs.unlinkSync(entry.filePath);
          removed.storeFiles += 1;
        }
      } catch (error) {
        logError(`could not remove ${entry.filePath}: ${error && error.message}`);
      }
    }
    for (const name of listLogoFiles(logoDir)) {
      if (Number(name.slice(0, name.indexOf("."))) !== allianceID) continue;
      try {
        fs.unlinkSync(path.join(logoDir, name));
        removed.sourceFiles += 1;
      } catch (error) {
        logError(`could not remove ${name}: ${error && error.message}`);
      }
    }
    applied.delete(allianceID);
    log(`alliance ${allianceID}: deleted ${removed.storeFiles} published file(s), `
      + `${removed.sourceFiles} source image(s)`);
    return removed;
  };

  const isStaff = (session) => {
    try {
      const access = require(path.join(
        root, "server", "src", "services", "chat", "commands", "commandAccess.js",
      ));
      return typeof access.hasStaffDebugRole === "function"
        ? access.hasStaffDebugRole(session) === true
        : false;
    } catch (error) {
      return false;
    }
  };

  const runtimeApi = {
    isStaff,
    runCommand(command) {
      // Refreshing the alliance list here (not at preload) is what lets an
      // unknown alliance id be reported instead of silently published.
      const fresh = readAllianceIDs(root);
      if (fresh) cachedAllianceIDs = fresh;
      sweep();
      if (!command || command.action === "help") return commands.helpText() + problemsBlock();
      if (command.action === "error") {
        return `autoAllianceLogo: ${command.message}` + problemsBlock();
      }
      if (command.action === "flush") {
        const result = sweep(true) || { applied: [], failed: [], skipped: [] };
        return `autoAllianceLogo: republished ${result.applied.length} logo(s)`
          + `${result.failed.length ? `, ${result.failed.length} failed` : ""}. `
          + "The server files are current now; the image service caches a logo for up "
          + "to five minutes, so a client sees it on the next request after that (or "
          + "immediately after a relogin)."
          + problemsBlock();
      }
      if (command.action === "delete") {
        const removed = deleteAlliance(command.allianceID);
        sweep();
        return `autoAllianceLogo: alliance ${command.allianceID} - removed `
          + `${removed.storeFiles} published file(s) and ${removed.sourceFiles} source image(s). `
          + "The default logo is served from now on; a client may keep the old texture "
          + "for up to five minutes or until it relogins."
          + problemsBlock();
      }
      return commands.helpText() + problemsBlock();
    },
  };

  fs.mkdirSync(logoDir, { recursive: true });
  const initial = sweep();
  log(`v${MOD_VERSION} active - ${logoDir}`);

  // /alogo rides on the vendor's slash-command dispatcher, like the other mods.
  const previousLoad = Module._load;
  const chatCommandsPath = canonical(path.join(root, "server", "src", "services", "chat", "chatCommands.js"));
  Module._load = function autoAllianceLogoLoad(request, parent, isMain) {
    const exports = previousLoad.apply(this, arguments);
    // Resolve first: reading a property of a partial (circular) module throws
    // Node's "non-existent property" warning, so only the chat dispatcher is
    // inspected, and only after its file has finished loading.
    let loadedPath;
    try {
      loadedPath = canonical(Module._resolveFilename(request, parent, isMain));
    } catch (error) {
      return exports;
    }
    if (loadedPath !== chatCommandsPath || !exports || typeof exports.executeChatCommand !== "function") {
      return exports;
    }
    if (commands.installChat(exports, runtimeApi)) {
      log("/alogo command overlay installed (staff only)");
    }
    return exports;
  };

  // The image service caches a logo for five minutes; a fresh file is visible to
  // the client after that (or after a relogin).
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
    logoDir,
    applied,
    result: initial,
    deleteAlliance,
    runCommand: runtimeApi.runCommand,
    sweep,
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(sweepTimer);
    },
  };
  return globalThis[KEY];
}

module.exports = { KEY, MOD_VERSION, install, resolveRoot };

if (require.main !== module) install();
