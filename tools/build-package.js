"use strict";

// Builds the ZIP that is handed out on Discord, and nothing else.
//
// The repository IS the mod folder, so the published artifact is GitHub's own
// per-tag "Source code (zip)" and there is nothing to keep in sync. Some players
// would rather take a file from Discord than follow a link, so every release
// also gets one archive here: dist/<modId>-<version>.zip,
// produced with git archive of the release ref and prefixed with the folder
// name - i.e. the same content the GitHub download hands out.
//
// This tool is **local to the machine that builds the ZIP**: it is excluded from
// git (see .git/info/exclude) and never ships in the installed payload (tools/ is
// in DEV_ONLY_DIRECTORIES). Both mod trees carry the same copy.
//
// dist/ is git-ignored: the ZIP stays on the machine that builds it and is
// pasted into Discord. It is never pushed and never attached to a Release.
//
// Usage:  node tools/build-package.js [--dry-run] [ref]
//         ref defaults to v<MOD_VERSION> from loader.js. The working tree has
//         to be clean, so the ZIP cannot disagree with the tag it names.
//         --dry-run  checks everything a real run checks and then prints what it
//         would write - the target path, the file count and the byte total -
//         without creating, truncating or deleting anything.
//
// The archive is written to a temporary file beside the target and moved onto
// the target only after git has produced it, so a failed run always leaves the
// previous ZIP exactly as it was.

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.resolve(__dirname, "..");
// Derived, not hardcoded: the same script sits in more than one mod folder.
const MOD_ID = path.basename(MOD_ROOT);
const DIST_DIR = path.join(MOD_ROOT, "dist");

const USAGE = [
  "usage: node tools/build-package.js [--dry-run] [ref]",
  "       ref defaults to v<MOD_VERSION> from loader.js",
  "       --dry-run  print the target, the file count and the byte total; write nothing",
].join("\n");

function fail(message) {
  console.error("[build-package] " + message);
  process.exitCode = 1;
}

function git(args) {
  return execFileSync("git", args, { cwd: MOD_ROOT, encoding: "utf8" }).trim();
}

// argv is read before anything touches the filesystem, so an unknown option or a
// second ref is refused while the previous ZIP is still untouched.
function parseArgs(argv) {
  const options = { dryRun: false, help: false, ref: null };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return { error: "unknown option '" + arg + "'" };
    }
    if (options.ref !== null) {
      return { error: "at most one ref may be given ('" + options.ref + "' and '" + arg + "')" };
    }
    options.ref = arg;
  }
  return options;
}

function readVersion() {
  const text = fs.readFileSync(path.join(MOD_ROOT, "loader.js"), "utf8");
  const match = /const MOD_VERSION = "([^"]+)"/u.exec(text);
  if (!match) {
    throw new Error("loader.js does not declare MOD_VERSION");
  }
  return match[1];
}

function tagExists(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", "refs/tags/" + ref]);
    return true;
  } catch (_error) {
    return false;
  }
}

// One git call for the whole plan. Each line is
// "<mode> <type> <object> <size>\t<path>"; only blobs are packaged.
function listFiles(ref) {
  return execFileSync("git", ["ls-tree", "-r", "-l", ref], { cwd: MOD_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const tabAt = line.indexOf("\t");
      const meta = line.slice(0, tabAt).split(/\s+/u);
      return { type: meta[1], size: Number.parseInt(meta[3], 10) || 0, file: line.slice(tabAt + 1) };
    })
    .filter((entry) => entry.type === "blob");
}

function relativeToRoot(absolute) {
  return path.relative(MOD_ROOT, absolute).split(path.sep).join("/");
}

function removeStaging(staging) {
  try {
    fs.rmSync(staging, { force: true });
  } catch (_error) {
    // A leftover staging path that cannot be removed must not mask the real
    // failure, and it is never the target.
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    fail(options.error);
    console.error(USAGE);
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  let version;
  try {
    version = readVersion();
  } catch (error) {
    fail(error.message);
    return;
  }
  const ref = options.ref || "v" + version;

  if (ref.startsWith("v") && !tagExists(ref)) {
    fail(ref + " is not a tag in this repository");
    return;
  }
  let commit;
  try {
    commit = git(["rev-parse", ref]);
  } catch (_error) {
    fail("cannot resolve " + ref + " to a commit");
    return;
  }
  if (git(["status", "--porcelain"])) {
    fail("the working tree has uncommitted changes - commit them first, so the ZIP matches the tag it names");
    return;
  }

  const files = listFiles(ref);
  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
  const target = path.join(DIST_DIR, MOD_ID + "-" + version + ".zip");
  const relativeTarget = relativeToRoot(target);

  console.log("[build-package] mod " + MOD_ID + " version " + version);
  console.log("[build-package] ref " + ref + " = " + commit);
  console.log("[build-package] " + files.length + " files, " + totalBytes + " bytes before compression");
  for (const entry of files) {
    console.log("[build-package]   " + MOD_ID + "/" + entry.file);
  }

  if (options.dryRun) {
    console.log("[build-package] dry run: would write " + relativeTarget + " (nothing was written)");
    return;
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const staging = target + ".part-" + process.pid;
  removeStaging(staging);
  try {
    execFileSync(
      "git",
      ["archive", "--format=zip", "--prefix=" + MOD_ID + "/", "-o", relativeToRoot(staging), ref],
      { cwd: MOD_ROOT, stdio: "inherit" },
    );
    const bytes = fs.readFileSync(staging);
    if (bytes.length === 0) {
      fail("git archive produced an empty archive; the previous ZIP was left in place");
      return;
    }
    // The target is touched here and nowhere else, and only once the archive
    // exists: a failure above cannot have truncated or deleted it.
    fs.renameSync(staging, target);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    console.log("[build-package] " + relativeTarget);
    console.log("[build-package] " + bytes.length + " bytes, " + files.length + " files, sha256 " + sha256);
  } catch (error) {
    fail("packaging failed (" + (error && error.message ? error.message : String(error)) + ") - the previous ZIP was left in place");
  } finally {
    removeStaging(staging);
  }
}

main();
