/**
 * Live2D 数字人画布组件
 * 负责渲染和管理 Live2D 数字人的 3D 场景
 */
import { useEffect, useRef, useState } from 'react';
import { L2DController, type LoadStatus } from '../live2d/L2DController';
import { useChatStore } from '../store/chat';
import { ttsService } from '../services/tts';

/**
 * 查找模型文件
 * 优先使用用户在设置中指定的路径，找不到则自动搜索
 */
async function findModelPath(): Promise<string | null> {
  // 1. 优先读取用户设置的自定义路径
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) {
      const config = JSON.parse(saved);
      console.log('[findModelPath] Reading from config:', config.modelPath);
      if (config.modelPath) {
        const resp = await fetch(config.modelPath, { method: 'HEAD' });
        console.log('[findModelPath] HEAD check result:', resp.status, config.modelPath);
        if (resp.ok) return config.modelPath;
      }
    }
  } catch (e) {
    console.warn('[findModelPath] Config read failed:', e);
  }

  // 2. 自动扫描常见路径（名称不敏感的搜索）
  // 用户仓库中已有的模型
  const commonNames = [
    'shizuku', 'haru', 'mao', 'riko', 'chitose',
    'hiyori', 'hiyori_free', 'hiyori_pro_t11', 'hiyori_free_t08',
    'model', 'index', 'avatar', 'character', 'live2d',
  ];
  const searchPaths: string[] = [];

  for (const name of commonNames) {
    // 尝试不同的大小写组合
    const variants = [
      name,
      name.charAt(0).toUpperCase() + name.slice(1),
      name.toUpperCase(),
    ];
    for (const v of variants) {
      searchPaths.push(`/live2d-models/${v}/${v}.model3.json`);
      searchPaths.push(`/live2d-models/${v}/${v}.model3.json`);
    }
    // 直接放在 live2d-models 根目录的模型
    searchPaths.push(`/live2d-models/${name}.model3.json`);
  }

  // 用 Set 去重
  const uniquePaths = [...new Set(searchPaths)];

  for (const path of uniquePaths) {
    try {
      const resp = await fetch(path, { method: 'HEAD' });
      if (resp.ok) {
        console.log('[findModelPath] Auto scan found:', path);
        return path;
      }
    } catch {}
  }

  console.warn('[findModelPath] No model file found');
  return null;
}

interface Live2DCanvasProps {
  reloadKey?: number;
  fadingOut?: boolean;
}

export default function Live2DCanvas({ reloadKey = 0, fadingOut = false }: Live2DCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<L2DController | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const currentExpression = useChatStore((s) => s.currentExpression);
  const isThinking = useChatStore((s) => s.isThinking);
  const isSpeaking = useChatStore((s) => s.isSpeaking);

  // 初始化控制器（reloadKey 变化时重新初始化）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let controller: L2DController | null = null;
    let cancelled = false;

    async function init() {
      if (!container || cancelled) return;

      console.log('[Live2DCanvas] Initializing, reloadKey:', reloadKey, 'CubismCore:', typeof (window as any).Live2DCubismCore);

      // 先检测 Cubism Core 是否已加载
      if (typeof (window as any).Live2DCubismCore === 'undefined') {
        setStatus('error');
        setErrorMessage(
          'Live2D Cubism Core 未加载。请确认 public/live2dcubismcore.min.js 文件存在。\n' +
          '运行: npm run download-model 或从 Live2D 官网下载。'
        );
        return;
      }

      const modelPath = await findModelPath();

      if (!modelPath || cancelled) {
        setStatus('error');
        setErrorMessage('');
        return;
      }

      controller = new L2DController({
        container,
        modelPath,
        onLoad: (s) => {
          if (!cancelled) setStatus(s);
        },
      });

      controllerRef.current = controller;
      await controller.init();

      // 连接 TTS 音频能量 → Live2D 口型同步
      ttsService.onEnergy = (energy: number) => {
        const ctrl = controllerRef.current;
        if (ctrl && ctrl.lipSyncEngine.active) {
          ctrl.updateLipSyncEnergy(energy);
        }
      };
    }

    init();

    return () => {
      cancelled = true;
      ttsService.onEnergy = null;
      controller?.destroy();
      controllerRef.current = null;
    };
  }, [reloadKey]);

  // 监听表情变化
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    ctrl.setExpression(currentExpression);

    if (isThinking) {
      ctrl.startThinking();
    } else {
      ctrl.stopThinking();
    }
  }, [currentExpression, isThinking]);

  // 监听说话状态 → 口型同步
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    if (isSpeaking) {
      ctrl.startSpeaking();
    } else {
      ctrl.stopSpeaking();
    }
  }, [isSpeaking]);

  return (
    <div className="live2d-container">
      <div
        ref={containerRef}
        className="live2d-canvas"
        style={{
          width: '100%',
          height: '100%',
          opacity: status === 'loaded' ? (fadingOut ? 0 : 1) : 0,
          transition: 'opacity 0.5s ease',
        }}
      />

      {/* 加载状态 */}
      {/* 加载状态（过渡期间隐藏） */}
      {status === 'loading' && !fadingOut && (
        <div className="live2d-placeholder">
          <div className="l2d-loading-spinner" />
          <p>加载数字人中...</p>
        </div>
      )}

      {/* 模型缺失提示 */}
      {status === 'error' && !errorMessage && (
        <div className="live2d-placeholder">
          <div className="l2d-error-icon">🎭</div>
          <h3>未检测到 Live2D 模型</h3>
          <div className="l2d-error-steps">
            <p><strong>模型文件应该放在：</strong></p>
            <code style={{ display: 'block', margin: '8px 0', fontSize: 13, wordBreak: 'break-all' }}>
              public/live2d-models/&lt;你的模型文件夹&gt;/&lt;模型名&gt;.model3.json
            </code>
            <p><strong>目录结构示例：</strong></p>
            <pre style={{ fontSize: 12, lineHeight: 1.6, background: '#0a0a0f', padding: 10, borderRadius: 6 }}>
{`public/live2d-models/
  └── shizuku/
      ├── shizuku.model3.json
      ├── shizuku.moc3
      ├── shizuku.physics3.json
      ├── shizuku.cdi3.json
      └── Shizuku.2048/
          ├── texture_00.png
          └── texture_01.png`}
            </pre>
            <p><strong>操作：</strong></p>
            <ol>
              <li>自动下载：
                <code style={{ fontSize: 12 }}>npm run download-model</code>
              </li>
              <li>或点击 ⚙ 设置 →
                <strong>Live2D 模型路径</strong> |
                填入你的模型文件路径</li>
              <li>示例：<code style={{ fontSize: 12 }}>/live2d-models/你的模型/你的模型.model3.json</code></li>
            </ol>
          </div>
        </div>
      )}

      {/* Cubism Core 缺失提示 */}
      {status === 'error' && errorMessage && (
        <div className="live2d-placeholder">
          <div className="l2d-error-icon">⚙️</div>
          <h3>Cubism Core 未加载</h3>
          <p className="l2d-error-hint">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
