"use strict";

// Which image request is a corporation logo?
//
// The vendor resolver accepts both the legacy path and the REST form:
//   /Corporation/98000001_64.png
//   /Corporation/98000001.png
//   /corporations/98000001/logo?size=64&ext=png
// Anything else is left to the vendor resolver untouched.

const LEGACY = /^\/Corporation\/(\d+)(?:_(\d+))?\.(png|jpg|jpeg)$/i;
const REST = /^\/corporations\/(\d+)\/logo$/i;

function positiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function matchCorporationLogo(requestUrl) {
  let url;
  try {
    url = new URL(String(requestUrl || "/"), "http://localhost");
  } catch (error) {
    return null;
  }
  const legacy = LEGACY.exec(url.pathname);
  if (legacy) {
    return {
      corporationID: positiveInt(legacy[1], 0),
      size: positiveInt(legacy[2], 0) || null,
    };
  }
  const rest = REST.exec(url.pathname);
  if (rest) {
    return {
      corporationID: positiveInt(rest[1], 0),
      size: positiveInt(url.searchParams.get("size"), 0) || null,
    };
  }
  return null;
}

module.exports = { LEGACY, REST, matchCorporationLogo };
