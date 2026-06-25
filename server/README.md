# 数字人终端 — 语音服务

## 架构

```
Electron 主进程 (electron/main.cjs)
  ├─ 启动编排服务 (Node.js :6080) — 内含 Edge-TTS
  ├─ 启动 ASR 服务 (Python :6090) — Whisper
  └─ 加载前端页面 (dev: Vite / prod: 本地构建)

浏览器 (React)
  ├─ VoiceButton — MediaRecorder 录音 → ASR
  ├─ tts.ts — fetch TTS 音频 → Web Audio 播放 + 口型能量
  └─ ServiceLogPanel — 服务状态和实时日志
```

## 启动

### 开发模式（分多个终端）

```bash
# 终端 1: ASR 语音识别
npm run asr-service

# 终端 2: 编排服务（内置 Edge-TTS）
npm run orchestrator

# 终端 3: 前端开发服务器
npm run dev
```

### 生产模式（Electron 一键启动）

```bash
# 构建前端
npm run build

# 启动 Electron（自动拉起所有服务）
npm run electron
```

Electron 会自动管理编排服务和 ASR 服务的生命周期，无需手动开启终端。

## 设置

在浏览器/Electron 中打开设置：
1. **API 地址** → Hermes/LM Studio 地址
2. **语音服务地址** → `http://localhost:6080`（编排服务）
3. **TTS 音色** → 晓晓/云希等 Edge-TTS 中文音色

## 服务日志

非桌面模式下底部有一个「服务状态」栏，点击可展开查看：
- 各服务运行状态
- 实时日志流
- 按源过滤（编排/ASR/TTS/主进程）
