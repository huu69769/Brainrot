/**
 * processor.js
 * Encapsulates ffmpeg.wasm video processing logic.
 *
 * Strategy: slice video into segments at freeze points, process each
 * freeze segment (grayscale + overlay emoji + replace audio with phonk),
 * then concat everything back. This guarantees audio/video sync.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  // Load from CDN with crossOriginIsolated support
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  return ffmpeg;
}

/**
 * @param {File}     videoFile      - user's video file
 * @param {string[]} emojiPaths     - list of emoji asset paths to pick from
 * @param {string[]} musicPaths     - list of phonk audio asset paths to pick from
 * @param {object}   opts
 * @param {number}   opts.baseInterval  - base seconds between freeze points
 * @param {boolean}  opts.keepRatio     - preserve original aspect ratio (else force 9:16)
 * @param {function} opts.onProgress    - progress callback (0..1)
 * @param {function} opts.onStatus      - status string callback
 * @returns {Promise<Blob>} processed mp4 blob
 */
export async function processVideo(videoFile, emojiPaths, musicPaths, opts = {}) {
  const {
    baseInterval = 6,
    keepRatio = false,
    onProgress = () => {},
    onStatus = () => {},
  } = opts;

  onStatus('加载 ffmpeg.wasm...');
  onProgress(0.02);

  const ff = await loadFFmpeg();

  ff.on('progress', ({ progress }) => {
    // progress events come from ffmpeg, map to 0.15–0.95 range
    onProgress(0.15 + Math.min(progress, 1) * 0.8);
  });

  onStatus('读取视频文件...');
  onProgress(0.05);

  // Write input video
  const inputName = 'input.' + videoFile.name.split('.').pop();
  ff.writeFile(inputName, await fetchFile(videoFile));

  // Probe video duration using ffprobe-like trick: run ffmpeg with -t 0
  onStatus('分析视频时长...');
  const duration = await probeDuration(ff, inputName);
  onStatus(`视频时长: ${duration.toFixed(1)}s，计算定格点...`);
  onProgress(0.08);

  // Compute freeze points
  const freezePoints = computeFreezePoints(duration, baseInterval);
  onStatus(`将在 ${freezePoints.length} 处插入定格效果`);
  onProgress(0.10);

  // Fetch and write emoji + music assets
  const usedEmojis = [];
  const usedMusic = [];
  const musicDurations = [];

  for (let i = 0; i < freezePoints.length; i++) {
    const emojiPath = emojiPaths[Math.floor(Math.random() * emojiPaths.length)];
    const musicPath = musicPaths[Math.floor(Math.random() * musicPaths.length)];

    const emojiName = `emoji_${i}.svg`;
    const musicName = `music_${i}.wav`;

    ff.writeFile(emojiName, await fetchFile(emojiPath));
    ff.writeFile(musicName, await fetchFile(musicPath));

    usedEmojis.push(emojiName);
    usedMusic.push(musicName);

    // Probe music duration
    const md = await probeAudioDuration(ff, musicName);
    musicDurations.push(md);
  }

  onProgress(0.12);

  // Determine output dimensions
  const { w: srcW, h: srcH } = await probeVideoDimensions(ff, inputName);
  let outW, outH;
  if (keepRatio) {
    // keep original, ensure even dimensions
    outW = srcW % 2 === 0 ? srcW : srcW - 1;
    outH = srcH % 2 === 0 ? srcH : srcH - 1;
  } else {
    // 9:16 output — pick a height that keeps it reasonable
    outH = srcH >= srcW ? Math.min(srcH, 1280) : 1280;
    if (outH % 2 !== 0) outH -= 1;
    outW = Math.round(outH * 9 / 16);
    if (outW % 2 !== 0) outW -= 1;
  }

  onStatus('构建视频片段...');

  /**
   * We'll build segments:
   *   [normal_0] [freeze_0] [normal_1] [freeze_1] ... [normal_N]
   * Then concat them.
   */

  // Build timeline of segments
  // freezePoints are the START times where freeze begins
  const segments = [];
  let cursor = 0;

  for (let i = 0; i < freezePoints.length; i++) {
    const freezeStart = freezePoints[i];
    const freezeDur = musicDurations[i];

    // Normal segment before this freeze
    if (freezeStart > cursor + 0.05) {
      segments.push({ type: 'normal', start: cursor, duration: freezeStart - cursor });
    }

    // Freeze segment
    segments.push({
      type: 'freeze',
      start: freezeStart,
      duration: freezeDur,
      freezeAt: freezeStart,
      emoji: usedEmojis[i],
      music: usedMusic[i],
    });

    cursor = freezeStart + freezeDur;
  }

  // Final normal segment
  if (cursor < duration - 0.05) {
    segments.push({ type: 'normal', start: cursor, duration: duration - cursor });
  }

  // Process each segment
  const segmentFiles = [];

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const outFile = `seg_${si}.mp4`;
    onStatus(`处理片段 ${si + 1}/${segments.length}...`);

    if (seg.type === 'normal') {
      await processNormalSegment(ff, inputName, seg, outFile, outW, outH, keepRatio, srcW, srcH);
    } else {
      await processFreezeSegment(ff, inputName, seg, outFile, outW, outH, keepRatio, srcW, srcH);
    }

    segmentFiles.push(outFile);
    onProgress(0.12 + (si / segments.length) * 0.75);
  }

  // Concat all segments
  onStatus('拼接所有片段...');
  onProgress(0.90);

  const concatListContent = segmentFiles.map(f => `file '${f}'`).join('\n');
  ff.writeFile('concat_list.txt', concatListContent);

  await ff.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat_list.txt',
    '-c', 'copy',
    'output.mp4',
  ]);

  onStatus('读取输出文件...');
  onProgress(0.97);

  const data = await ff.readFile('output.mp4');
  const blob = new Blob([data.buffer], { type: 'video/mp4' });

  onStatus('完成！');
  onProgress(1.0);

  // Cleanup
  try {
    ff.deleteFile(inputName);
    ff.deleteFile('concat_list.txt');
    ff.deleteFile('output.mp4');
    for (const f of segmentFiles) ff.deleteFile(f);
    for (const e of usedEmojis) ff.deleteFile(e);
    for (const m of usedMusic) ff.deleteFile(m);
  } catch (_) { /* best effort */ }

  return blob;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Compute freeze point timestamps using base interval + random jitter.
 */
function computeFreezePoints(duration, baseInterval) {
  const MIN_GAP = 3;
  const START_MARGIN = duration * 0.10;
  const END_MARGIN = duration * 0.10;
  const JITTER = 1.5;

  const points = [];
  let t = START_MARGIN + baseInterval * 0.5 + (Math.random() - 0.5) * JITTER * 2;

  while (t < duration - END_MARGIN) {
    if (points.length === 0 || t - points[points.length - 1] >= MIN_GAP) {
      points.push(parseFloat(t.toFixed(3)));
    }
    t += baseInterval + (Math.random() - 0.5) * JITTER * 2;
  }

  return points;
}

/**
 * Build the scale/pad filter for output dimensions.
 * For 9:16 with blurred background: scale original to fit, then overlay on blurred fill.
 */
function buildScaleFilter(outW, outH, keepRatio, srcW, srcH, inputLabel = '[0:v]') {
  if (keepRatio) {
    // Just scale to outW x outH, keeping aspect ratio with black bars
    return `${inputLabel}scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black[scaled]`;
  }

  // 9:16: blur fill + centered original
  const srcAR = srcW / srcH;
  const dstAR = outW / outH;

  if (Math.abs(srcAR - dstAR) < 0.05) {
    // Already roughly 9:16
    return `${inputLabel}scale=${outW}:${outH}[scaled]`;
  }

  // blur background: scale to fill entire outW x outH
  // foreground: scale to fit inside outW x outH
  return (
    `${inputLabel}split[bg][fg];` +
    `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=20:1[blurred];` +
    `[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgscaled];` +
    `[blurred][fgscaled]overlay=(W-w)/2:(H-h)/2[scaled]`
  );
}

/**
 * Build overlay filter for emoji — centered-bottom, 33% of frame height.
 */
function buildEmojiOverlay(outW, outH, emojiLabel, videoLabel) {
  const emojiH = Math.round(outH * 0.33);
  const emojiW = emojiH; // square emoji
  return (
    `${emojiLabel}scale=${emojiW}:${emojiH}[emojiscaled];` +
    `${videoLabel}[emojiscaled]overlay=(W-w)/2:H-h-${Math.round(outH * 0.05)}[withemoji]`
  );
}

async function processNormalSegment(ff, inputName, seg, outFile, outW, outH, keepRatio, srcW, srcH) {
  const scaleFilter = buildScaleFilter(outW, outH, keepRatio, srcW, srcH, '[0:v]');

  await ff.exec([
    '-ss', String(seg.start),
    '-t', String(seg.duration),
    '-i', inputName,
    '-filter_complex', `${scaleFilter}`,
    '-map', '[scaled]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-r', '30',
    '-ar', '44100',
    outFile,
  ]);
}

async function processFreezeSegment(ff, inputName, seg, outFile, outW, outH, keepRatio, srcW, srcH) {
  /**
   * Freeze effect:
   * 1. Extract a single frame at seg.freezeAt (as PNG)
   * 2. Create a looped still video of that frame for seg.duration seconds
   * 3. Apply grayscale + emoji overlay
   * 4. Use the phonk music audio (replacing original video audio)
   */

  const frameFile = outFile + '_frame.png';

  // Step 1: Extract the freeze frame
  await ff.exec([
    '-ss', String(seg.freezeAt),
    '-i', inputName,
    '-vframes', '1',
    '-q:v', '2',
    frameFile,
  ]);

  // Step 2: Build freeze segment with grayscale + emoji overlay + phonk audio
  // Input 0: looped still frame (via loop filter)
  // Input 1: emoji image
  // Input 2: phonk music audio
  const emojiH = Math.round(outH * 0.33);
  const emojiW = emojiH;
  const emojiY = outH - emojiH - Math.round(outH * 0.05);
  const emojiX = Math.round((outW - emojiW) / 2);

  // Scale filter for the still frame
  let scaleExpr;
  if (keepRatio) {
    scaleExpr = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`;
  } else {
    const srcAR = srcW / srcH;
    const dstAR = outW / outH;
    if (Math.abs(srcAR - dstAR) < 0.05) {
      scaleExpr = `[0:v]scale=${outW}:${outH}`;
    } else {
      scaleExpr = (
        `[0:v]split[bg][fg];` +
        `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=20:1[blurred];` +
        `[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgscaled];` +
        `[blurred][fgscaled]overlay=(W-w)/2:(H-h)/2`
      );
    }
  }

  const filterComplex = (
    `${scaleExpr}[framescaled];` +
    `[framescaled]hue=s=0[bw];` +
    `[1:v]scale=${emojiW}:${emojiH}[emojis];` +
    `[bw][emojis]overlay=${emojiX}:${emojiY}[out]`
  );

  await ff.exec([
    '-loop', '1',
    '-i', frameFile,
    '-i', seg.emoji,
    '-i', seg.music,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '2:a',
    '-t', String(seg.duration),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-r', '30',
    '-ar', '44100',
    '-shortest',
    outFile,
  ]);

  try { ff.deleteFile(frameFile); } catch (_) {}
}

async function probeDuration(ff, filename) {
  // Run ffmpeg to stderr-only, read the Duration line
  // We use a trick: try to encode 0 frames and capture log output
  let durationSec = 30; // fallback

  ff.on('log', ({ message }) => {
    const m = message.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) {
      durationSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
    }
  });

  try {
    await ff.exec(['-i', filename, '-t', '0', '-f', 'null', '-']);
  } catch (_) { /* expected to "fail" since output is /dev/null */ }

  return durationSec;
}

async function probeAudioDuration(ff, filename) {
  let dur = 2.0;
  const handler = ({ message }) => {
    const m = message.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) {
      dur = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
    }
  };
  ff.on('log', handler);
  try {
    await ff.exec(['-i', filename, '-t', '0', '-f', 'null', '-']);
  } catch (_) {}
  ff.off('log', handler);
  return dur;
}

async function probeVideoDimensions(ff, filename) {
  let w = 1080, h = 1920;
  const handler = ({ message }) => {
    const m = message.match(/(\d{2,5})x(\d{2,5})/);
    if (m) {
      const pw = parseInt(m[1]);
      const ph = parseInt(m[2]);
      // Sanity check: ignore tiny thumbnail dimensions
      if (pw > 100 && ph > 100) { w = pw; h = ph; }
    }
  };
  ff.on('log', handler);
  try {
    await ff.exec(['-i', filename, '-t', '0', '-f', 'null', '-']);
  } catch (_) {}
  ff.off('log', handler);
  return { w, h };
}
