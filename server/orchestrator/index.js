/**
 * 数字人语音编排服务（一体化版）
 *
 * 集成 Edge-TTS 语音合成 + ASR 请求转发 + 日志收集
 * 监听 :6080，由 Electron 主进程自动启动
 *
 * 端点：
 *   POST /tts      — 语音合成（内置 Edge-TTS）
 *   POST /asr      — 语音识别（转发 Python Whisper 服务）
 *   GET  /voices   — 音色列表
 *   GET  /health   — 所有服务健康检查
 *   GET  /logs     — 服务日志流 (SSE)
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.ORCHESTRATOR_PORT || '6080', 10);
const ASR_URL = process.env.ASR_URL || 'http://127.0.0.1:6090';
const EDGE_TTS_CMD = process.env.EDGE_TTS_CMD || 'edge-tts';

// ============================================================
//  日志系统（内存环形缓冲区 + 文件）
// ============================================================

const LOG_DIR = join(__dirname, '..', '..', 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const logFile = createWriteStream(join(LOG_DIR, 'orchestrator.log'), { flags: 'a' });
const MAX_LOG_ENTRIES = 500;
const logBuffer = [];
let logId = 0;
let sseClients = [];

function emitLog(level, source, message) {
  const entry = {
    id: ++logId,
    ts: new Date().toISOString(),
    level,
    source,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  logFile.write(`[${entry.ts}] [${level.toUpperCase()}] [${source}] ${message}\n`);

  // SSE 推送
  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {}
  }
}

const log = {
  info: (source, msg) => emitLog('info', source, msg),
  warn: (source, msg) => emitLog('warn', source, msg),
  error: (source, msg) => emitLog('error', source, msg),
};

// ============================================================
//  Edge-TTS 语音合成（内置，不依赖 Python 服务）
// ============================================================

/** 预设中文音色 */
const PRESET_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（温暖女声）', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', name: '云希（阳光男声）', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊（活泼女声）', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunyangNeural', name: '云扬（专业男声）', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻（台湾国语女声）', locale: 'zh-TW', gender: 'female' },
  { id: 'zh-TW-HsiaoYuNeural', name: '晓雨（台湾国语女声）', locale: 'zh-TW', gender: 'female' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma（多语言女声）', locale: 'en-US', gender: 'female' },
];

/**
 * 调用 edge-tts 命令行生成音频
 */
function generateEdgeTTS(text, voice = 'zh-CN-XiaoxiaoNeural', rate = 0) {
  return new Promise((resolve, reject) => {
    const args = ['--voice', voice, '--text', text];
    if (rate !== 0) args.push('--rate', `${rate > 0 ? '+' : ''}${rate}%`);

    log.info('TTS', `edge-tts ${voice} '${text.slice(0, 30)}...'`);

    const proc = spawn(EDGE_TTS_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log.warn('TTS', msg);
    });

    proc.on('error', (err) => {
      log.error('TTS', `启动失败: ${err.message}`);
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const buf = Buffer.concat(chunks);
        log.info('TTS', `完成: ${buf.length} bytes`);
        resolve(buf);
      } else {
        const err = new Error(`edge-tts exited with code ${code}`);
        log.error('TTS', err.message);
        reject(err);
      }
    });
  });
}

// ============================================================
//  预设音色（含中文）
// ============================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
//  POST /tts — 语音合成（Edge-TTS）
// ============================================================

app.post('/tts', async (req, res) => {
  const { text, voice, rate } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }

  try {
    const audioBuffer = await generateEdgeTTS(text.trim(), voice || 'zh-CN-XiaoxiaoNeural', rate || 0);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.end(audioBuffer);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'TTS failed', detail: err.message });
    }
  }
});

// ============================================================
//  POST /asr — 语音识别（转发 Whisper 服务）
// ============================================================

app.post('/asr', async (req, res) => {
  const { audio_base64, format, language } = req.body || {};
  if (!audio_base64) {
    return res.status(400).json({ error: 'Missing audio_base64' });
  }

  log.info('ASR', `收到 ${(audio_base64.length / 1024).toFixed(0)}KB 音频`);

  try {
    const resp = await fetch(`${ASR_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Audio-Language': language || 'zh' },
      body: Buffer.from(audio_base64, 'base64'),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.error('ASR', `返回 ${resp.status}: ${errText.slice(0, 100)}`);
      return res.status(502).json({ error: `ASR error: ${resp.status}` });
    }

    const result = await resp.json();
    log.info('ASR', `识别: '${result.text?.slice(0, 40) || ''}'`);
    res.json(result);
  } catch (err) {
    log.error('ASR', `请求失败: ${err.message}`);
    res.status(502).json({ error: 'ASR request failed', detail: err.message });
  }
});

// ============================================================
//  GET /voices — 音色列表
// ============================================================

app.get('/voices', (_req, res) => {
  res.json({ voices: PRESET_VOICES });
});

// ============================================================
//  GET /health — 健康检查
// ============================================================

app.get('/health', async (_req, res) => {
  let asrOk = false;
  try {
    const r = await fetch(`${ASR_URL}/health`, { signal: AbortSignal.timeout(3000) });
    asrOk = r.ok;
  } catch {}

  const memory = process.memoryUsage();
  res.json({
    ok: true,
    tts: { ok: true, engine: 'edge-tts', voices: PRESET_VOICES.length },
    asr: { ok: asrOk, url: ASR_URL },
    uptime: process.uptime(),
    memory: {
      rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
      heap: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
    },
  });
});

// ============================================================
//  GET /logs — 日志流（SSE）
// ============================================================

app.get('/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // 发送历史日志
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // 添加到实时推送
  sseClients.push(res);
  log.info('LOGS', `新客户端连接 (共 ${sseClients.length} 个)`);

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
    log.info('LOGS', `客户端断开 (剩余 ${sseClients.length} 个)`);
  });
});

// ============================================================
//  启动
// ============================================================

app.listen(PORT, () => {
  log.info('SERVICE', `═══════════════════════════════════════`);
  log.info('SERVICE', `  Orchestrator :${PORT}`);
  log.info('SERVICE', `  TTS          Edge-TTS (内置)`);
  log.info('SERVICE', `  ASR          ${ASR_URL}`);
  log.info('SERVICE', `═══════════════════════════════════════`);
  log.info('SERVICE', `  POST /tts     — 语音合成`);
  log.info('SERVICE', `  POST /asr     — 语音识别`);
  log.info('SERVICE', `  GET  /voices  — 音色列表`);
  log.info('SERVICE', `  GET  /health  — 健康检查`);
  log.info('SERVICE', `  GET  /logs    — 日志流 (SSE)`);
  log.info('SERVICE', `═══════════════════════════════════════`);
});
