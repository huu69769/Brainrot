# PHONK MEME MACHINE 💀

把你的手机视频一键整成 phonk 梗视频的纯前端小工具。

视频在本地浏览器处理，**绝对不上传任何服务器**。

---

## 功能

- 自动在视频中选 3~4 个时间点
- 每个点：画面定格 → 转黑白 → 叠随机表情包 → 炸随机 phonk 配乐
- 音乐放完那一刻，定格硬切结束，恢复正常（戛然而止才是笑点）
- 默认输出竖屏 9:16（横屏视频用模糊背景铺满，不裁画面）
- 上传 / 下载按钮有跳脸彩蛋
- Brainrot / 神人TV 美学

---

## 本地运行

```bash
npm install
npm run dev
```

然后打开 http://localhost:5173

> 注意：需要浏览器支持 SharedArrayBuffer（即 COOP/COEP 响应头）。
> `npm run dev` 已配置好，本地直接能跑。

---

## 部署到 Netlify

```bash
npm run build
```

然后把 `dist/` 目录托管到 Netlify，或者直接连 GitHub 仓库自动部署。
`netlify.toml` 已配好所需响应头。

---

## 替换素材（重要）

所有素材放在 `assets/` 目录下，代码**自动读取**，文件名随意，数量随意。

### 表情包 (`assets/emojis/`)

放入 `.svg` / `.png` / `.jpg` / `.gif` / `.webp` 格式图片即可。
代码会从中随机选取叠加在定格画面上。

**占位素材说明**：现有的 `emoji1.svg` ~ `emoji5.svg` 是用代码生成的几何圆脸，仅作调试用。换上你自己的梗图即可。

### Phonk 配乐 (`assets/music/`)

放入 `.wav` / `.mp3` / `.ogg` / `.m4a` 格式音频。

> ⚠️ 重要：请自行把 phonk 音乐**剪成 1.8~2.5 秒的精华片段**再放进来。
> 代码不做任何截取，整段直接播放。定格时长 = 音频实际时长。

**占位素材**：现有 `phonk1.wav` `phonk2.wav` `phonk3.wav` 是简单正弦波 beep，仅用于验证流程。

### 界面音效 (`assets/sfx/`)

按以下文件名放入音效，代码会自动映射：

| 文件名 | 触发时机 |
|--------|----------|
| `hover.wav` | 鼠标悬停按钮 |
| `click.wav` | 点击按钮 |
| `upload.wav` | 选好视频文件后 |
| `complete.wav` | 视频处理完成 |

格式：`.wav` / `.mp3` / `.ogg`。文件名前缀需与上表一致（不含扩展名）。

**占位素材**：现有文件是简单 beep，换成你自己的怪声效果更佳。

### 装饰图 (`assets/decor/`)

放入任意图片，会自动出现在页面边角作为 brainrot 装饰。
没有文件时页面正常显示，不报错。

建议放一些莫名其妙的 AI 怪图、梗图碎片等。

---

## 版权声明

**请只放置免版权 / CC0 / 已获得授权的音乐、图片和音效素材。**

本项目仅供个人娱乐，不用于商业用途。使用者须自行确保所用素材的合规性。
占位素材（正弦波音频、几何图形 SVG）为代码生成，无版权问题。

---

## 已知限制

- **长视频处理较慢**：ffmpeg.wasm 在浏览器中运行，处理速度约为原生的 1/10。20s 视频约需 30~90 秒处理时间，请耐心等待。
- **低端手机可能内存不足**：ffmpeg.wasm 较占内存，建议在内存 ≥ 3GB 的设备上使用。
- **需要 HTTPS 或 localhost**：SharedArrayBuffer（ffmpeg.wasm 所需）只在安全上下文中可用。
- **Safari iOS 支持**：部分旧版本 iOS Safari 对 WebAssembly 支持有限，建议使用 Chrome for iOS 或升级系统。
- **视频格式**：支持浏览器能读取的主流格式（mp4、mov、webm 等）。

---

## 技术栈

- Vite + 原生 JavaScript（无框架）
- @ffmpeg/ffmpeg 0.12.x（WebAssembly，纯客户端视频处理）
- 纯 HTML/CSS（Brainrot 美学）
- 部署：Netlify 静态托管
