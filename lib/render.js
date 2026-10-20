"use strict";

// Renders one source image into the square PNGs the image service asks for.
//
// Corporation logos are served as `_32.png` … `_1024.png`. The source is scaled
// to fit each square (aspect preserved, transparent padding) and encoded as PNG,
// so a 32 px icon is a real 32 px file instead of a 1.6 MB original.

const { PNG } = require("../vendor/pngjs");
const jpeg = require("../vendor/jpeg-js");
const { resizeRgba, encodePng } = require("./convert");

const SIZES = Object.freeze([32, 64, 128, 256, 512, 1024]);

function decode(buffer, info) {
  if (info.format === "png") {
    const png = PNG.sync.read(buffer, {});
    return { width: png.width, height: png.height, data: png.data };
  }
  const decoded = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512 });
  return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
}

// Fits the image inside a size x size canvas without distortion and centres it.
function toSquare(source, width, height, size) {
  const scale = Math.min(size / width, size / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  const scaled = resizeRgba(source, width, height, drawWidth, drawHeight);
  if (drawWidth === size && drawHeight === size) return scaled;
  const canvas = Buffer.alloc(size * size * 4);
  const offsetX = Math.floor((size - drawWidth) / 2);
  const offsetY = Math.floor((size - drawHeight) / 2);
  for (let y = 0; y < drawHeight; y += 1) {
    const sourceStart = y * drawWidth * 4;
    const targetStart = ((y + offsetY) * size + offsetX) * 4;
    scaled.copy(canvas, targetStart, sourceStart, sourceStart + drawWidth * 4);
  }
  return canvas;
}

function renderSizes(buffer, info, sizes = SIZES) {
  const decoded = decode(buffer, info);
  return sizes.map((size) => ({
    size,
    png: encodePng(size, size, toSquare(decoded.data, decoded.width, decoded.height, size)),
  }));
}

module.exports = { SIZES, decode, renderSizes, toSquare };
