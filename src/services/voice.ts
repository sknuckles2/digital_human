/**
 * 语音交互引擎
 *
 * 集成了：
 * 1. Porcupine 唤醒词检测（浏览器端，不占服务器资源）
 * 2. MediaRecorder 录音 → ASR 服务
 * 3. 录音 → ASR → LLM → TTS 全流程编排
 */

import type { ApiConfig } from '../types';
import { DEFAULT_API_CONFIG } from '../types';
import { sendStreamMessage } from './hermes';
import { speak, stopSpeaking, ttsService } from './tts';

// ============================================================
//  类型
// ============================================================

export type VoiceStatus =
  | 'idle'           // 空闲
  | 'wake-detected'  // 唤醒词检测到
  | 'listening'      // 录音中
  | 'processing'     // ASR 识别中
  | 'thinking'       // LLM 思考中
  | 'speaking';      // TTS 播放中

export type VoiceEvent =
  | { type: 'status'; status: VoiceStatus }
  | { type: 'asr-result'; text: string }
  | { type: 'error'; message: string };

type VoiceCallback = (event: VoiceEvent) => void;

// ============================================================
//  配置
// ============================================================

function loadConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_API_CONFIG;
}

function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

// ============================================================
//  语音引擎
// ============================================================

class VoiceEngine {
  private status: VoiceStatus = 'idle';
  private callback: VoiceCallback | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private wakeWordEnabled = false;
  private porcupine: any = null;
  private porcupineKeyword: any = null;
  private audioContext: AudioContext | null = null;

  // ==========================================================
  //  状态
  // ==========================================================

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  get isWakeWordEnabled(): boolean {
    return this.wakeWordEnabled;
  }

  /**
   * 注册状态回调
   */
  onEvent(callback: VoiceCallback): void {
    this.callback = callback;
  }

  /**
   * 设置状态并通知
   */
  private setStatus(status: VoiceStatus): void {
    this.status = status;
    this.callback?.({ type: 'status', status });
  }

  // ==========================================================
  //  唤醒词（Porcupine）
  // ==========================================================

  /**
   * 启用/禁用唤醒词检测
   */
  async setWakeWordEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.wakeWordEnabled) return;

    if (enabled) {
      await this.startWakeWordDetection();
    } else {
      this.stopWakeWordDetection();
    }
  }

  private async startWakeWordDetection(): Promise<void> {
    try {
      // Porcupine 使用 WebAssembly 在浏览器端运行
      // 使用 Function 构造函数实现完全动态加载，避免 Vite 静态解析
      // 如果未安装 @picovoice/porcupine-web，唤醒词功能不可用，不影响其他功能
      let PorcupineModule: any;
      try {
        const importModule = new Function('return import("@picovoice/porcupine-web")');
        PorcupineModule = await importModule();
      } catch {
        console.warn('[Voice] @picovoice/porcupine-web not available. Wake word disabled.');
        console.warn('[Voice] Install: npm install @picovoice/porcupine-web');
        this.wakeWordEnabled = false;
        return;
      }

      const Porcupine = PorcupineModule.Porcupine;
      const PorcupineKeyword = PorcupineModule.PorcupineKeyword;

      // 内置唤醒词 "Hey Computer"（英文）或自定义中文
      this.porcupine = await Porcupine.create({
        keywords: [PorcupineKeyword.HeyComputer],
        // 如需自定义中文唤醒词，需要训练并传入 .ppn 文件路径
      });

      // 启动音频流 + 唤醒检测
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext();

      // 连接音频到 Porcupine
      await this.porcupine.start(this.stream, (keywordIndex: number) => {
        console.log('[Voice] Wake word detected:', keywordIndex);
        this.setStatus('wake-detected');

        // 唤醒后自动开始录音
        this.startRecording();
      });

      this.wakeWordEnabled = true;
      console.log('[Voice] Wake word detection started');
    } catch (err) {
      console.warn('[Voice] Wake word init failed (library may not be installed):', err);
      this.wakeWordEnabled = false;
    }
  }

  private stopWakeWordDetection(): void {
    if (this.porcupine) {
      this.porcupine.release();
      this.porcupine = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.wakeWordEnabled = false;
    console.log('[Voice] Wake word detection stopped');
  }

  // ==========================================================
  //  录音
  // ==========================================================

  /**
   * 开始录音（手动触发，或唤醒后自动触发）
   */
  async startRecording(): Promise<void> {
    if (this.status === 'listening') return;

    try {
      this.audioChunks = [];

      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // 选择合适的音频格式
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.processRecording();
      };

      this.mediaRecorder.start();
      this.setStatus('listening');
      console.log('[Voice] Recording started');
    } catch (err) {
      console.error('[Voice] Recording failed:', err);
      this.callback?.({ type: 'error', message: '麦克风启动失败' });
      this.cleanup();
    }
  }

  /**
   * 停止录音
   */
  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      console.log('[Voice] Recording stopped');
    }
  }

  /**
   * 处理录音 → ASR
   */
  private async processRecording(): Promise<void> {
    if (this.audioChunks.length === 0) {
      this.setStatus('idle');
      return;
    }

    this.setStatus('processing');

    try {
      const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });

      // 转为 base64
      const buffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      const config = loadConfig();
      const voiceEndpoint = config.voiceEndpoint || 'http://localhost:6080';
      const isDev = isDevMode();

      // 调用 ASR
      const url = isDev
        ? '/api/voice/asr'
        : `${voiceEndpoint}/asr`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isDev ? { 'X-API-Target': voiceEndpoint } : {}),
        },
        body: JSON.stringify({
          audio_base64: audioBase64,
          format: 'webm',
          language: 'zh',
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        throw new Error(`ASR returned ${resp.status}`);
      }

      const result = await resp.json();
      const text = result.text || '';

      if (!text.trim()) {
        console.log('[Voice] ASR returned empty text');
        this.setStatus('idle');
        return;
      }

      console.log('[Voice] ASR result:', text);
      this.callback?.({ type: 'asr-result', text });

      // 自动进入 LLM 对话流程
      this.setStatus('thinking');
      await this.sendToLLM(text);

    } catch (err: any) {
      console.error('[Voice] ASR failed:', err);
      this.callback?.({ type: 'error', message: err.message || '语音识别失败' });
      this.setStatus('idle');
    } finally {
      this.cleanup();
    }
  }

  // ==========================================================
  //  LLM + TTS 联动
  // ==========================================================

  /**
   * 发送文本到 LLM，流式回复后自动 TTS
   */
  private async sendToLLM(text: string): Promise<void> {
    // 这里的实现依赖于 chat.ts store
    // 为了简化，我们将文本通过回调传出，由外部（App/chat）接管
    // 或者直接调用 hermes 服务

    // 方案：通过回调传出文本，chat store 的 sendMessage 会处理后续
    this.callback?.({
      type: 'asr-result',
      text: `__SEND_TO_LLM__:${text}`,
    });

    // 外部监听到 __SEND_TO_LLM__ 前缀后调用 sendMessage
    this.setStatus('idle');
  }

  // ==========================================================
  //  清理
  // ==========================================================

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  /**
   * 释放所有资源
   */
  destroy(): void {
    this.stopWakeWordDetection();
    this.cleanup();
    this.callback = null;
    this.setStatus('idle');
  }
}

export const voiceEngine = new VoiceEngine();
