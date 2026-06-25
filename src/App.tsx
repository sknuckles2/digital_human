import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import ChatPanel from './components/ChatPanel';
import VoiceButton from './components/VoiceButton';
import InputBar from './components/InputBar';
import Settings from './components/Settings';
import ErrorBoundary from './components/ErrorBoundary';
import SpeechBubble from './components/SpeechBubble';
import ChatOverlay from './components/ChatOverlay';
import Icon from './components/Icon';
import ServiceLogPanel from './components/ServiceLogPanel';
import { useChatStore } from './store/chat';
import { voiceEngine } from './services/voice';
import './App.css';

// 懒加载 Live2DCanvas — 避免 Cubism SDK 初始化阻塞主渲染
const Live2DCanvas = lazy(() => import('./components/Live2DCanvas'));

/** Live2D 加载中占位 */
function Live2DLoadingFallback() {
  return (
    <div className="live2d-container">
      <div className="live2d-placeholder">
        <div className="l2d-loading-spinner" />
        <p>加载数字人中...</p>
      </div>
    </div>
  );
}

console.log('[Terminal] App rendered');

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const [showFloatBar, setShowFloatBar] = useState(false);
  const [modelKey, setModelKey] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [sttText, setSttText] = useState('');
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [showDesktopInput, setShowDesktopInput] = useState(false);
  const [desktopInputText, setDesktopInputText] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [charSize, setCharSize] = useState<'small' | 'medium' | 'large'>('small');
  const inputRef = useRef<HTMLInputElement>(null);

  // 桌面模式窗口尺寸映射
  const desktopSizes: Record<string, { w: number; h: number }> = {
    small: { w: 260, h: 380 },
    medium: { w: 520, h: 560 },
    large: { w: 780, h: 740 },
  };
  const { sendMessage, isThinking } = useChatStore();
  const floatBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 检测 Electron 环境
  const isElectron = new URLSearchParams(window.location.search).get('electron') === '1'
    || (window as any).electronAPI?.isElectron === true;

  // 桌面模式切换（带淡入淡出）
  const toggleDesktop = () => {
    const next = !desktopMode;
    // 先淡出，再切换
    setIsFadingOut(true);
    setTimeout(() => {
      setDesktopMode(next);
      document.body.classList.toggle('desktop-mode', next);
      document.documentElement.classList.toggle('desktop-mode', next);
      const api = (window as any).electronAPI;
      if (api?.resizeWindow) {
        const ds = desktopSizes[charSize];
        api.resizeWindow(next ? ds.w : 780, next ? ds.h : 620, next);
      }
      // 桌面模式立即置顶，非桌面模式取消置顶
      if (api?.setAlwaysOnTop) {
        api.setAlwaysOnTop(next ? alwaysOnTop : false);
      }
      setModelKey((k) => k + 1);
      if (next) {
        setShowFloatBar(true);
        setTimeout(() => setShowFloatBar(false), 3000);
      }
      setTimeout(() => setIsFadingOut(false), 600);
    }, 350);
  };

  // 浮入触发区/工具栏 → 立即显示，取消待执行的淡出
  const handleFloatBarMouseEnter = () => {
    if (floatBarTimer.current) clearTimeout(floatBarTimer.current);
    setShowFloatBar(true);
  };

  // 离开工具栏 → 短暂延时后淡出
  const handleFloatBarMouseLeave = () => {
    floatBarTimer.current = setTimeout(() => setShowFloatBar(false), 10000);
  };

  // 桌面模式：鼠标移到底部 80px 内自动浮现工具栏
  useEffect(() => {
    if (!desktopMode) return;
    let wasNearBottom = false;
    const onMouseMove = (e: MouseEvent) => {
      const nearBottom = window.innerHeight - e.clientY <= 80;
      if (nearBottom) {
        wasNearBottom = true;
        if (floatBarTimer.current) clearTimeout(floatBarTimer.current);
        setShowFloatBar(true);
      } else if (wasNearBottom) {
        // 刚离开底部区域 → 启动淡出定时器
        wasNearBottom = false;
        if (!floatBarTimer.current) {
          floatBarTimer.current = setTimeout(() => setShowFloatBar(false), 10000);
        }
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [desktopMode]);

  // 模型配置变更 → 递增 key 触发 Live2DCanvas 完全重载
  const handleConfigSaved = () => {
    setModelKey((k) => k + 1);
  };

  // 手动重新加载模型
  const handleReloadModel = () => {
    setModelKey((k) => k + 1);
    // 打印当前 localStorage 中的模型路径，方便调试
    try {
      const saved = localStorage.getItem('dh_api_config');
      if (saved) {
        const config = JSON.parse(saved);
        console.log('[Model] Current config path:', config.modelPath);
      }
    } catch {}
  };

  // 完全刷新页面（Electron 中没有 F5，加一个按钮）
  const handleFullReload = () => {
    window.location.reload();
  };

  // 桌面模式交互按钮：单击弹输入框，长按切换键盘/话筒模式
  const handleInteractionBtnMouseDown = () => {
    const timer = setTimeout(() => {
      // 长按 ≥500ms → 切换输入模式
      setInputMode((m) => m === 'text' ? 'voice' : 'text');
    }, 500);
    const onMouseUp = () => {
      clearTimeout(timer);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mouseup', onMouseUp);
  };

  // 带淡入淡出的模型重载
  const transitionModel = (fn: () => void) => {
    setIsFadingOut(true);
    setTimeout(() => {
      fn();
      setModelKey((k) => k + 1);
      setTimeout(() => setIsFadingOut(false), 600);
    }, 350);
  };

  // 循环切换桌面模式窗口尺寸：小→中→大→小
  const cycleCharSize = () => {
    transitionModel(() => {
      const labels = ['small', 'medium', 'large'] as const;
      const idx = labels.indexOf(charSize);
      const next = labels[(idx + 1) % labels.length];
      setCharSize(next);
      const api = (window as any).electronAPI;
      if (api?.resizeWindow) {
        api.resizeWindow(desktopSizes[next].w, desktopSizes[next].h, true, false);
      }
    });
  };

  // 桌面模式话筒：用 MediaRecorder 录音 → ASR
  const startDesktopVoiceInput = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mimeType });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const audioBase64 = btoa(binary);

        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        let endpoint = 'http://localhost:6080';
        try {
          const saved = localStorage.getItem('dh_api_config');
          if (saved) { const c = JSON.parse(saved); if (c.voiceEndpoint) endpoint = c.voiceEndpoint; }
        } catch {}

        const url = isDev ? '/api/voice/asr' : `${endpoint}/asr`;
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(isDev ? { 'X-API-Target': endpoint } : {}) },
            body: JSON.stringify({ audio_base64: audioBase64, format: 'webm', language: 'zh' }),
            signal: AbortSignal.timeout(30000),
          });
          if (resp.ok) {
            const result = await resp.json();
            if (result.text?.trim()) sendMessage(result.text.trim());
          }
        } catch (e) { console.error('[Voice] Desktop ASR failed:', e); }
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 5000);
    } catch (e) {
      console.error('[Voice] Desktop mic failed:', e);
    }
  }, [sendMessage]);

  const handleInteractionBtnClick = () => {
    if (inputMode === 'text') {
      // 键盘模式：弹出文字输入框
      setDesktopInputText('');
      setShowDesktopInput(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // 话筒模式：直接启动语音输入
      startDesktopVoiceInput();
    }
  };

  // 切换窗口置顶（非桌面模式仅记录偏好，不操作实际窗口）
  const handleTogglePin = () => {
    const api = (window as any).electronAPI;
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    // 如果在桌面模式，立即应用到窗口
    if (desktopMode && api?.setAlwaysOnTop) {
      api.setAlwaysOnTop(next);
    }
  };

  // Electron 环境自动进入桌面模式
  useEffect(() => {
    if (isElectron) {
      setDesktopMode(true);
      document.body.classList.add('desktop-mode');
      document.documentElement.classList.add('desktop-mode');
      const api = (window as any).electronAPI;
      if (api?.resizeWindow) {
        const ds = desktopSizes[charSize];
        api.resizeWindow(ds.w, ds.h, true);
      }
      // 桌面模式自动置顶
      if (api?.setAlwaysOnTop) {
        api.setAlwaysOnTop(true);
        setAlwaysOnTop(true);
      }
      setShowFloatBar(true);
      setTimeout(() => setShowFloatBar(false), 3000);
      setModelKey((k) => k + 1);
    }
  }, [isElectron]);

  // 监听 Electron 置顶状态变化
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onAlwaysOnTopChanged) {
      api.onAlwaysOnTopChanged((top: boolean) => {
        setAlwaysOnTop(top);
        // 状态变更由 data-tooltip 反映
      });
    }
  }, []);

  // 组件卸载时恢复 body
  useEffect(() => {
    return () => document.body.classList.remove('desktop-mode');
  }, []);

  // 语音识别结果 → 发送对话
  useEffect(() => {
    if (sttText.trim()) {
      sendMessage(sttText.trim());
      setSttText('');
    }
  }, [sttText, sendMessage]);

  // 连接语音引擎 → 对话流程
  useEffect(() => {
    voiceEngine.onEvent((event) => {
      if (event.type === 'asr-result' && event.text.startsWith('__SEND_TO_LLM__:')) {
        const text = event.text.replace('__SEND_TO_LLM__:', '');
        if (text.trim()) {
          sendMessage(text.trim());
        }
      }
    });
  }, [sendMessage]);

  return (
    <div className={`app-container ${desktopMode ? 'desktop-active' : ''}`}>
      {/* 窗口标题栏（非桌面模式） */}
      {!desktopMode && (
        <div className="window-titlebar">
          <div className="titlebar-drag" />
          <div className="titlebar-buttons">
            <button className="titlebar-btn titlebar-close" onClick={() => setShowCloseConfirm(true)}>
              ✕
            </button>
          </div>
        </div>
      )}
      {/* 主区域 */}
      <div className="main-area">
        {/* Live2D 数字人 */}
        <div className="avatar-area">
          {/* 桌面模式拖拽层（避开底部触发区 22px） */}
          {desktopMode && <div className="avatar-drag-area" />}
          <ErrorBoundary>
            <Suspense fallback={<Live2DLoadingFallback />}>
              <Live2DCanvas reloadKey={modelKey} fadingOut={isFadingOut} />
            </Suspense>
          </ErrorBoundary>
          {desktopMode && <SpeechBubble />}
          {!desktopMode && (
            <div className="avatar-status">
              {isThinking ? '思考中...' : '聆听中...'}
            </div>
          )}
        </div>

        {/* 桌面模式：点击角色弹出的文字输入框 */}
        {desktopMode && showDesktopInput && (
          <div className="desktop-input-overlay" onClick={() => setShowDesktopInput(false)}>
            <div
              className="desktop-input-popup"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                className="desktop-input-field"
                type="text"
                value={desktopInputText}
                onChange={(e) => setDesktopInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && desktopInputText.trim()) {
                    sendMessage(desktopInputText.trim());
                    setDesktopInputText('');
                    setShowDesktopInput(false);
                  }
                  if (e.key === 'Escape') {
                    setShowDesktopInput(false);
                  }
                }}
                placeholder="输入消息..."
              />
            </div>
          </div>
        )}

        {/* 右侧：聊天面板（桌面模式下隐藏） */}
        {!desktopMode && (
          <div className="chat-area">
            <ErrorBoundary>
              <ChatPanel />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* 服务日志面板（非桌面模式） */}
      {!desktopMode && <ServiceLogPanel />}

      {/* 底部控制栏（桌面模式下隐藏） */}
      {!desktopMode && (
        <div className="control-bar">
          <div className="control-left">
            <div className="app-title">✦ 数字人终端</div>
          </div>
          <div className="control-center">
            <VoiceButton onResult={setSttText} disabled={isThinking} />
            <InputBar onSend={(text) => sendMessage(text)} disabled={isThinking} />
          </div>
          <div className="control-right">
            <button
              className={`settings-btn${alwaysOnTop ? ' pin-active' : ''}`}
              onClick={handleTogglePin}
              data-tooltip={alwaysOnTop ? '已置顶：点击取消' : '桌面角色置顶'}
            >
              <Icon name="pin" />
            </button>
            <button
              className="settings-btn"
              onClick={handleReloadModel}
              data-tooltip="重新加载模型"
            >
              <Icon name="reload-model" />
            </button>
            <button
              className="settings-btn"
              onClick={() => setShowSettings(true)}
              data-tooltip="设置"
            >
              <Icon name="settings" />
            </button>
            <button
              className="desktop-toggle-btn"
              onClick={toggleDesktop}
              data-tooltip="切换到桌面模式"
            >
              <Icon name="desktop" />
            </button>
          </div>
        </div>
      )}

      {desktopMode && (
        <div
          className={`desktop-float-bar ${showFloatBar ? 'visible' : ''}`}
          onMouseEnter={handleFloatBarMouseEnter}
          onMouseLeave={handleFloatBarMouseLeave}
        >
          <div className="desktop-float-inner">
            <button
              className={`desktop-float-btn interaction-btn ${inputMode === 'voice' ? 'mic-mode' : ''}`}
              onClick={handleInteractionBtnClick}
              onMouseDown={handleInteractionBtnMouseDown}
              data-tooltip="长按语音对话"
              aria-label={inputMode === 'text' ? '键盘输入' : '语音输入'}
            >
              {inputMode === 'text' ? '⌨' : '🎤'}
            </button>
            <button
              className="desktop-float-btn"
              onClick={cycleCharSize}
              data-tooltip={`角色尺寸: ${charSize === 'small' ? '小' : charSize === 'medium' ? '中' : '大'}`}
              aria-label="切换角色尺寸"
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                {charSize === 'small' ? 'S' : charSize === 'medium' ? 'M' : 'L'}
              </span>
            </button>
            <button
              className="desktop-float-btn"
              onClick={() => setShowDesktopInput((v) => !v)}
              data-tooltip="文字输入"
              aria-label="文字输入"
            >
              <Icon name="chat" />
            </button>
            <button
              className="desktop-float-btn desktop-exit-btn"
              onClick={toggleDesktop}
              data-tooltip="退出桌面模式"
              aria-label="退出桌面模式"
            >
              <Icon name="exit" />
            </button>
          </div>
        </div>
      )}

      {/* 设置弹窗 */}
      {showSettings && (
        <ErrorBoundary>
          <Settings onClose={() => setShowSettings(false)} onSave={handleConfigSaved} />
        </ErrorBoundary>
      )}

      {/* 对话记录浮层（桌面模式） */}
      {desktopMode && showChat && (
        <ChatOverlay onClose={() => setShowChat(false)} />
      )}

      {/* 关闭确认弹窗（非桌面模式） */}
      {showCloseConfirm && (
        <div className="confirm-overlay" onClick={() => setShowCloseConfirm(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-header">
              <span className="confirm-icon">⚠️</span>
              <h3>提示</h3>
            </div>
            <p className="confirm-message">是否确认关闭服务？</p>
            <div className="confirm-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowCloseConfirm(false)}
              >
                取消
              </button>
              <button
                className="btn-primary btn-danger"
                onClick={() => {
                  setShowCloseConfirm(false);
                  (window as any).electronAPI?.closeWindow();
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
