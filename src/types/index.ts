/** 对话消息 */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** 数字人表情 */
export type Expression =
  | 'neutral'   // 中性
  | 'smile'     // 微笑
  | 'sad'       // 悲伤
  | 'angry'     // 生气
  | 'surprise'  // 惊讶
  | 'thinking'  // 思考
  | 'happy';    // 开心

/** 数字人动作 */
export type MotionType =
  | 'idle'      // 待机
  | 'nod'       // 点头
  | 'shake'     // 摇头
  | 'wave'      // 招手
  | 'thinking_pose'; // 思考姿态

/** API 配置 */
export interface ApiConfig {
  endpoint: string;
  apiKey: string;
  /** Live2D 模型文件路径（相对于 public/） */
  modelPath: string;
  /** 语音服务编排地址 */
  voiceEndpoint: string;
  /** TTS 音色 */
  ttsVoice: string;
  /** 用户昵称 */
  userName: string;
  /** 用户头像（留空则取首字生成彩色头像） */
  userAvatar: string;
  /** 角色名称 */
  characterName: string;
  /** 角色头像（留空则取首字生成彩色头像） */
  characterAvatar: string;
  /** 用户头像底色 */
  userColor: string;
  /** 角色头像底色 */
  characterColor: string;
}

/** 默认配置 */
export const DEFAULT_API_CONFIG: ApiConfig = {
  endpoint: 'http://192.168.31.132:8642/v1',
  apiKey: '',
  modelPath: '/live2d-models/hiyori_pro/hiyori_pro_t11.model3.json',
  voiceEndpoint: 'http://localhost:6080',
  ttsVoice: 'Vivian',
  userName: '我',
  userAvatar: '',
  characterName: '数字人',
  characterAvatar: '',
  userColor: '#6366f1',
  characterColor: '#f59e0b',
};

/** SSE 流式响应块 */
export interface StreamChunk {
  content: string;
  done: boolean;
}
