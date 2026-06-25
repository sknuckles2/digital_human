/**
 * ChatOverlay — 桌面模式的对话记录浮层
 * 从底部工具栏按钮打开，显示完整对话历史
 */
import { useRef, useEffect } from 'react';
import { useChatStore } from '../store/chat';

interface ChatOverlayProps {
  onClose: () => void;
}

export default function ChatOverlay({ onClose }: ChatOverlayProps) {
  const messages = useChatStore((s) => s.messages);
  const isThinking = useChatStore((s) => s.isThinking);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-overlay-backdrop" onClick={onClose}>
      <div className="chat-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-overlay-header">
          <span>💬 对话记录</span>
          <button className="chat-overlay-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="chat-overlay-list" ref={listRef}>
          {messages.length === 0 && (
            <div className="chat-overlay-empty">
              <div className="chat-overlay-empty-icon">💬</div>
              <p>暂无对话，开始说话吧</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`co-message co-${msg.role}`}>
              <span className="co-role-label">
                {msg.role === 'user' ? '你' : 'AI'}
              </span>
              <div className="co-content">
                {msg.content || (isThinking ? '...' : '')}
              </div>
            </div>
          ))}

          {/* 思考中指示器 */}
          {isThinking &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role === 'user' && (
              <div className="co-message co-assistant">
                <span className="co-role-label">AI</span>
                <div className="co-content co-typing">
                  <span className="co-dot" />
                  <span className="co-dot" />
                  <span className="co-dot" />
                </div>
              </div>
            )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
