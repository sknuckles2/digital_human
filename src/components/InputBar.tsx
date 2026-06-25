/**
 * 文字输入栏
 * 注意：必须正确处理 composition 事件，否则中文输入法无法切换/使用。
 * 组合（composition）期间按 Enter 应让 IME 确认候选词，而非提交消息。
 */
import { useState, useRef } from 'react';
import Icon from './Icon';

interface InputBarProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function InputBar({ onSend, disabled }: InputBarProps) {
  const [text, setText] = useState('');
  const isComposing = useRef(false);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组合中，跳过 Enter 提交 — 让 IME 自己处理确认
    if (isComposing.current) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="input-bar">
      <input
        type="text"
        className="input-field"
        placeholder="输入消息，按 Enter 发送..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; }}
        disabled={disabled}
      />
      <button
        className="send-btn"
        onClick={handleSubmit}
        disabled={!text.trim() || disabled}
        data-tooltip="发送"
        aria-label="发送"
      >
        <Icon name="send" />
      </button>
    </div>
  );
}
