/**
 * 语音录制按钮（本地 Whisper ASR）
 *
 * 使用 MediaRecorder 录制麦克风音频 → 发送到本地 Whisper ASR 服务
 * 不依赖浏览器 SpeechRecognition API，也不依赖谷歌服务
 */
import { useState, useRef, useCallback } from 'react';
import Icon from './Icon';

interface VoiceButtonProps {
  onResult: (text: string) => void;
  disabled?: boolean;
  tooltip?: string;
}

/** 从 localStorage 读取编排服务地址 */
function getVoiceEndpoint(): string {
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) {
      const cfg = JSON.parse(saved);
      if (cfg.voiceEndpoint) return cfg.voiceEndpoint;
    }
  } catch {}
  return 'http://localhost:6080';
}

/** 是否在 Vite dev 模式（走代理） */
function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'error';

export default function VoiceButton({ onResult, disabled, tooltip }: VoiceButtonProps) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [denied, setDenied] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isListening = status === 'listening';
  const isProcessing = status === 'processing';
  const micAvailable = !!navigator.mediaDevices?.getUserMedia;

  /** 开始录音 */
  const startRecord = useCallback(async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setDenied(true);
          setStatus('idle');
          console.warn('[Voice] Microphone permission denied');
          return;
        }
        throw err;
      }

      setDenied(false);
      setStatus('listening');
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/wav';

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (chunksRef.current.length === 0) {
          setStatus('idle');
          return;
        }

        setStatus('processing');
        await sendToASR();
      };

      recorderRef.current = recorder;
      recorder.start();
    } catch (err) {
      console.error('[Voice] Recording failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }, []);

  /** 停止录音 → 自动触发 ASR */
  const stopRecord = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  /** 发送音频到 ASR 服务 */
  const sendToASR = async () => {
    try {
      const audioBlob = new Blob(chunksRef.current, {
        type: recorderRef.current?.mimeType || 'audio/webm',
      });

      const buffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      const endpoint = getVoiceEndpoint();
      const isDev = isDevMode();

      const url = isDev
        ? '/api/voice/asr'
        : `${endpoint.replace(/\/$/, '')}/asr`;

      console.log('[Voice] Sending to ASR:', audioBase64.length, 'bytes');

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isDev ? { 'X-API-Target': endpoint } : {}),
        },
        body: JSON.stringify({ audio_base64: audioBase64,
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
        console.log('[Voice] ASR returned empty');
        setStatus('idle');
        return;
      }

      console.log('[Voice] ASR result:', text);
      onResult(text);
      setStatus('idle');
    } catch (err: any) {
      console.error('[Voice] ASR failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  /** 点击切换录音/停止 */
  const handleClick = useCallback(() => {
    if (disabled || isProcessing) return;

    if (isListening) {
      stopRecord();
    } else {
      startRecord();
    }
  }, [disabled, isListening, isProcessing, startRecord, stopRecord]);

  return (
    <button
      className={`voice-btn ${isListening ? 'listening' : ''} ${denied ? 'denied' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      disabled={!micAvailable}
      title={
        !micAvailable
          ? '浏览器不支持麦克风'
          : denied
            ? '⚠ 麦克风被拒绝，请在浏览器地址栏左侧 🔒 中开启麦克风权限后重试'
            : disabled
              ? '思考中，请等待...'
              : isListening
                ? '点击停止'
                : '点击开始录音'
      }
    >
      <span className="voice-icon">
        {isListening ? (
          <Icon name="mic" style={{ color: '#f87171' }} />
        ) : denied ? (
          '🚫'
        ) : (
          <Icon name="mic" />
        )}
      </span>
      <span className="voice-label">
        {isListening ? '录音中...' : isProcessing ? '识别中...' : denied ? '权限被拒' : !micAvailable ? '不支持' : disabled ? '思考中' : '语音'}
      </span>
    </button>
  );
}
