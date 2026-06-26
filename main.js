/**
 * main.js — UI, upload easter egg, asset management, orchestration
 */

import { processVideo } from './processor.js';

// ── Asset discovery ───────────────────────────────────────

// Vite's import.meta.glob to discover static assets at build time
const emojiModules = import.meta.glob('/assets/emojis/*.{png,jpg,jpeg,gif,webp}', { eager: true, query: '?url', import: 'default' });
const musicModules = import.meta.glob('/assets/music/*.{wav,mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' });
const sfxModules   = import.meta.glob('/assets/sfx/*.{wav,mp3,ogg}', { eager: true, query: '?url', import: 'default' });
const decorModules = import.meta.glob('/assets/decor/*.{svg,png,jpg,jpeg,gif,webp}', { eager: true, query: '?url', import: 'default' });
const bgmModules   = import.meta.glob('/assets/bgm/*.{wav,mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' });

const EMOJIS = Object.values(emojiModules);
const MUSIC  = Object.values(musicModules);
const DECOR  = Object.values(decorModules);

// SFX map by convention name
const SFX = {};
for (const [path, url] of Object.entries(sfxModules)) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, ''); // e.g. "hover"
  SFX[name] = url;
}

// ── DOM refs ─────────────────────────────────────────────

const uploadBtn     = document.getElementById('upload-btn');
const fileInput     = document.getElementById('file-input');
const freqSlider    = document.getElementById('freq-slider');
const keepRatioCb   = document.getElementById('keep-ratio');
const statusSection = document.getElementById('status-section');
const progressBar   = document.getElementById('progress-bar');
const statusText    = document.getElementById('status-text');
const resultSection = document.getElementById('result-section');
const previewVideo  = document.getElementById('preview-video');
const downloadBtn   = document.getElementById('download-btn');
const jumpscareEl   = document.getElementById('jumpscare');
const jumpscareImg  = document.getElementById('jumpscare-img');
const decorLayer    = document.getElementById('decor-layer');
const introOverlay  = document.getElementById('intro-overlay');
const introClose    = document.getElementById('intro-close');
const bgmBtn        = document.getElementById('bgm-btn');

// ── State ─────────────────────────────────────────────────

let outputBlob = null;
let isProcessing = false;

// ── BGM ───────────────────────────────────────────────────

const BGM = Object.values(bgmModules);
let bgmAudio = null;

function startBgm() {
  if (BGM.length === 0) return;
  const src = BGM[Math.floor(Math.random() * BGM.length)];
  bgmAudio = new Audio(src);
  bgmAudio.volume = 0.15;
  bgmAudio.loop = true;
  bgmAudio.play().catch(() => {});
  bgmBtn.classList.remove('hidden');
  bgmBtn.textContent = '🔊 BGM';
}

bgmBtn.addEventListener('click', () => {
  if (!bgmAudio) return;
  bgmAudio.muted = !bgmAudio.muted;
  bgmBtn.textContent = bgmAudio.muted ? '🔇 BGM' : '🔊 BGM';
  bgmBtn.classList.toggle('muted', bgmAudio.muted);
});

// ── Intro popup ───────────────────────────────────────────

introClose.addEventListener('click', () => {
  introOverlay.classList.add('gone');
  startBgm();
});

// ── Frequency map ─────────────────────────────────────────

const FREQ_MAP = [8, 6, 4]; // slider values 0,1,2 → baseInterval seconds

// ── Decor layer ───────────────────────────────────────────

function initDecor() {
  if (DECOR.length === 0) return;
  const positions = [
    { top: '5%',  left: '-2%',  rot0: '-8deg',  rot1: '3deg',  dur: '7s',  hr: '30deg' },
    { top: '12%', right: '-3%', rot0: '5deg',   rot1: '-10deg', dur: '9s',  hr: '180deg' },
    { top: '55%', left: '-4%',  rot0: '-3deg',  rot1: '8deg',  dur: '11s', hr: '90deg' },
    { top: '70%', right: '-2%', rot0: '10deg',  rot1: '-5deg', dur: '6s',  hr: '260deg' },
  ];
  positions.forEach((pos, i) => {
    const src = DECOR[i % DECOR.length];
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.cssText = Object.entries(pos)
      .filter(([k]) => !['rot0','rot1','dur','hr'].includes(k))
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    img.style.setProperty('--rot0', pos.rot0);
    img.style.setProperty('--rot1', pos.rot1);
    img.style.setProperty('--dur', pos.dur);
    img.style.setProperty('--hr', pos.hr);
    decorLayer.appendChild(img);
  });
}
initDecor();

// ── SFX helpers ───────────────────────────────────────────

function playSfx(name) {
  const url = SFX[name];
  if (!url) return null;
  const audio = new Audio(url);
  audio.volume = 0.4;
  audio.play().catch(() => {});
  return audio;
}

// Hover sfx on key elements
uploadBtn.addEventListener('mouseenter', () => playSfx('hover'));
downloadBtn.addEventListener('mouseenter', () => playSfx('hover'));

// ── Jump-scare logic ──────────────────────────────────────

let jumpscareAudio = null;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function triggerJumpscare(onDone) {
  if (EMOJIS.length === 0 || MUSIC.length === 0) {
    onDone && onDone();
    return;
  }

  const emojiSrc = pickRandom(EMOJIS);
  const musicSrc = pickRandom(MUSIC);

  jumpscareImg.src = emojiSrc;
  jumpscareEl.classList.add('active');
  document.body.classList.add('grayscale-shock');

  // Pause BGM during jumpscare
  if (bgmAudio && !bgmAudio.paused) bgmAudio.pause();

  // Play phonk
  jumpscareAudio = new Audio(musicSrc);
  jumpscareAudio.volume = 0.85;

  jumpscareAudio.addEventListener('ended', endJumpscare);
  jumpscareAudio.addEventListener('error', endJumpscare);

  jumpscareAudio.play().catch(() => endJumpscare());

  function endJumpscare() {
    jumpscareEl.classList.remove('active');
    document.body.classList.remove('grayscale-shock');
    jumpscareAudio = null;
    // Resume BGM if not manually muted
    if (bgmAudio && !bgmAudio.muted) bgmAudio.play().catch(() => {});
    onDone && onDone();
  }
}

// ── Upload button ─────────────────────────────────────────

uploadBtn.addEventListener('click', () => {
  if (isProcessing) return;
  playSfx('click');

  // Open file picker immediately (mobile requires it in the same gesture)
  fileInput.click();

  // 70% chance of jumpscare in parallel (does NOT block file picker)
  if (Math.random() < 0.70) {
    triggerJumpscare(null);
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  playSfx('upload');
  startProcessing(file);
  // Reset input so the same file can be re-uploaded
  fileInput.value = '';
});

// ── Processing orchestration ──────────────────────────────

async function startProcessing(file) {
  if (isProcessing) return;
  isProcessing = true;

  uploadBtn.disabled = true;
  resultSection.classList.add('hidden');
  statusSection.classList.remove('hidden');

  setProgress(0);
  setStatus('initialising...');

  const baseInterval = FREQ_MAP[parseInt(freqSlider.value, 10)] ?? 6;
  const keepRatio = keepRatioCb.checked;

  try {
    const blob = await processVideo(file, EMOJIS, MUSIC, {
      baseInterval,
      keepRatio,
      onProgress: setProgress,
      onStatus: setStatus,
    });

    outputBlob = blob;
    const url = URL.createObjectURL(blob);
    previewVideo.src = url;
    resultSection.classList.remove('hidden');
    playSfx('complete');
    setStatus('✅ done!');
    setProgress(1);

  } catch (err) {
    console.error(err);
    setStatus('❌ failed: ' + err.message);
  } finally {
    isProcessing = false;
    uploadBtn.disabled = false;
  }
}

function setProgress(ratio) {
  progressBar.style.width = Math.round(ratio * 100) + '%';
}

function setStatus(msg) {
  statusText.textContent = msg;
}

// ── Download button ───────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  if (!outputBlob) return;
  playSfx('click');

  // Always trigger download immediately (don't block on jumpscare)
  const url = URL.createObjectURL(outputBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'phonk_meme_' + Date.now() + '.mp4';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // 50% chance of jumpscare in parallel (does NOT block download)
  if (Math.random() < 0.50) {
    triggerJumpscare(null);
  }
});
