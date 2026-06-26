/**
 * Generates placeholder assets for development.
 * Run once with: node generate-assets.mjs
 * Delete this file after replacing with real assets.
 */
import { writeFileSync } from 'fs';

// Generate placeholder emoji PNGs as SVG files (browsers render SVG fine)
const emojis = [
  { name: 'emoji1.svg', color: '#FF4444', face: '😤', label: 'BRUH' },
  { name: 'emoji2.svg', color: '#44FF44', face: '💀', label: 'DEAD' },
  { name: 'emoji3.svg', color: '#4444FF', face: '🗿', label: 'SIGMA' },
  { name: 'emoji4.svg', color: '#FF44FF', face: '😭', label: 'CRYING' },
  { name: 'emoji5.svg', color: '#FFFF44', face: '🤡', label: 'CLOWN' },
];

for (const e of emojis) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <circle cx="150" cy="150" r="140" fill="${e.color}" stroke="#000" stroke-width="8"/>
  <text x="150" y="180" font-size="120" text-anchor="middle" dominant-baseline="middle">${e.face}</text>
  <text x="150" y="270" font-size="40" font-weight="900" text-anchor="middle" fill="#000" font-family="Arial Black">${e.label}</text>
</svg>`;
  writeFileSync(`assets/emojis/${e.name}`, svg);
}

// Generate WAV files: simple sine-wave beeps
function generateWav(filename, freq, durationSec, amp = 0.5) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample

  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // PCM chunk size
  buf.writeUInt16LE(1, 20);         // PCM format
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    // Fade in/out to avoid clicks
    let env = 1;
    const fadeSamples = Math.min(500, numSamples * 0.1);
    if (i < fadeSamples) env = i / fadeSamples;
    if (i > numSamples - fadeSamples) env = (numSamples - i) / fadeSamples;

    const sample = Math.round(amp * env * 32767 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }

  writeFileSync(filename, buf);
}

// Phonk music placeholders (~2s each)
generateWav('assets/music/phonk1.wav', 110, 2.0, 0.6);  // low A
generateWav('assets/music/phonk2.wav', 147, 1.8, 0.6);  // D3
generateWav('assets/music/phonk3.wav',  87, 2.2, 0.6);  // F2 (real deep)

// SFX placeholders
generateWav('assets/sfx/hover.wav',   880, 0.08, 0.3);
generateWav('assets/sfx/click.wav',  1200, 0.12, 0.5);
generateWav('assets/sfx/upload.wav',  660, 0.30, 0.4);
generateWav('assets/sfx/complete.wav', 440, 0.50, 0.4);

console.log('✅ Placeholder assets generated!');
