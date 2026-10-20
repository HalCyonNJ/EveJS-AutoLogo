"use strict";

/**
 * autoLogo - uninstaller.
 *
 * Removes both possible preload registrations, the Docker bind mount and the
 * mod folder. The operator's images in `logo/` are kept unless
 * `--purge-logos` is given, so a reinstall does not lose them.
 *
 * Usage:
 *   node uninstall.js --server "D:\eve\v261018.1"
 *   node uninstall.js --server "D:\eve\v261018.1" --dry-run
 *   node uninstall.js --server "D:\eve\v261018.1" --purge-logos
 */

const fs = require("node:fs");
const path = require("node:path");

const MOD_NAME = "autoLogo";
const PRELOAD = `--require /app/mods/${MOD_NAME}/loader.js`;
const VOLUME_PATH = `mods/${MOD_NAME}/logo:/app/mods/${MOD_NAME}/logo`;
const NATIVE_BEGIN = `rem --- ${MOD_NAME}: preload the corporation-logo loader ---`;
const NATIVE_END = `rem --- ${MOD_NAME}: end ${MOD_NAME} preload ---`;

function out(line = "") {
  process.stdout.write(`${line}\n`);
}

function parseArgs(argv) {
  const options = { server: "", dryRun: false, purgeLogos: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" && argv[index + 1]) options.server = argv[(index += 1)];
    else if (arg.startsWith("--server=")) options.server = arg.slice("--server=".length);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--purge-logos") options.purgeLogos = true;
  }
  return options;
}

function removeBlock(text, begin, end) {
  const start = text.indexOf(begin);
  if (start < 0) return text;
  const finish = text.indexOf(end, start);
  if (finish < 0) return text;
  let after = finish + end.length;
  if (text[after] === "\r") after += 1;
  if (text[after] === "\n") after += 1;
  return text.slice(0, start) + text.slice(after);
}

function stripPreload(filePath, pattern, dryRun) {
  if (!fs.existsSync(filePath)) return "missing";
  const text = fs.readFileSync(filePath, "utf8");
  const next = text.replace(pattern, "");
  if (next === text) return "absent";
  if (!dryRun) fs.writeFileSync(filePath, next, "utf8");
  return "removed";
}

function main(argv) {
  const options = parseArgs(argv);
  if (!options.server) {
    out("[FAIL] --server is required");
    process.exitCode = 2;
    return;
  }
  const serverRoot = path.resolve(options.server);
  out(`autoLogo uninstaller - ${serverRoot}${options.dryRun ? " (dry run)" : ""}`);

  const entrypoint = path.join(serverRoot, "docker", "entrypoint.sh");
  out(`  docker/entrypoint.sh: ${stripPreload(entrypoint, new RegExp(`^[ \\t]*${PRELOAD.replace(/[/\\]/g, "\\$&")}[ \\t]*\\\\\\r?\\n`, "gm"), options.dryRun)}`);

  const start = path.join(serverRoot, "StartServer.bat");
  if (fs.existsSync(start)) {
    const text = fs.readFileSync(start, "utf8");
    const next = removeBlock(text, NATIVE_BEGIN, NATIVE_END);
    if (next === text) {
      out("  StartServer.bat: absent");
    } else {
      if (!options.dryRun) fs.writeFileSync(start, next, "utf8");
      out("  StartServer.bat: removed");
    }
  }

  const compose = path.join(serverRoot, "compose.yaml");
  if (fs.existsSync(compose)) {
    const text = fs.readFileSync(compose, "utf8");
    const pattern = new RegExp(`^[ \\t]*- \\./${VOLUME_PATH.replace(/[/\\]/g, "\\$&")}(:ro)?\\r?\\n`, "m");
    const next = text.replace(pattern, "");
    if (next === text) {
      out("  compose.yaml: absent");
    } else {
      if (!options.dryRun) fs.writeFileSync(compose, next, "utf8");
      out("  compose.yaml: volume removed");
    }
  }

  const target = path.join(serverRoot, "mods", MOD_NAME);
  if (!fs.existsSync(target)) {
    out("  mods: absent");
  } else if (options.dryRun) {
    out("  mods: would be removed");
  } else if (options.purgeLogos) {
    fs.rmSync(target, { recursive: true, force: true });
    out("  mods: removed (including logo images)");
  } else {
    for (const entry of fs.readdirSync(target)) {
      if (entry === "logo") continue;
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
    out("  mods: removed (logo images kept)");
  }

  if (!options.dryRun) {
    out("");
    out("  Rebuild the image after a Docker uninstall: docker compose build init && docker compose up -d --no-deps server");
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  out(`[FAIL] ${error && error.message}`);
  process.exitCode = 1;
}
