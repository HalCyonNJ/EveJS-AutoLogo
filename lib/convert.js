"use strict";

// Turns any accepted source image into the PNG the image service publishes.
//
// Alliance logos are served as PNG (`<allianceID>_<size>.png`), so a JPEG has to
// be decoded and re-encoded; a PNG can be published byte for byte unless it is
// larger than the allowed edge, in which case it is decoded, scaled down and
// encoded again. Scaling is plain bilinear on the RGBA buffer: no native
// dependency, and the only images this mod ever handles are logos.

const { PNG } = require("../vendor/pngjs");
const jpeg = require("../vendor/jpeg-js");

const MAX_EDGE = 1280;

function decode(buffer, info) {
  if (info.format === "png") {
    const png = PNG.sync.read(buffer, {});
    return { width: png.width, height: png.height, data: png.data };
  }
  const decoded = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512 });
  return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
}

function resizeRgba(source, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) return source;
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = (width - 1) / Math.max(1, targetWidth - 1);
  const yRatio = (height - 1) / Math.max(1, targetHeight - 1);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = y * yRatio;
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(height - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = x * xRatio;
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(width - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const targetIndex = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source[(y0 * width + x0) * 4 + channel];
        const topRight = source[(y0 * width + x1) * 4 + channel];
        const bottomLeft = source[(y1 * width + x0) * 4 + channel];
        const bottomRight = source[(y1 * width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * xWeight;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
        target[targetIndex + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }
  return target;
}

function encodePng(width, height, data) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png);
}

// Returns { png, width, height, resized }. `png` is always a valid PNG buffer.
function toPng(buffer, info, options = {}) {
  const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : MAX_EDGE;
  const oversized = info.width > maxEdge || info.height > maxEdge;
  if (info.format === "png" && !oversized) {
    return { png: buffer, width: info.width, height: info.height, resized: false };
  }
  const decoded = decode(buffer, info);
  let width = decoded.width;
  let height = decoded.height;
  let data = decoded.data;
  let resized = false;
  if (oversized) {
    const scale = Math.min(maxEdge / width, maxEdge / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    data = resizeRgba(data, decoded.width, decoded.height, width, height);
    resized = true;
  }
  return { png: encodePng(width, height, data), width, height, resized };
}

module.exports = { MAX_EDGE, decode, encodePng, resizeRgba, toPng };
