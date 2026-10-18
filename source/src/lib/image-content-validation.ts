import { inflateSync } from 'node:zlib';

export type RasterImageInspection =
  | {
      ok: true;
      format: 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'heic';
      width: number;
      height: number;
    }
  | { ok: false; reason: string };

const readU16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];

const readU32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const readU32Le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
  0;

const asciiAt = (bytes: Uint8Array, offset: number, value: string) =>
  value.length <= bytes.length - offset &&
  [...value].every(
    (character, index) =>
      bytes[offset + index] === character.charCodeAt(0)
  );

const fail = (reason: string): RasterImageInspection => ({ ok: false, reason });

const hasPngSignature = (bytes: Uint8Array) =>
  bytes.length >= 8 &&
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47 &&
  bytes[4] === 0x0d &&
  bytes[5] === 0x0a &&
  bytes[6] === 0x1a &&
  bytes[7] === 0x0a;

const inspectPng = (bytes: Uint8Array): RasterImageInspection => {
  if (!hasPngSignature(bytes)) return fail('missing PNG signature');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  const imageData: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    if (length > bytes.length - offset - 12) {
      return fail('truncated PNG chunk');
    }
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) {
        return fail('PNG does not start with IHDR');
      }
      width = readU32(bytes, dataStart);
      height = readU32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
      const validDepth = [1, 2, 4, 8, 16].includes(bitDepth);
      const validColor = [0, 2, 3, 4, 6].includes(colorType);
      if (!width || !height || !validDepth || !validColor) {
        return fail('invalid PNG header');
      }
      if (interlace > 1) return fail('invalid PNG interlace mode');
      sawHeader = true;
    } else if (type === 'IDAT') {
      imageData.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }

    offset = dataEnd + 4;
  }

  if (!sawHeader) return fail('PNG header is missing');
  if (!sawEnd) return fail('PNG is missing its IEND chunk');
  if (imageData.length === 0) return fail('PNG has no image data');

  const channels =
    colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
  if (colorType === 3 && bitDepth === 16) {
    return fail('invalid PNG palette depth');
  }

  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(imageData.map((part) => Buffer.from(part))));
  } catch {
    return fail('PNG image data is not decodable');
  }
  if (inflated.length === 0) return fail('PNG image data is empty');

  // Adam7 images have a different scanline layout; a successful inflate still
  // proves the compressed stream is real, which is what matters here.
  if (interlace === 0) {
    const rowBytes = Math.ceil((width * channels * bitDepth) / 8) + 1;
    if (inflated.length !== rowBytes * height) {
      return fail('PNG image data has the wrong size');
    }
  }

  return { ok: true, format: 'png', width, height };
};

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

const inspectJpeg = (bytes: Uint8Array): RasterImageInspection => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return fail('missing JPEG start marker');
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return fail('invalid JPEG marker');
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      sawScan = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return fail('truncated JPEG segment');
    const length = readU16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) {
      return fail('invalid JPEG segment length');
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) return fail('invalid JPEG frame header');
      height = readU16(bytes, offset + 3);
      width = readU16(bytes, offset + 5);
      if (!width || !height) return fail('invalid JPEG dimensions');
      sawFrame = true;
    }
    offset += length;
  }

  if (!sawFrame) return fail('JPEG has no frame header');
  if (!sawScan) return fail('JPEG has no image scan');
  // Some cameras append a short trailer after EOI; accept an end marker near
  // the tail instead of requiring it at the exact last two bytes.
  let hasEndMarker = false;
  for (
    let index = bytes.length - 2;
    index >= Math.max(0, bytes.length - 64);
    index -= 1
  ) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      hasEndMarker = true;
      break;
    }
  }
  if (!hasEndMarker) return fail('JPEG is missing its end marker');
  return { ok: true, format: 'jpeg', width, height };
};

const skipGifSubBlocks = (bytes: Uint8Array, start: number) => {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  return -1;
};

const inspectGif = (bytes: Uint8Array): RasterImageInspection => {
  if (
    bytes.length < 13 ||
    (!asciiAt(bytes, 0, 'GIF87a') && !asciiAt(bytes, 0, 'GIF89a'))
  ) {
    return fail('missing GIF signature');
  }
  let width = readU16(bytes, 6);
  let height = readU16(bytes, 8);
  if (!width || !height) return fail('invalid GIF dimensions');
  const packed = bytes[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  if (offset > bytes.length) return fail('truncated GIF color table');

  let sawImage = false;
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) break;
    if (block === 0x21) {
      offset = skipGifSubBlocks(bytes, offset + 2);
      if (offset < 0) return fail('truncated GIF extension');
      continue;
    }
    if (block === 0x2c) {
      if (offset + 10 > bytes.length) return fail('truncated GIF image header');
      const imageWidth = readU16(bytes, offset + 5);
      const imageHeight = readU16(bytes, offset + 7);
      if (!imageWidth || !imageHeight) return fail('invalid GIF image size');
      const imagePacked = bytes[offset + 9];
      let imageOffset = offset + 10;
      if (imagePacked & 0x80) {
        imageOffset += 3 * (1 << ((imagePacked & 0x07) + 1));
      }
      if (imageOffset >= bytes.length) return fail('truncated GIF image table');
      imageOffset += 1; // LZW minimum code size
      imageOffset = skipGifSubBlocks(bytes, imageOffset);
      if (imageOffset < 0) return fail('truncated GIF image data');
      sawImage = true;
      offset = imageOffset;
      width = imageWidth || width;
      height = imageHeight || height;
      continue;
    }
    return fail('invalid GIF block');
  }

  if (!sawImage) return fail('GIF has no image frame');
  return { ok: true, format: 'gif', width, height };
};

const inspectWebp = (bytes: Uint8Array): RasterImageInspection => {
  if (
    bytes.length < 16 ||
    !asciiAt(bytes, 0, 'RIFF') ||
    !asciiAt(bytes, 8, 'WEBP')
  ) {
    return fail('missing WebP signature');
  }
  let offset = 12;
  let width = 0;
  let height = 0;
  let sawImage = false;

  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const length = readU32Le(bytes, offset + 4);
    const dataStart = offset + 8;
    if (length > bytes.length - dataStart) return fail('truncated WebP chunk');

    if (type === 'VP8X' && length >= 10) {
      width = 1 + (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16));
      height = 1 + (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16));
      sawImage = true;
    } else if (type === 'VP8 ' && length >= 10) {
      if (bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) {
        return fail('invalid WebP frame header');
      }
      width = readU16(bytes, dataStart + 6) & 0x3fff;
      height = readU16(bytes, dataStart + 8) & 0x3fff;
      sawImage = true;
    } else if (type === 'VP8L' && length >= 5) {
      if (bytes[dataStart] !== 0x2f) return fail('invalid WebP lossless header');
      const bits =
        bytes[dataStart + 1] |
        (bytes[dataStart + 2] << 8) |
        (bytes[dataStart + 3] << 16) |
        (bytes[dataStart + 4] << 24);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
      sawImage = true;
    }

    offset = dataStart + length + (length % 2);
  }

  if (!sawImage) return fail('WebP has no image chunk');
  if (!width || !height) return fail('invalid WebP dimensions');
  return { ok: true, format: 'webp', width, height };
};

const inspectIsoImage = (
  bytes: Uint8Array
): RasterImageInspection => {
  if (bytes.length < 16 || !asciiAt(bytes, 4, 'ftyp')) {
    return fail('missing ISO image signature');
  }
  const ftypSize = readU32(bytes, 0);
  if (ftypSize < 16 || ftypSize > bytes.length) {
    return fail('invalid ISO image header');
  }
  const brand = String.fromCharCode(
    bytes[8],
    bytes[9],
    bytes[10],
    bytes[11]
  );
  let offset = ftypSize;
  let sawMeta = false;
  while (offset + 8 <= bytes.length) {
    const size = readU32(bytes, offset);
    if (size < 8 || size > bytes.length - offset) break;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (type === 'meta') {
      sawMeta = true;
      break;
    }
    offset += size;
  }
  if (!sawMeta) return fail('ISO image has no metadata box');
  const format = /avif|avis/.test(brand)
    ? 'avif'
    : /heic|heix|hevc|hevx|mif1|msf1/.test(brand)
      ? 'heic'
      : 'avif';
  return { ok: true, format, width: 0, height: 0 };
};

/**
 * Structural validation for uploaded raster images. The signature check alone
 * accepts a file that only starts with the right magic bytes; this walks the
 * container enough to reject files a browser could never display.
 */
export const inspectRasterImage = (
  mimeType: string,
  bytes: Uint8Array
): RasterImageInspection => {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return inspectJpeg(bytes);
    case 'image/png':
      return inspectPng(bytes);
    case 'image/gif':
      return inspectGif(bytes);
    case 'image/webp':
      return inspectWebp(bytes);
    case 'image/avif':
    case 'image/heic':
    case 'image/heif':
      return inspectIsoImage(bytes);
    default:
      return fail('unsupported raster format');
  }
};
