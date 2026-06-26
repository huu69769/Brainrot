/**
 * Generates placeholder assets for development.
 * Run once with: node generate-assets.mjs
 * Delete this file (or keep it) after replacing with real assets.
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

// ── PNG encoder (pure Node.js, no deps) ───────────────────

function encodePNG(width, height, rgba) {
  const rowLen = 1 + width * 4;
  const raw = Buffer.allocUnsafe(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = y * rowLen + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }

  const compressed = deflateSync(raw);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(d.length, 0);
    const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
    return Buffer.concat([len, t, d, crcBuf]);
  };

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Emoji face generator ──────────────────────────────────

function makeEmojiPNG(size, r, g, b) {
  const rgba = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 2;
  const borderW = Math.max(4, size * 0.04);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);

      if (d > outerR) { rgba[i + 3] = 0; continue; } // transparent outside

      if (d > outerR - borderW) { // black border
        rgba[i] = 10; rgba[i+1] = 10; rgba[i+2] = 10; rgba[i+3] = 255; continue;
      }

      // Eyes
      const eyeR = size * 0.10;
      const eyeCy = cy - size * 0.18;
      const le = Math.sqrt((px - (cx - size * 0.22)) ** 2 + (py - eyeCy) ** 2);
      const re = Math.sqrt((px - (cx + size * 0.22)) ** 2 + (py - eyeCy) ** 2);
      if (le < eyeR || re < eyeR) {
        rgba[i] = 15; rgba[i+1] = 15; rgba[i+2] = 15; rgba[i+3] = 255; continue;
      }

      // Mouth arc
      const md = Math.sqrt((px - cx) ** 2 + (py - (cy + size * 0.08)) ** 2);
      if (py > cy + size * 0.05 && md < size * 0.26 && md > size * 0.17) {
        rgba[i] = 15; rgba[i+1] = 15; rgba[i+2] = 15; rgba[i+3] = 255; continue;
      }

      // Face fill
      rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = 255;
    }
  }

  return encodePNG(size, size, rgba);
}

// ── WAV generator ─────────────────────────────────────────

function generateWav(freq, durationSec, amp = 0.55) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);

  const fadeSamples = Math.min(800, Math.floor(numSamples * 0.1));
  for (let i = 0; i < numSamples; i++) {
    let env = 1;
    if (i < fadeSamples) env = i / fadeSamples;
    if (i > numSamples - fadeSamples) env = (numSamples - i) / fadeSamples;
    const v = Math.round(amp * env * 32767 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), 44 + i * 2);
  }
  return buf;
}

// ── Generate emoji PNGs ───────────────────────────────────

const emojiDefs = [
  [255,  60,  60],  // red
  [ 60, 220,  60],  // green
  [ 60, 100, 255],  // blue
  [255, 200,  30],  // yellow
  [200,  60, 255],  // purple
];

emojiDefs.forEach(([r, g, b], i) => {
  const buf = makeEmojiPNG(300, r, g, b);
  writeFileSync(`assets/emojis/emoji${i + 1}.png`, buf);
  console.log(`  ✓ emoji${i + 1}.png`);
});

// Remove old SVG files if present
import { existsSync, unlinkSync } from 'fs';
for (let i = 1; i <= 5; i++) {
  const svg = `assets/emojis/emoji${i}.svg`;
  if (existsSync(svg)) { unlinkSync(svg); console.log(`  ✓ removed ${svg}`); }
}

// ── Generate phonk placeholder WAVs ───────────────────────

const musicDefs = [
  ['phonk1.wav', 110, 2.0],
  ['phonk2.wav', 147, 1.8],
  ['phonk3.wav',  87, 2.2],
];
musicDefs.forEach(([name, freq, dur]) => {
  writeFileSync(`assets/music/${name}`, generateWav(freq, dur, 0.6));
  console.log(`  ✓ music/${name}`);
});

// ── Generate SFX WAVs ─────────────────────────────────────

const sfxDefs = [
  ['hover.wav',    880, 0.08, 0.3],
  ['click.wav',   1200, 0.12, 0.5],
  ['upload.wav',   660, 0.30, 0.4],
  ['complete.wav', 440, 0.50, 0.4],
];
sfxDefs.forEach(([name, freq, dur, amp]) => {
  writeFileSync(`assets/sfx/${name}`, generateWav(freq, dur, amp));
  console.log(`  ✓ sfx/${name}`);
});

console.log('\n✅ 所有占位素材生成完毕！');
