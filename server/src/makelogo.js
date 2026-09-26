'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', '..', 'app', 'logo.png');
const SIZE = 512;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0;
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const BLUE_TOP = [10, 132, 255];
const BLUE_BOT = [0, 122, 255];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sample(u, v) {
  const x = u * SIZE, y = v * SIZE;

  const t = Math.min(1, Math.max(0, v));
  const bg = [
    BLUE_TOP[0] + (BLUE_BOT[0] - BLUE_TOP[0]) * t,
    BLUE_TOP[1] + (BLUE_BOT[1] - BLUE_TOP[1]) * t,
    BLUE_TOP[2] + (BLUE_BOT[2] - BLUE_TOP[2]) * t,
  ];

  const bw = SIZE * 0.50;
  const bh = SIZE * 0.40;
  const cx = SIZE * 0.5;
  const cy = SIZE * 0.46;
  const r  = SIZE * 0.15;

  const dBubble = sdRoundRect(x, y, cx, cy, bw / 2, bh / 2, r);

  const tx0 = cx - bw * 0.22, ty0 = cy + bh / 2 - 2;
  const tx1 = cx - bw * 0.46, ty1 = cy + bh * 0.80;
  const tx2 = cx - bw * 0.02, ty2 = cy + bh / 2 - 2;
  function inTri(px, py, a, b, c) {
    const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
    const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
    const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos);
  }
  const inTail = inTri(x, y, [tx0, ty0], [tx1, ty1], [tx2, ty2]);

  const edge = 1.5;
  let cover = 0;
  if (dBubble <= -edge) cover = 1;
  else if (dBubble < edge) cover = (edge - dBubble) / (2 * edge);
  if (inTail) cover = 1;

  if (cover <= 0) return bg;

  return [
    bg[0] + (255 - bg[0]) * cover,
    bg[1] + (255 - bg[1]) * cover,
    bg[2] + (255 - bg[2]) * cover,
  ];
}

function render(size, ss) {
  ss = ss || 3;
  const big = size * ss;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x * ss + sx + 0.5) / big, (y * ss + sy + 0.5) / big);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      out[i]     = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
  return out;
}

const png = encodePNG(SIZE, SIZE, render(SIZE, 3));
fs.writeFileSync(OUT, png);
console.log(`\n  \x1b[32m✔\x1b[0m 已生成 app/logo.png  ${SIZE}×${SIZE}  ${(png.length / 1024).toFixed(1)} KB`);
console.log(`  \x1b[90m·\x1b[0m 这是**默认占位图**。你有自己的图标就直接覆盖这个文件。`);
console.log(`  \x1b[90m·\x1b[0m 圆角是网页用 CSS 加的，所以这张图是满幅方块、不带圆角。\n`);
