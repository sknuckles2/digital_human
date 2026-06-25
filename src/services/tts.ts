/**
 * 语音合成服务 — 服务端 TTS API
 *
 * 通过 Orchestrator 编排服务调用 Qwen3-TTS，
 * 使用 Web Audio API 播放，并提取音频能量值用于口型同步。
 */

/** 是否在走代理模式（Vite dev 或 Electron 生产服务器均有代理） */
function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

class TextToSpeechService {
  private isSpeaking = false;
  private onEndCallback: (() => void) | null = null;
  private abortController: AbortController | null = null;

  // Web Audio 播放资源
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private energyTimer: number | null = null;

  /** 口型同步回调 — 由外部（LipSyncEngine）注册 */
  private onEnergyCallback: ((energy: number) => void) | null = null;

  /** 当前语音 */
  private currentVoice = 'Vivian';

  // ==========================================================
  //  配置
  // ==========================================================

  setVoice(voice: string): void {
    this.currentVoice = voice;
  }

  /**
   * 注册音频能量回调
   */
  set onEnergy(callback: ((energy: number) => void) | null) {
    this.onEnergyCallback = callback;
  }

  // ==========================================================
  //  状态
  // ==========================================================

  isSupported(): boolean {
    return true;
  }

  get isActive(): boolean {
    return this.isSpeaking;
  }

  // ==========================================================
  //  核心
  // ==========================================================

  async speak(text: string, onEnd?: () => void): Promise<void> {
    const content = text.trim();
    if (!content) return;

    this.stop();

    const isDev = isDevMode();

    // 从配置读取语音服务地址
    let voiceEndpoint = 'http://localhost:6080';
    let ttsVoice = this.currentVoice;
    try {
      const saved = localStorage.getItem('dh_api_config');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.voiceEndpoint) voiceEndpoint = cfg.voiceEndpoint;
        if (cfg.ttsVoice) ttsVoice = cfg.ttsVoice;
      }
    } catch {}

    const url = isDev
      ? '/api/voice/tts'
      : `${voiceEndpoint}/tts`;

    this.abortController = new AbortController();
    this.onEndCallback = onEnd || null;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isDev ? { 'X-API-Target': voiceEndpoint } : {}),
        },
        body: JSON.stringify({
          text: content,
          voice: ttsVoice,
          language: 'Chinese',
        }),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.warn('[TTS] API error:', resp.status, errText.slice(0, 100));
        this.finish();
        return;
      }

      const blob = await resp.blob();
      if (blob.size === 0) {
        console.warn('[TTS] Empty audio response');
        this.finish();
        return;
      }

      await this.playAudio(blob);
      this.finish();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.finish();
        return;
      }
      console.warn('[TTS] Speak failed:', err.message);
      this.finish();
    }
  }

  stop(): void {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.energyTimer !== null) {
      cancelAnimationFrame(this.energyTimer);
      this.energyTimer = null;
    }

    if (this.abortController) {
      try { this.abortController.abort(); } catch {}
      this.abortController = null;
    }

    this.isSpeaking = false;
    this.onEndCallback = null;
  }

  // ==========================================================
  //  内部
  // ==========================================================

  private async playAudio(blob: Blob): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = audioBuffer;

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.sourceNode.connect(this.analyserNode);
    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    this.isSpeaking = true;
    this.startEnergyAnalysis();

    return new Promise((resolve) => {
      if (!this.sourceNode) {
        resolve();
        return;
      }
      this.sourceNode.onended = () => resolve();
      this.sourceNode.start();
    });
  }

  private startEnergyAnalysis(): void {
    if (!this.analyserNode) return;

    const analyser = this.analyserNode;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!this.isSpeaking || !this.analyserNode) return;

      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const energy = Math.min(1, sum / (dataArray.length * 255) * 2);

      if (this.onEnergyCallback) {
        this.onEnergyCallback(energy);
      }

      this.energyTimer = requestAnimationFrame(tick);
    };

    this.energyTimer = requestAnimationFrame(tick);
  }

  private finish(): void {
    this.isSpeaking = false;

    if (this.energyTimer !== null) {
      cancelAnimationFrame(this.energyTimer);
      this.energyTimer = null;
    }

    this.onEndCallback?.();
    this.onEndCallback = null;

    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
  }
}

export const ttsService = new TextToSpeechService();

export const speak = (text: string, onEnd?: () => void) =>
  ttsService.speak(text, onEnd);
export const stopSpeaking = () => ttsService.stop();
