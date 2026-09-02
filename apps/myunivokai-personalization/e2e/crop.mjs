/**
 * Crop and magnify a region of a screenshot.
 *
 * A full 1440x900 frame is where small defects hide: a placeholder mesh, a
 * hovering object, a seam. Measuring the whole frame averages them away and
 * looking at the whole frame is too coarse to identify them. This cuts a window
 * out and scales it up with nearest-neighbour, so what is actually in those
 * pixels becomes legible.
 *
 * Usage:
 *   node e2e/crop.mjs <shot.png> <x> <y> <w> <h> [zoom] [out.png]
 *   node e2e/crop.mjs e2e/shots/desktop/ocean-abyss.png 400 300 260 200 4
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const target = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? target[x - bytesPerPixel] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dLeft = Math.abs(p - left);
        const dUp = Math.abs(p - up);
        const dUpLeft = Math.abs(p - upLeft);
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      target[x] = value & 0xff;
    }
  }
  return out;
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  return {
    width,
    height,
    bytesPerPixel,
    pixels: unfilter(inflateSync(Buffer.concat(chunks)), width, height, bytesPerPixel),
  };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const [source, xArg, yArg, wArg, hArg, zoomArg, outArg] = process.argv.slice(2);
if (!source) {
  console.error("usage: node e2e/crop.mjs <shot.png> <x> <y> <w> <h> [zoom] [out.png]");
  process.exit(1);
}
const image = decodePng(readFileSync(source));
const x0 = Math.max(0, Number(xArg) || 0);
const y0 = Math.max(0, Number(yArg) || 0);
const cw = Math.min(Number(wArg) || 200, image.width - x0);
const ch = Math.min(Number(hArg) || 200, image.height - y0);
const zoom = Math.max(1, Math.round(Number(zoomArg) || 3));
const out = outArg ?? "crop.png";

const rgb = Buffer.alloc(cw * zoom * ch * zoom * 3);
for (let y = 0; y < ch * zoom; y += 1) {
  for (let x = 0; x < cw * zoom; x += 1) {
    const sx = x0 + Math.floor(x / zoom);
    const sy = y0 + Math.floor(y / zoom);
    const s = sy * image.width * image.bytesPerPixel + sx * image.bytesPerPixel;
    const d = (y * cw * zoom + x) * 3;
    rgb[d] = image.pixels[s];
    rgb[d + 1] = image.pixels[s + 1];
    rgb[d + 2] = image.pixels[s + 2];
  }
}
writeFileSync(out, encodePng(cw * zoom, ch * zoom, rgb));
console.log(`${out}  ${cw}x${ch} @${zoom}x  from ${source} at (${x0},${y0})`);
