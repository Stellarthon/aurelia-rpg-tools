#!/usr/bin/env node
// Generates themed PWA icons (no image libs) — a gold orrery ring + star on the
// app's dark navy, drawn per-pixel and PNG-encoded with Node's zlib. Plain by
// design; replace icons/icon-*.png with real art anytime.
//   node tools/gen-icons.mjs   → icons/icon-192.png, icon-512.png, apple-touch-180.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../icons');

const BG = [15, 17, 23], GOLD = [212, 168, 67];
function pixel(x, y, N) {
  const c = N / 2, dx = x - c + 0.5, dy = y - c + 0.5;
  const d = Math.hypot(dx, dy) / N;            // 0..~0.7
  const a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
  // gold orrery ring (annulus) + 3 "planet" pips on it + central star
  const onRing = d > 0.30 && d < 0.345;
  const pip = (d > 0.27 && d < 0.375) && [0.08, 0.42, 0.74].some(p => Math.abs(((a - p + 1) % 1)) < 0.018);
  const star = d < 0.075;
  return (onRing || pip || star) ? GOLD : BG;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(N) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6;                    // 8-bit, RGBA
  const raw = Buffer.alloc(N * (N * 4 + 1));
  let o = 0;
  for (let y = 0; y < N; y++) {
    raw[o++] = 0;                              // filter: none
    for (let x = 0; x < N; x++) { const [r, g, b] = pixel(x, y, N); raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = 255; }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const [name, N] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-180.png', 180]]) {
  writeFileSync(resolve(outDir, name), png(N));
  console.log(`✓ icons/${name} (${N}×${N})`);
}
