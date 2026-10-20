"use strict";

// /alogo - staff commands for the alliance logo store.
//
//   /alogo flush              rescan logo/ and republish everything right now
//   /alogo delete <allianceID> remove the published logo (and its source file)
//   /alogo help
//
// The overlay sits on the vendor's executeChatCommand, exactly like the other
// loader mods: a line that is not /alogo is passed through untouched.

const COMMAND_NAME = "alogo";

function parse(message) {
  const text = String(message == null ? "" : message).trim();
  const withoutSlash = text.replace(/^\/+/, "");
  const parts = withoutSlash.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() !== COMMAND_NAME) return null;
  const subcommand = (parts[1] || "help").toLowerCase();
  if (subcommand === "flush") {
    if (parts.length > 2) return { action: "error", message: "usage: /alogo flush" };
    return { action: "flush" };
  }
  if (subcommand === "delete" || subcommand === "del") {
    const allianceID = Number(parts[2]);
    if (!(Number.isInteger(allianceID) && allianceID > 0)) {
      return { action: "error", message: "usage: /alogo delete <allianceID>" };
    }
    if (parts.length > 3) return { action: "error", message: "usage: /alogo delete <allianceID>" };
    return { action: "delete", allianceID };
  }
  if (subcommand === "help") return { action: "help" };
  return { action: "error", message: `unknown /alogo subcommand "${parts[1]}"; use flush, delete <allianceID> or help` };
}

function helpText() {
  return [
    "autoAllianceLogo - /alogo",
    "  /alogo flush                 rescan the logo folder and republish every logo now",
    "  /alogo delete <allianceID>   remove the published logo and its source image",
    "  /alogo help                  this text",
    "  Images go in mods/autoAllianceLogo/logo as <allianceID>.png|jpg|jpeg (max 1280x1280).",
  ].join("\n");
}

function installChat(exports, runtime) {
  if (!exports || typeof exports.executeChatCommand !== "function") return false;
  if (exports.executeChatCommand.__autoAllianceLogo === true) return true;
  const original = exports.executeChatCommand;
  const overlay = function executeChatCommandWithAlogo(session, message, hub, options = {}) {
    const command = parse(message);
    if (!command) return original.apply(this, arguments);
    if (typeof runtime.isStaff === "function" && !runtime.isStaff(session)) {
      return { handled: true, message: "autoAllianceLogo: /alogo is a staff command." };
    }
    const reply = runtime.runCommand(command, session);
    return { handled: true, message: reply };
  };
  overlay.__autoAllianceLogo = true;
  exports.executeChatCommand = overlay;
  return true;
}

module.exports = { COMMAND_NAME, helpText, installChat, parse };
