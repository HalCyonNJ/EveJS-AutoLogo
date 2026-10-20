"use strict";

// Reads the format and the pixel size of a PNG or JPEG without decoding it.
// The mod only needs two numbers per file: the format decides whether the bytes
// can be published as they are, and the size decides whether they must be
// scaled down to the 1280 x 1280 limit.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngInfo(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!(width > 0 && height > 0)) return null;
  return { format: "png", width, height };
}

function readJpegInfo(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (!(width > 0 && height > 0)) return null;
      return { format: "jpeg", width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function readImageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  return readPngInfo(buffer) || readJpegInfo(buffer);
}

module.exports = { PNG_SIGNATURE, readImageInfo, readJpegInfo, readPngInfo };
