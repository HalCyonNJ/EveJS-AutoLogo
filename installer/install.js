"use strict";

/**
 * autoAllianceLogo - installer.
 *
 * The mod is a loader: it needs one `--require` registration and a place for the
 * operator's images. Each deployment offers a different place for each:
 *
 *   Docker  docker/entrypoint.sh   --require /app/mods/autoAllianceLogo/loader.js
 *           compose.yaml           ./mods/autoAllianceLogo/logo -> /app/mods/.../logo
 *   Native  StartServer.bat        NODE_OPTIONS=%NODE_OPTIONS% --require=...
 *
 * Both registrations are idempotent, both are backed up before being written,
 * and `--server` may be pointed at either kind of checkout. The Docker path also
 * keeps `mods/` in the `.dockerignore` allowlist and adds the one bind mount that
 * makes a dropped image visible without rebuilding the image.
 *
 * Usage:
 *   node install.js --server "D:\eve\v261018.1"
 *   node install.js --server "D:\eve\v261018.1" --dry-run
 *   node install.js --server "D:\eve\v261018.1" --docker-only
 *   node install.js --server "D:\eve\v261018.1" --native-only
 *   node install.js --status --server "D:\eve\v261018.1"
 */

const fs = require("node:fs");
const path = require("node:path");

const MOD_NAME = "autoAllianceLogo";
const CONTAINER_MODS_ROOT = "/app/mods";
const PRELOAD = `--require ${CONTAINER_MODS_ROOT}/${MOD_NAME}/loader.js`;
const VOLUME_LINE = `      - ./mods/${MOD_NAME}/logo:/app/mods/${MOD_NAME}/logo`;
const PAYLOAD_SKIP = new Set(["installer", "test", "dist", "tools", ".git", "node_modules"]);
const PAYLOAD_SKIP_FILES = new Set(["ANNOUNCEMENT.md", "RunTests.bat"]);
const START_SERVER_ANCHOR = 'set "EVEJS_PROXY_LOCAL_INTERCEPT=1"';
const NATIVE_BEGIN = `rem --- ${MOD_NAME}: preload the alliance-logo loader ---`;
const NATIVE_END = `rem --- ${MOD_NAME}: end ${MOD_NAME} preload ---`;
const CHAT_COMMANDS_ANCHOR = "--require /app/mods/autopilotJumpZero/loader.js \\";
const REPORT_FLAG = "--report-on-fatalerror";

function out(line = "") {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  out("");
  out(`[FAIL] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    server: "",
    dockerOnly: false,
    nativeOnly: false,
    dryRun: false,
    force: false,
    status: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" && argv[index + 1]) options.server = argv[(index += 1)];
    else if (arg.startsWith("--server=")) options.server = arg.slice("--server=".length);
    else if (arg === "--docker-only") options.dockerOnly = true;
    else if (arg === "--native-only") options.nativeOnly = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--status") options.status = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text, "utf8");
}

function lineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function backupFile(serverRoot, backupRoot, relativePath) {
  const source = path.join(serverRoot, relativePath);
  if (!exists(source)) return;
  const target = path.join(backupRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyTree(source, target, skipDirs, skipFiles) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    if (entry.isFile() && skipFiles.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to, skipDirs, skipFiles);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function resolveRoots(options) {
  if (!options.server) fail("--server is required (point it at the EveJS checkout)");
  const serverRoot = path.resolve(options.server);
  if (!exists(path.join(serverRoot, "server", "package.json"))) {
    fail(`${serverRoot} does not look like an EveJS root`);
  }
  const docker = !options.nativeOnly && (
    options.dockerOnly || exists(path.join(serverRoot, "docker", "entrypoint.sh"))
  );
  const native = !options.dockerOnly && exists(path.join(serverRoot, "StartServer.bat"));
  return { serverRoot, docker, native };
}

function applyDockerignore(serverRoot, backupRoot, dryRun) {
  const filePath = path.join(serverRoot, ".dockerignore");
  if (!exists(filePath)) return "missing";
  const text = readText(filePath);
  const needed = [];
  if (!/^!mods\/$/m.test(text)) needed.push("!mods/");
  if (!/^!mods\/\*\*$/m.test(text)) needed.push("!mods/**");
  if (needed.length === 0) return "already";
  if (dryRun) return `plan:${needed.join(",")}`;
  backupFile(serverRoot, backupRoot, ".dockerignore");
  const eol = lineEnding(text);
  let next = text;
  const lastAllow = next.lastIndexOf("\n!");
  if (lastAllow >= 0) {
    const endOfLine = next.indexOf("\n", lastAllow + 1);
    const insertAt = endOfLine >= 0 ? endOfLine + 1 : next.length;
    next = `${next.slice(0, insertAt)}${needed.map((line) => `${line}${eol}`).join("")}${next.slice(insertAt)}`;
  } else {
    next = `${next.trimEnd()}${eol}${eol}${needed.join(eol)}${eol}`;
  }
  writeText(filePath, next);
  return `added:${needed.join(",")}`;
}

function applyEntrypoint(serverRoot, backupRoot, dryRun) {
  const filePath = path.join(serverRoot, "docker", "entrypoint.sh");
  if (!exists(filePath)) return "missing";
  const text = readText(filePath);
  if (text.includes(PRELOAD)) return "already";
  const eol = lineEnding(text);
  const apj = `    ${CHAT_COMMANDS_ANCHOR}`;
  let next;
  if (text.includes(`${apj}${eol}`)) {
    next = text.split(`${apj}${eol}`).join(`${apj}${eol}    ${PRELOAD} \\${eol}`);
  } else {
    // No APJ to anchor on: put the preload immediately before the server launch
    // flag, which exists in both launch blocks of the vendor entrypoint.
    const flagLine = `    ${REPORT_FLAG} \\${eol}`;
    if (!text.includes(flagLine)) return "anchor-missing";
    next = text.split(flagLine).join(`    ${PRELOAD} \\${eol}${flagLine}`);
  }
  if (dryRun) return "plan";
  backupFile(serverRoot, backupRoot, "docker/entrypoint.sh");
  writeText(filePath, next);
  return "added";
}

function applyComposeVolume(serverRoot, backupRoot, dryRun) {
  const filePath = path.join(serverRoot, "compose.yaml");
  if (!exists(filePath)) return "missing";
  const text = readText(filePath);
  const volumePath = `mods/${MOD_NAME}/logo:/app/mods/${MOD_NAME}/logo`;
  if (text.includes(volumePath) && !text.includes(`${volumePath}:ro`)) return "already";
  if (text.includes(`${volumePath}:ro`)) {
    if (dryRun) return "plan:rw";
    backupFile(serverRoot, backupRoot, "compose.yaml");
    writeText(filePath, text.split(`${volumePath}:ro`).join(volumePath));
    return "writable";
  }
  const anchor = /^([ \t]*- \.\/config:\/app\/config)(\r?\n)/m.exec(text);
  if (!anchor) return "anchor-missing";
  const indent = /^[ \t]*/.exec(anchor[1])[0];
  const eol = anchor[2] || "\n";
  const line = `${indent}- ${volumePath}`;
  if (dryRun) return "plan";
  backupFile(serverRoot, backupRoot, "compose.yaml");
  const insertAt = anchor.index + anchor[0].length;
  writeText(filePath, `${text.slice(0, insertAt)}${line}${eol}${text.slice(insertAt)}`);
  return "added";
}

function nativeBlock(modId) {
  const requirePath = `%EVEJS_REPO_ROOT:\\=/%/mods/${modId}/loader.js`;
  const existPath = `%EVEJS_REPO_ROOT%\\mods\\${modId}\\loader.js`;
  return [
    NATIVE_BEGIN,
    `if exist "${existPath}" set "NODE_OPTIONS=%NODE_OPTIONS% --require=${requirePath}"`,
    NATIVE_END,
  ].join("\r\n");
}

function applyStartServer(serverRoot, backupRoot, dryRun) {
  const filePath = path.join(serverRoot, "StartServer.bat");
  if (!exists(filePath)) return "missing";
  const text = readText(filePath);
  if (text.includes(NATIVE_BEGIN)) return "already";
  const eol = lineEnding(text);
  const anchor = `${START_SERVER_ANCHOR}${eol}`;
  if (!text.includes(anchor)) return "anchor-missing";
  const block = nativeBlock(MOD_NAME).replace(/\r\n/g, eol);
  if (dryRun) return "plan";
  backupFile(serverRoot, backupRoot, "StartServer.bat");
  writeText(filePath, text.replace(anchor, `${anchor}${block}${eol}`));
  return "added";
}

function status(serverRoot) {
  const entrypoint = path.join(serverRoot, "docker", "entrypoint.sh");
  const compose = path.join(serverRoot, "compose.yaml");
  const start = path.join(serverRoot, "StartServer.bat");
  const logoDir = path.join(serverRoot, "mods", MOD_NAME, "logo");
  const entrypointText = exists(entrypoint) ? readText(entrypoint) : "";
  const composeText = exists(compose) ? readText(compose) : "";
  const startText = exists(start) ? readText(start) : "";
  const logos = exists(logoDir)
    ? fs.readdirSync(logoDir).filter((name) => /^\d+\.(png|jpe?g)$/i.test(name))
    : [];
  out("");
  out(`autoAllianceLogo status - ${serverRoot}`);
  out(`  mods/${MOD_NAME}          ${exists(path.join(serverRoot, "mods", MOD_NAME)) ? "present" : "MISSING"}`);
  out(`  docker preload             ${(entrypointText.match(/autoAllianceLogo\/loader\.js/g) || []).length} line(s)`);
  out(`  compose logo volume        ${composeText.includes(`mods/${MOD_NAME}/logo:`) ? "present" : "missing"}`);
  out(`  native preload             ${startText.includes(NATIVE_BEGIN) ? "present" : "missing"}`);
  out(`  logo images                ${logos.length}${logos.length ? ` (${logos.sort().join(", ")})` : ""}`);
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    out("usage: node installer/install.js --server <EveJS root> [--docker-only|--native-only] [--dry-run] [--force] [--status]");
    return;
  }
  const { serverRoot, docker, native } = resolveRoots(options);
  if (options.status) {
    status(serverRoot);
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupRoot = path.join(serverRoot, `_${MOD_NAME.toLowerCase()}-backup`, stamp);
  const sourceRoot = path.resolve(__dirname, "..");

  out(`autoAllianceLogo installer - ${serverRoot}${options.dryRun ? " (dry run)" : ""}`);
  if (!options.dryRun) fs.mkdirSync(backupRoot, { recursive: true });

  if (docker || native) {
    const target = path.join(serverRoot, "mods", MOD_NAME);
    if (!options.dryRun) {
      // The logo folder holds the operator's images: keep it across reinstalls and
      // only replace the mod's own files.
      if (exists(target)) {
        for (const entry of fs.readdirSync(target)) {
          if (entry === "logo") continue;
          fs.rmSync(path.join(target, entry), { recursive: true, force: true });
        }
      }
      copyTree(sourceRoot, target, PAYLOAD_SKIP, PAYLOAD_SKIP_FILES);
      fs.mkdirSync(path.join(target, "logo"), { recursive: true });
    }
    out(`  [ OK ] mods/${MOD_NAME}: copied`);
  }

  if (docker) {
    out(`  [ OK ] .dockerignore: ${applyDockerignore(serverRoot, backupRoot, options.dryRun)}`);
    out(`  [ OK ] docker/entrypoint.sh: ${applyEntrypoint(serverRoot, backupRoot, options.dryRun)}`);
    out(`  [ OK ] compose.yaml: ${applyComposeVolume(serverRoot, backupRoot, options.dryRun)}`);
  }
  if (native) {
    out(`  [ OK ] StartServer.bat: ${applyStartServer(serverRoot, backupRoot, options.dryRun)}`);
  }
  if (!docker && !native) {
    fail("neither docker/entrypoint.sh nor StartServer.bat was found");
  }

  if (!options.dryRun) {
    out("");
    out(`  Backups    : ${backupRoot}`);
    if (docker) {
      out("  Next steps : docker compose build init");
      out("               docker compose up -d --no-deps server");
    }
    out(`  Logos      : drop <allianceID>.png|jpg|jpeg into ${path.join(serverRoot, "mods", MOD_NAME, "logo")}`);
    out("  Commands   : /alogo flush, /alogo delete <allianceID>, /alogo help (staff)");
    out("  Confirm a boot line: [autoAllianceLogo] v1.0.0 active");
  } else {
    out("");
    out("  (dry run: nothing was written)");
  }
}

module.exports = {
  MOD_NAME,
  NATIVE_BEGIN,
  NATIVE_END,
  PRELOAD,
  STATUS: status,
  VOLUME_LINE,
  applyComposeVolume,
  applyDockerignore,
  applyEntrypoint,
  applyStartServer,
  main,
  nativeBlock,
  parseArgs,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!process.exitCode) {
      out(`[FAIL] ${error && error.message}`);
      process.exitCode = 1;
    }
  }
}
