/**
 * SpeechBubble — 桌面模式下角色头部右上角的状态气泡
 * 根据角色状态显示：聆听中、思考中、说话中（带情绪）
 */
import { useChatStore } from '../store/chat';

/** 情绪关键词 → emoji 映射表（丰富版） */
const EMOTION_MAP: [RegExp, string][] = [
  // ── 开心 / 愉悦 ──
  [/开心|高兴|快乐|哈哈|hhhh|haha|lol|太好|真棒|棒极了|漂亮|完美|不错|赞|nice|good|great|excellent/i, '✨'],
  [/喜欢|爱|❤|love|like|可爱|萌|好美|好看|漂亮|迷人|心动/i, '💕'],
  [/笑|哈哈|呵呵|嘿嘿|嘻嘻|😂|🤣|好笑|搞笑|幽默/i, '😄'],
  [/太好|万岁|欢呼|耶|哦耶|wow|nice|great|棒|厉害|帅|酷|awesome|amazing/i, '🎉'],
  [/谢谢|感谢|多谢|感恩|thank|thx|thanks/i, '🙏'],

  // ── 温暖 / 感动 ──
  [/感动|温暖|贴心|温柔|暖心|治愈|真好|善良|天使|好暖/i, '🥹'],
  [/加油|努力|坚持|奋斗|相信|希望|未来|梦|梦想/i, '💪'],
  [/幸福|美好|甜蜜|浪漫|幸运|福/i, '🥰'],

  // ── 难过 / 伤感 ──
  [/难过|伤心|悲伤|好心痛|心痛|心碎|💔|broken/i, '💔'],
  [/哭|呜呜|呜呜呜|😭|哭了|流泪|泪目|想哭|眼眶/i, '😢'],
  [/遗憾|可惜|舍不得|怀旧|怀念|想念|想你了|miss/i, '🥺'],
  [/孤独|寂寞|一个人|孤单|好累|累了|疲惫|累|tired/i, '😮‍💨'],

  // ── 生气 / 不满 ──
  [/生气|愤怒|气死|可恶|讨厌|烦|受不了|真是的|可恶|annoying|angry|mad/i, '😤'],
  [/滚|走开|闭嘴|shut|fuck|靠|操|💢|擦|damn|shit/i, '💢'],
  [/哼|切|无聊|没意思|boring|sigh|唉/i, '😒'],

  // ── 惊讶 / 意外 ──
  [/惊讶|震惊|没想到|真的吗|哇|天哪|omg|oh my|really|serious|不敢相信|不可思议/i, '😳'],
  [/啊|咦|哦?|嗯?|啥|什么|what|huh|wait|真的|不是吧/i, '🤯'],
  [/惊喜|surprise|意外|居然|竟然|想不到|神奇|太棒/i, '🌟'],

  // ── 疑惑 / 思考 ──
  [/疑惑|奇怪|不懂|为什么|怎么|hmm|疑问|啥意思|不理解|confused|怎么搞的/i, '🤨'],
  [/原来如此|明白|懂了|get it|理解|了解了|ok|好的|知道了/i, '💡'],

  // ── 得意 / 调皮 ──
  [/得意|嘿嘿|狡猾|坏笑|阴谋|计划通|evil| mischievous|奸笑|hehe/i, '😏'],
  [/眨眼|wink|你猜|秘密|不说|私聊|悄悄/i, '😉'],

  // ── 酷 / 自信 ──
  [/酷|帅|厉害|牛逼|牛|强|大神|大佬|高手|pro|master|legend|霸气/i, '😎'],
  [/ok|好的|没问题|deal|搞定|done|完成|妥|安排|妥妥/i, '👌'],

  // ── 害怕 / 紧张 ──
  [/害怕|恐怖|可怕|吓人|scary|horror|鬼|惊悚|吓一跳|panic/i, '😨'],
  [/紧张|担心|焦虑|不安|慌|nervous|worried|anxious/i, '😰'],

  // ── 困 / 无聊 ──
  [/困|睡觉|晚安|睡|zzz|tired|sleep|瞌睡|哈欠|yawning/i, '😴'],
  [/无聊|没意思|boring|闷|枯燥|乏味|闲|sigh/i, '🥱'],

  // ── 吃 / 美食 ──
  [/吃|好吃|美食|饿|hungry|food|美味|餐厅|做饭|菜|饭|eat/i, '🍽️'],
  [/咖啡|茶|tea|coffee|喝|水|thirsty|drink/i, '☕'],

  // ── 音乐 / 艺术 ──
  [/音乐|歌|唱|music|song|旋律|节奏|曲|听歌|playlist/i, '🎵'],
  [/画画|画|绘画|艺术|art|design|创作|创意|create|想象/i, '🎨'],

  // ── 自然 / 天气 ──
  [/天气|太阳|晴|rain|雨|雪|snow|cloud|云|风|wind|暖和|冷|hot|cold/i, '🌈'],
  [/花|flower|自然|nature|春天|夏天|秋天|冬天|季节|green|tree|草/i, '🌸'],

  // ── 健康 / 运动 ──
  [/运动|跑步|健身|workout|exercise|健康|healthy|瑜伽|跑|走|锻炼/i, '🏃'],
  [/医院|生病|病|sick|ill|doctor|药|medicine|health/i, '🏥'],
];

/** 根据文字内容检测情绪，返回对应 emoji */
function detectEmotion(text: string): string {
  for (const [pattern, emoji] of EMOTION_MAP) {
    if (pattern.test(text)) return emoji;
  }
  return '💬'; // 默认
}

/** 根据 Expression 映射 emoji */
function expressionToEmoji(expr: string): string {
  switch (expr) {
    case 'smile': return '✨';
    case 'happy': return '🎉';
    case 'sad': return '💔';
    case 'angry': return '😤';
    case 'surprise': return '😳';
    case 'thinking': return '🤨';
    default: return '💬';
  }
}

export default function SpeechBubble() {
  const isThinking = useChatStore((s) => s.isThinking);
  const isSpeaking = useChatStore((s) => s.isSpeaking);
  const currentExpression = useChatStore((s) => s.currentExpression);
  const messages = useChatStore((s) => s.messages);

  // 获取最新 AI 回复用于情绪分析
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
  const lastContent = lastAssistant?.content || '';

  // 确定状态
  let statusText: string;
  let statusIcon: string;

  if (isThinking) {
    statusText = '思考中';
    statusIcon = '🤔';
  } else if (isSpeaking) {
    statusText = '说话中';
    // 说话时优先根据文字检测情绪，兜底用 currentExpression
    statusIcon = lastContent ? detectEmotion(lastContent) : expressionToEmoji(currentExpression);
  } else {
    statusText = '聆听中';
    statusIcon = '👂';
  }

  return (
    <div className="speech-bubble">
      <div className="speech-bubble-body">
        <span className="speech-bubble-icon">{statusIcon}</span>
        <span className="speech-bubble-text">{statusText}</span>
      </div>
      <div className="speech-bubble-tail" />
    </div>
  );
}
