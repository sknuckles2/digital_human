/**
 * Live2D 动作触发逻辑
 * 定义各类动作的触发条件和执行方式
 */
import type { MotionType } from '../types';

export interface MotionEntry {
  type: MotionType;
  /** Live2D 动作组名 */
  group: string;
  /** 组内索引（-1 表示随机） */
  index: number;
  /** 优先级 */
  priority: number;
  /** 持续时间（秒） */
  duration: number;
}

/**
 * 标准动作映射
 * group 对应 Live2D 模型 .motion3.json 中的 Group 名
 */
export const MOTION_MAP: Record<MotionType, MotionEntry> = {
  idle: {
    type: 'idle',
    group: 'Idle',
    index: -1,
    priority: 1,
    duration: 0,
  },
  nod: {
    type: 'nod',
    group: 'Tap',
    index: 0,
    priority: 3,
    duration: 1.0,
  },
  shake: {
    type: 'shake',
    group: 'Tap',
    index: 1,
    priority: 3,
    duration: 1.5,
  },
  wave: {
    type: 'wave',
    group: 'Tap',
    index: 2,
    priority: 3,
    duration: 2.0,
  },
  thinking_pose: {
    type: 'thinking_pose',
    group: 'Idle',
    index: 1,
    priority: 2,
    duration: 3.0,
  },
};

/**
 * 获取模型的可用动作列表（用于 UI 预览/测试）
 */
export function getAvailableMotions(): MotionType[] {
  return Object.keys(MOTION_MAP) as MotionType[];
}
