import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message, Expression } from '../types';
import { sendStreamMessage } from '../services/hermes';
import { speak, stopSpeaking } from '../services/tts';

interface ChatState {
  messages: Message[];
  isThinking: boolean;
  isSpeaking: boolean;
  currentExpression: Expression;
  addMessage: (msg: Message) => void;
  sendMessage: (text: string) => Promise<void>;
  setExpression: (expr: Expression) => void;
  setSpeaking: (v: boolean) => void;
  clearMessages: () => void;
}

let msgId = 0;
const nextId = () => `msg_${Date.now()}_${++msgId}`;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isThinking: false,
      isSpeaking: false,
      currentExpression: 'neutral',

      addMessage: (msg) =>
        set((s) => ({ messages: [...s.messages, msg] })),

      setExpression: (expr) =>
        set({ currentExpression: expr }),

      setSpeaking: (v) =>
        set({ isSpeaking: v }),

      clearMessages: () => set({ messages: [] }),

      sendMessage: async (text: string) => {
        const store = get();
        if (store.isThinking) return;

        // 添加用户消息
        const userMsg: Message = {
          id: nextId(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, userMsg],
          isThinking: true,
          currentExpression: 'thinking',
        }));

        // 兜底超时：防止任何原因导致 isThinking 卡死（60 秒后强制恢复）
        const thinkingTimeout = setTimeout(() => {
          set({ isThinking: false });
        }, 60000);

        try {
          const assistantId = nextId();

          // 先保存当前消息快照（不含空的 assistant 占位），给 API 用
          const messagesForApi = [...get().messages];

          // 创建空助手消息（只在前端展示，不给 API 发送）
          const assistantMsg: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, assistantMsg] }));

          let fullContent = '';

          // 流式调用 LLM（只发用户消息，不包含空的 assistant 占位）
          await sendStreamMessage(
            messagesForApi,
            (chunk) => {
              fullContent += chunk.content;
              // 更新消息内容
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                ),
              }));

              // 有内容时切换到微笑表情（流式/非流式都适用）
              if (fullContent.length > 2) {
                set({ currentExpression: 'smile' });
              }
            }
          );

          // 完整回复 → TTS 朗读
          if (fullContent.trim()) {
            // 先停止之前的语音
            stopSpeaking();
            // 思考结束，进入说话状态
            set({ isThinking: false, currentExpression: 'smile', isSpeaking: true });
            await speak(fullContent, () => {
              // 语音结束 → 恢复中性
              set({ currentExpression: 'neutral' });
            });
            // 确保说话状态关闭（兼容 TTS 不支持时回调不触发的情况）
            set({ isSpeaking: false });
          } else {
            // 无内容回复，直接结束思考
            set({ isThinking: false });
          }
        } catch (err) {
          console.error('Send message failed:', err);
          const detail = err instanceof Error ? err.message : '未知错误';
          const errorMsg: Message = {
            id: nextId(),
            role: 'assistant',
            content: `连接失败: ${detail}`,
            timestamp: Date.now(),
          };
          set((s) => ({
            messages: [...s.messages, errorMsg],
            currentExpression: 'sad',
          }));
        } finally {
          clearTimeout(thinkingTimeout);
          set({ isThinking: false });
        }
      },
    }),
    {
      name: 'dh-chat-history',
      // 只持久化 messages，不保存临时 UI 状态
      partialize: (state) => ({
        messages: state.messages,
      }),
    }
  )
);
