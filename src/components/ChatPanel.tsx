/**
 * 右侧对话历史面板
 */
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat';
import type { ApiConfig } from '../types';
import { DEFAULT_API_CONFIG } from '../types';

function loadConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_API_CONFIG;
}

/** 渲染初始头像 SVG（Google/Facebook 风格彩色圆形 + 首字） */
function InitialsAvatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initial = (name || '?')[0];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="avatar-initials">
      <rect width="32" height="32" rx="16" fill={color} />
      <text x="16" y="16" textAnchor="middle" dominantBaseline="central"
        fill="#fff" fontSize={size > 28 ? 15 : 13} fontWeight="600"
        style={{ userSelect: 'none' }}>
        {initial}
      </text>
    </svg>
  );
}

export default function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isThinking = useChatStore((s) => s.isThinking);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [config, setConfig] = useState(loadConfig);
  const listRef = useRef<HTMLDivElement>(null);

  // 当设置保存时刷新配置
  const refreshConfig = () => setConfig(loadConfig());
  useEffect(() => {
    window.addEventListener('settings-saved', refreshConfig);
    return () => window.removeEventListener('settings-saved', refreshConfig);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // 格式化时间
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <>
    <div className="chat-panel">
      <div className="chat-header">
        <h3>对话</h3>
        <div className="chat-header-right">
          <span className="chat-count">{messages.length} 条</span>
          {messages.length > 0 && (
            <button
              className="chat-clear-btn"
              onClick={() => setShowClearConfirm(true)}
              title="清空对话记录"
            >
              清空
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="empty-icon">💬</span>
            <p>开始对话吧</p>
            <p className="empty-hint">点击麦克风按钮或输入文字</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user'
                ? (config.userColor
                    ? <InitialsAvatar name={config.userName} color={config.userColor} />
                    : <span className="avatar-emoji">{config.userAvatar || '👤'}</span>
                  )
                : (config.characterColor
                    ? <InitialsAvatar name={config.characterName} color={config.characterColor} />
                    : <span className="avatar-emoji">{config.characterAvatar || '🤖'}</span>
                  )
              }
            </div>
            <div className="message-body">
              <div className="message-meta">
                <span className="message-role">
                  {msg.role === 'user' ? config.userName : config.characterName}
                </span>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="message-content">
                {msg.content || (msg.role === 'assistant' && isThinking ? (
                  <span className="typing-indicator">
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                  </span>
                ) : '')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="confirm-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-header">
              <span className="confirm-icon">⚠️</span>
              <h3>提示</h3>
            </div>
            <p className="confirm-message">确定清空所有对话记录？</p>
            <div className="confirm-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowClearConfirm(false)}
              >
                取消
              </button>
              <button
                className="btn-primary btn-danger"
                onClick={() => {
                  setShowClearConfirm(false);
                  clearMessages();
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
