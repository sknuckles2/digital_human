/**
 * 设置弹窗
 * 配置 API 地址、模型、系统提示词等
 */
import { useState } from 'react';
import { testConnection } from '../services/hermes';
import type { ApiConfig } from '../types';
import { DEFAULT_API_CONFIG } from '../types';

/** 预设头像底色（Google/Facebook 风格） */
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#2563eb', '#7c3aed', '#64748b',
];

interface SettingsProps {
  onClose: () => void;
  onSave?: () => void;
}

function loadConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_API_CONFIG;
}

function saveConfig(config: ApiConfig) {
  localStorage.setItem('dh_api_config', JSON.stringify(config));
}

export default function Settings({ onClose, onSave }: SettingsProps) {
  const [config, setConfig] = useState<ApiConfig>(loadConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const updateConfig = (key: keyof ApiConfig, value: string | number) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    saveConfig(config);
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(config.endpoint);
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = () => {
    saveConfig(config);
    window.dispatchEvent(new Event('settings-saved'));
    onSave?.();
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* API 地址 */}
          <div className="settings-group">
            <label>API 地址</label>
            <div className="input-with-test">
              <input
                type="text"
                value={config.endpoint}
                onChange={(e) => updateConfig('endpoint', e.target.value)}
                placeholder="http://localhost:8080/v1"
              />
              <button
                className="test-btn"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
            </div>
            {testResult && (
              <span className={testResult.ok ? 'test-success' : 'test-fail'}>
                {testResult.message}
              </span>
            )}
            <p className="settings-hint">
              你的本地模型或 Hermes 的 OpenAI 兼容 API 地址
            </p>
          </div>

          {/* API Key */}
          <div className="settings-group">
            <label>
              API Key
              <span className={`api-key-status ${config.apiKey ? 'set' : 'unset'}`}>
                {config.apiKey ? ' ✓ 已设置' : ' ⚠ 未设置'}
              </span>
            </label>
            <div className="api-key-input-wrap">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => updateConfig('apiKey', e.target.value)}
                placeholder="sk-... 如无需认证则留空"
              />
              <button
                type="button"
                className="api-key-toggle"
                onClick={() => setShowApiKey(!showApiKey)}
                title={showApiKey ? '隐藏' : '显示'}
              >
                {showApiKey ? '🙈' : '👁'}
              </button>
            </div>
            <p className="settings-hint">
              Hermes 或模型的 API 密钥，如无需认证则留空
            </p>
          </div>

          {/* 数字人模型路径 */}
          <div className="settings-group">
            <label>Live2D 模型路径</label>
            <input
              type="text"
              value={config.modelPath}
              onChange={(e) => updateConfig('modelPath', e.target.value)}
              placeholder="/live2d-models/你的模型/模型.model3.json"
            />
            <p className="settings-hint">
              Live2D 模型文件相对于 public/ 的路径
            </p>
          </div>

          {/* 语音服务 */}
          <div className="settings-group">
            <label className="settings-section-label">语音服务</label>
            <div className="input-with-test" style={{ marginTop: 6 }}>
              <input
                type="text"
                value={config.voiceEndpoint}
                onChange={(e) => updateConfig('voiceEndpoint', e.target.value)}
                placeholder="http://localhost:6080"
              />
            </div>
            <p className="settings-hint">
              语音编排服务地址（ASR + TTS 统一入口）
            </p>

            <label style={{ marginTop: 8, display: 'block' }}>TTS 音色</label>
            <select
              value={config.ttsVoice}
              onChange={(e) => updateConfig('ttsVoice', e.target.value)}
              style={{ marginTop: 4 }}
            >
              <option value="Vivian">Vivian（明亮女声，中文）</option>
              <option value="Serena">Serena（温婉女声，中文）</option>
              <option value="Uncle_Fu">Uncle Fu（低沉大叔音，中文）</option>
              <option value="Dylan">Dylan（北京话青年）</option>
              <option value="Eric">Eric（成都话青年）</option>
              <option value="Ryan">Ryan（阳光男声，英文）</option>
              <option value="Aiden">Aiden（清亮男声，英文）</option>
              <option value="Ono_Anna">Ono Anna（俏皮日语女声）</option>
              <option value="Sohee">Sohee（温暖韩语女声）</option>
            </select>
            <p className="settings-hint">
              数字人说话时使用的 Qwen3-TTS 预设音色
            </p>
          </div>

          {/* 角色设置 */}
          <div className="settings-group">
            <label className="settings-section-label">角色设置</label>
            <div className="settings-role-grid">
              <div className="settings-role-field">
                <label>用户名称</label>
                <input
                  type="text"
                  value={config.userName}
                  onChange={(e) => updateConfig('userName', e.target.value)}
                  placeholder="我"
                />
              </div>
              <div className="settings-role-field">
                <label>角色名称</label>
                <input
                  type="text"
                  value={config.characterName}
                  onChange={(e) => updateConfig('characterName', e.target.value)}
                  placeholder="数字人"
                />
              </div>
            </div>
          </div>

          {/* 用户头像 */}
          <div className="settings-group">
            <label className="settings-section-label">用户头像</label>
            <div className="avatar-color-row">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  className={`avatar-color-swatch${config.userColor === color ? ' selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => updateConfig('userColor', color)}
                  title={color}
                />
              ))}
              <button
                className={`avatar-color-swatch avatar-emoji-swatch${!config.userColor ? ' selected' : ''}`}
                onClick={() => updateConfig('userColor', '')}
                title="使用 emoji"
              >
                <span className="avatar-emoji-icon">{config.userAvatar || '👤'}</span>
              </button>
            </div>
            {config.userColor && (
              <div className="avatar-preview-row">
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <rect width="36" height="36" rx="18" fill={config.userColor} />
                  <text x="18" y="18" textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize="16" fontWeight="600"
                    style={{ userSelect: 'none' }}>
                    {(config.userName || '我')[0]}
                  </text>
                </svg>
                <span className="avatar-preview-label">预览</span>
              </div>
            )}
            <div className="settings-role-field" style={{ marginTop: 8 }}>
              <input
                type="text"
                value={config.userAvatar}
                onChange={(e) => updateConfig('userAvatar', e.target.value)}
                placeholder="或输入 emoji / 文字"
                className="avatar-input"
              />
            </div>
          </div>

          {/* 角色头像 */}
          <div className="settings-group">
            <label className="settings-section-label">角色头像</label>
            <div className="avatar-color-row">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  className={`avatar-color-swatch${config.characterColor === color ? ' selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => updateConfig('characterColor', color)}
                  title={color}
                />
              ))}
              <button
                className={`avatar-color-swatch avatar-emoji-swatch${!config.characterColor ? ' selected' : ''}`}
                onClick={() => updateConfig('characterColor', '')}
                title="使用 emoji"
              >
                <span className="avatar-emoji-icon">{config.characterAvatar || '🤖'}</span>
              </button>
            </div>
            {config.characterColor && (
              <div className="avatar-preview-row">
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <rect width="36" height="36" rx="18" fill={config.characterColor} />
                  <text x="18" y="18" textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize="16" fontWeight="600"
                    style={{ userSelect: 'none' }}>
                    {(config.characterName || '数字人')[0]}
                  </text>
                </svg>
                <span className="avatar-preview-label">预览</span>
              </div>
            )}
            <div className="settings-role-field" style={{ marginTop: 8 }}>
              <input
                type="text"
                value={config.characterAvatar}
                onChange={(e) => updateConfig('characterAvatar', e.target.value)}
                placeholder="或输入 emoji / 文字"
                className="avatar-input"
              />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
