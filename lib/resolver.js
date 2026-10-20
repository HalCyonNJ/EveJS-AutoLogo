"use strict";

// Hooks the vendor's image request resolver inside the image edge process.
//
// The image edge is forked from the game server and inherits its --require flags,
// so this loader runs there too. The resolver module is required after the
// preload, which lets us wrap `resolveImageRequest` in memory: a corporation logo
// request that has a published file is answered from that file, everything else
// goes to the vendor resolver untouched. No EveJS source file is edited.

const path = require("node:path");
const Module = require("node:module");
const { matchCorporationLogo } = require("./match");
const { findPublished } = require("./publish");

function canonical(file) {
  return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
}

function installResolver(options = {}) {
  const root = options.root;
  const publishedDir = options.publishedDir;
  const log = typeof options.log === "function" ? options.log : () => {};
  if (!root || !publishedDir) return false;
  const resolverPath = canonical(path.join(
    root, "server", "src", "_secondary", "image", "imageRequestResolver.js",
  ));
  if (installResolver.installed) return true;

  const previousLoad = Module._load;
  Module._load = function autoCorporationLogoResolver(request, parent, isMain) {
    const exports = previousLoad.apply(this, arguments);
    let loadedPath;
    try {
      loadedPath = canonical(Module._resolveFilename(request, parent, isMain));
    } catch (error) {
      return exports;
    }
    if (loadedPath !== resolverPath || !exports || typeof exports.resolveImageRequest !== "function") {
      return exports;
    }
    if (exports.__autoCorporationLogo === true) return exports;
    const original = exports.resolveImageRequest;
    exports.resolveImageRequest = function resolveImageRequestWithCorporationLogo(requestUrl) {
      try {
        const hit = matchCorporationLogo(requestUrl);
        if (hit) {
          const filePath = findPublished(publishedDir, hit.corporationID, hit.size);
          if (filePath) {
            return { filePath, contentType: "image/png" };
          }
        }
      } catch (error) {
        // Any problem falls through to the vendor resolver below.
      }
      return original.apply(this, arguments);
    };
    exports.__autoCorporationLogo = true;
    installResolver.installed = true;
    log("image resolver hooked: corporation logos are served from the published folder");
    return exports;
  };
  return true;
}

installResolver.installed = false;

module.exports = { canonical, installResolver };
