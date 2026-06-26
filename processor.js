/**
 * processor.js
 * ffmpeg.wasm video processing — slice → process → concat approach.
 *
 * Key design decisions:
 * - Each segment is encoded separately with identical codec params so
 *   the final concat demuxer can copy streams without re-encoding.
 * - ff.exec() does NOT throw on ffmpeg error; it returns the exit code.
 *   We wrap it in execFF() which throws on non-zero so failures are caught.
 * - Emoji overlay uses PNG (not SVG — ffmpeg.wasm has no SVG decoder).
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
}

/** Throw if ffmpeg exits non-zero so failures are never silently swallowed. */
async function execFF(ff, args) {
  const code = await ff.exec(args);
  if (code !== 0) {
    throw new Error(`ffmpeg error (exit ${code}) for: ${args.slice(0, 6).join(' ')}…`);
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * @param {File}     videoFile
 * @param {string[]} emojiPaths  - asset URLs (PNG)
 * @param {string[]} musicPaths  - asset URLs (WAV/MP3)
 * @param {object}   opts
 */
export async function processVideo(videoFile, emojiPaths, musicPaths, opts = {}) {
  const {
    baseInterval = 6,
    keepRatio = false,
    onProgress = () => {},
    onStatus = () => {},
  } = opts;

  onStatus('加载 ffmpeg.wasm…');
  onProgress(0.02);
  const ff = await loadFFmpeg();

  ff.on('progress', ({ progress }) => {
    onProgress(0.15 + Math.min(Math.max(progress, 0), 1) * 0.76);
  });

  // ── Write input video ────────────────────────────────────
  onStatus('读取视频文件…');
  onProgress(0.05);
  const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
  const inputName = `input.${ext}`;
  ff.writeFile(inputName, await fetchFile(videoFile));

  // ── Probe video ──────────────────────────────────────────
  onStatus('分析视频…');
  const { duration, width: srcW, height: srcH, hasAudio } = await probeMedia(ff, inputName);
  onStatus(`${duration.toFixed(1)}s · ${srcW}×${srcH} · 音频:${hasAudio ? '✓' : '✗'}`);
  onProgress(0.08);

  // ── Output dimensions ────────────────────────────────────
  let outW, outH;
  if (keepRatio) {
    outW = srcW % 2 === 0 ? srcW : srcW - 1;
    outH = srcH % 2 === 0 ? srcH : srcH - 1;
  } else {
    // Default: 9:16 portrait
    outH = Math.min(Math.max(srcH, srcW), 1280); // cap at 1280
    if (outH % 2 !== 0) outH--;
    outW = Math.round(outH * 9 / 16);
    if (outW % 2 !== 0) outW--;
  }

  // ── 预先探测所有音乐时长，用于计算真实间隔 ─────────────────
  onStatus('探测音乐时长…');
  onProgress(0.10);

  // 加载最多 8 段素材备用（足够覆盖任何长度视频）
  const MAX_SLOTS = 8;
  const emojiFiles = [];
  const musicFiles = [];
  const musicDurs  = [];

  for (let i = 0; i < MAX_SLOTS; i++) {
    const ep = emojiPaths[Math.floor(Math.random() * emojiPaths.length)];
    const mp = musicPaths[Math.floor(Math.random() * musicPaths.length)];
    const en = `emoji_${i}.png`;
    const mn = `music_${i}.wav`;
    ff.writeFile(en, await fetchFile(ep));
    ff.writeFile(mn, await fetchFile(mp));
    emojiFiles.push(en);
    musicFiles.push(mn);
    musicDurs.push(await probeAudioDuration(ff, mn));
  }
  onProgress(0.13);

  // ── Build timeline（间隔从上一段音乐结束后开始计算）────────
  // 间隔 = 音乐结束 → 下一个定格点，保证正常画面有足够呼吸感
  const MIN_GAP   = 3;
  const margin     = duration * 0.10;
  const jitter     = Math.min(1.5, baseInterval * 0.25);

  const segments = [];
  let videoPos = 0;   // 原视频已处理到的位置（不含冻帧插入的时间）
  let slotIdx = 0;    // 用第几个素材槽

  // 第一个定格点：从开头留白后开始（以原视频时间计）
  let nextFreeze = margin + baseInterval * 0.5 + (Math.random() - 0.5) * jitter * 2;

  while (nextFreeze < duration - margin && slotIdx < MAX_SLOTS) {
    const fd = musicDurs[slotIdx];

    // 正常片段：原视频 videoPos → nextFreeze
    if (nextFreeze > videoPos + 0.05) {
      segments.push({ type: 'normal', start: videoPos, duration: nextFreeze - videoPos });
    }

    // 定格片段：冻住 nextFreeze 那一帧，插入 fd 秒
    segments.push({
      type: 'freeze',
      freezeAt: nextFreeze,
      duration: fd,
      emoji: emojiFiles[slotIdx],
      music: musicFiles[slotIdx],
      frameFile: `frame_${slotIdx}.png`,
    });

    // 定格结束后，原视频从 nextFreeze 继续（不跳过任何内容）
    videoPos = nextFreeze;
    slotIdx++;

    // 下一个定格点：从 nextFreeze 再往后等 baseInterval ± jitter
    nextFreeze = videoPos + baseInterval + (Math.random() - 0.5) * jitter * 2;
    if (nextFreeze - videoPos < MIN_GAP) nextFreeze = videoPos + MIN_GAP;
  }

  // 最后一段正常画面：原视频 videoPos → 结尾
  if (videoPos < duration - 0.05) {
    segments.push({ type: 'normal', start: videoPos, duration: duration - videoPos });
  }

  onStatus(`${slotIdx} 处定格效果`);

  // ── Encode each segment ──────────────────────────────────
  const segFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const out = `seg_${i}.mp4`;
    onStatus(`编码片段 ${i + 1}/${segments.length}…`);
    if (seg.type === 'normal') {
      await encodeNormal(ff, inputName, seg, out, outW, outH, keepRatio, srcW, srcH, hasAudio);
    } else {
      // Extract freeze frame from source video
      await execFF(ff, [
        '-ss', String(seg.freezeAt),
        '-i', inputName,
        '-vframes', '1',
        '-f', 'image2',
        seg.frameFile,
      ]);
      await encodeFreeze(ff, seg, out, outW, outH, keepRatio, srcW, srcH);
      try { ff.deleteFile(seg.frameFile); } catch (_) {}
    }
    segFiles.push(out);
    onProgress(0.13 + (i + 1) / segments.length * 0.76);
  }

  // ── Concat ───────────────────────────────────────────────
  onStatus('拼接所有片段…');
  ff.writeFile('concat.txt', segFiles.map(f => `file '${f}'`).join('\n'));

  await execFF(ff, [
    '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
    '-c', 'copy',
    '-movflags', '+faststart',
    'output.mp4',
  ]);

  // ── Read result ──────────────────────────────────────────
  onStatus('读取输出…');
  onProgress(0.97);
  const data = await ff.readFile('output.mp4');
  const blob = new Blob([data.buffer], { type: 'video/mp4' });

  // Cleanup virtual FS
  const frameFiles = segments.filter(s => s.type === 'freeze').map(s => s.frameFile);
  const toDelete = [inputName, 'concat.txt', 'output.mp4', ...segFiles, ...emojiFiles, ...musicFiles, ...frameFiles];
  for (const f of toDelete) { try { ff.deleteFile(f); } catch (_) {} }

  onStatus('✅ 完成！');
  onProgress(1.0);
  return blob;
}

// ── Segment encoders ──────────────────────────────────────

async function encodeNormal(ff, inputName, seg, outFile, outW, outH, keepRatio, srcW, srcH, hasAudio) {
  const needsBlur = !keepRatio && Math.abs(srcW / srcH - outW / outH) > 0.05;
  const dur = seg.duration.toFixed(6);

  if (!needsBlur) {
    // Simple -vf path (no complex filter needed)
    const vf = keepRatio
      ? `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`
      : `scale=${outW}:${outH}`;

    const args = [
      '-ss', String(seg.start), '-t', dur,
      '-i', inputName,
      ...(hasAudio ? [] : ['-f', 'lavfi', '-t', dur, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']),
      '-vf', vf,
      '-map', '0:v:0',
      '-map', hasAudio ? '0:a:0' : '1:a:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', '30', '-ar', '44100', '-ac', '2',
      '-pix_fmt', 'yuv420p',
      '-t', dur,
      outFile,
    ];
    await execFF(ff, args);
    return;
  }

  // Landscape → portrait: blur background via filter_complex
  const fc = [
    `[0:v]split[bg][fg]`,
    `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=20:1[blurred]`,
    `[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgsc]`,
    `[blurred][fgsc]overlay=(W-w)/2:(H-h)/2[vout]`,
  ].join(';');

  const audioInputs = hasAudio ? [] : ['-f', 'lavfi', '-t', dur, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const audioMap = hasAudio ? ['0:a:0'] : ['1:a:0'];

  await execFF(ff, [
    '-ss', String(seg.start), '-t', dur,
    '-i', inputName,
    ...audioInputs,
    '-filter_complex', fc,
    '-map', '[vout]', '-map', ...audioMap,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-r', '30', '-ar', '44100', '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-t', dur,
    outFile,
  ]);
}

async function encodeFreeze(ff, seg, outFile, outW, outH, keepRatio, srcW, srcH) {
  // The frame was extracted just before this call (stored as seg.frameFile)
  const frameFile = seg.frameFile;
  const dur = seg.duration.toFixed(6);

  const emojiSz = Math.round(outH * 0.33);
  const emojiX  = Math.round((outW - emojiSz) / 2);
  const emojiY  = outH - emojiSz - Math.round(outH * 0.05);

  // Scale filter for the still frame
  let frameScale;
  const needsBlur = !keepRatio && Math.abs(srcW / srcH - outW / outH) > 0.05;
  if (keepRatio) {
    frameScale = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black[framefill]`;
  } else if (!needsBlur) {
    frameScale = `[0:v]scale=${outW}:${outH}[framefill]`;
  } else {
    frameScale = [
      `[0:v]split[bg][fg]`,
      `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=20:1[blurred]`,
      `[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgsc]`,
      `[blurred][fgsc]overlay=(W-w)/2:(H-h)/2[framefill]`,
    ].join(';');
  }

  const fc = [
    frameScale,
    `[framefill]hue=s=0[bw]`,
    `[1:v]scale=${emojiSz}:${emojiSz}[em]`,
    `[bw][em]overlay=${emojiX}:${emojiY}[vout]`,
  ].join(';');

  await execFF(ff, [
    '-loop', '1', '-i', frameFile,   // 0: looped still frame
    '-i', seg.emoji,                  // 1: emoji PNG
    '-i', seg.music,                  // 2: phonk audio
    '-filter_complex', fc,
    '-map', '[vout]',
    '-map', '2:a:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-r', '30', '-ar', '44100', '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-t', dur,
    '-shortest',
    outFile,
  ]);
}

// ── Freeze points ─────────────────────────────────────────

function computeFreezePoints(duration, baseInterval) {
  const MIN_GAP = 3;
  const margin  = duration * 0.10;
  const jitter  = Math.min(1.5, baseInterval * 0.25);
  const points  = [];

  let t = margin + baseInterval * 0.5 + (Math.random() - 0.5) * jitter * 2;
  while (t < duration - margin) {
    const last = points[points.length - 1] ?? -Infinity;
    if (t - last >= MIN_GAP) points.push(parseFloat(t.toFixed(3)));
    t += baseInterval + (Math.random() - 0.5) * jitter * 2;
  }
  return points;
}

// ── Probing helpers ───────────────────────────────────────

async function probeMedia(ff, filename) {
  const info = { duration: 30, width: 1080, height: 1920, hasAudio: false };

  const handler = ({ message }) => {
    const dm = message.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (dm) info.duration = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);

    // Match dimension in "Video: codec ..., WxH" lines
    const vm = message.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
    if (vm) {
      const w = parseInt(vm[1]), h = parseInt(vm[2]);
      if (w > 100 && h > 100) { info.width = w; info.height = h; }
    }

    if (/Audio:/.test(message)) info.hasAudio = true;
  };

  ff.on('log', handler);
  try { await ff.exec(['-i', filename, '-t', '0', '-f', 'null', '-']); } catch (_) {}
  ff.off('log', handler);
  return info;
}

async function probeAudioDuration(ff, filename) {
  let dur = 2.0;
  const handler = ({ message }) => {
    const m = message.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) dur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  };
  ff.on('log', handler);
  try { await ff.exec(['-i', filename, '-t', '0', '-f', 'null', '-']); } catch (_) {}
  ff.off('log', handler);
  return dur;
}
