/**
 * Live2D 表情参数映射表
 * 每个表情定义一组参数名 → 目标值的映射
 */
import type { Expression } from '../types';

export interface ExpressionPreset {
  /** 表情名称 */
  name: Expression;
  /** 中文标签 */
  label: string;
  /** 参数覆盖值 key: Live2D 参数名, value: 目标值 */
  params: Record<string, number>;
  /** 过渡时间（秒） */
  transition: number;
}

/**
 * 默认表情参数 — 基于 Live2D Cubism 标准参数
 * 具体参数名可能因模型而异，后续可在设置中调整
 */
export const EXPRESSION_PRESETS: ExpressionPreset[] = [
  {
    name: 'neutral',
    label: '中性',
    transition: 0.3,
    params: {
      ParamMouthOpenY: 0,
      ParamMouthForm: 0,
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamEyeBallX: 0,
      ParamEyeBallY: 0,
      ParamBrowLY: 0,
      ParamBrowRY: 0,
      ParamBrowLAngle: 0,
      ParamBrowRAngle: 0,
      ParamAngleX: 0,
      ParamAngleY: 0,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'smile',
    label: '微笑',
    transition: 0.2,
    params: {
      ParamMouthOpenY: 0.1,
      ParamMouthForm: 0.5,
      ParamEyeLOpen: 0.7,
      ParamEyeROpen: 0.7,
      ParamBrowLY: 0.1,
      ParamBrowRY: 0.1,
      ParamAngleX: 0,
      ParamAngleY: -0.05,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'happy',
    label: '开心',
    transition: 0.15,
    params: {
      ParamMouthOpenY: 0.3,
      ParamMouthForm: 0.7,
      ParamEyeLOpen: 0.6,
      ParamEyeROpen: 0.6,
      ParamBrowLY: 0.3,
      ParamBrowRY: 0.3,
      ParamAngleX: 0,
      ParamAngleY: -0.08,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'sad',
    label: '悲伤',
    transition: 0.3,
    params: {
      ParamMouthOpenY: 0.05,
      ParamMouthForm: -0.3,
      ParamEyeLOpen: 0.6,
      ParamEyeROpen: 0.6,
      ParamBrowLY: -0.3,
      ParamBrowRY: -0.3,
      ParamBrowLAngle: 0.1,
      ParamBrowRAngle: 0.1,
      ParamAngleX: 0,
      ParamAngleY: 0.05,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'angry',
    label: '生气',
    transition: 0.2,
    params: {
      ParamMouthOpenY: 0.1,
      ParamMouthForm: -0.5,
      ParamEyeLOpen: 0.9,
      ParamEyeROpen: 0.9,
      ParamBrowLY: -0.4,
      ParamBrowRY: -0.4,
      ParamBrowLAngle: -0.3,
      ParamBrowRAngle: -0.3,
      ParamAngleX: 0,
      ParamAngleY: 0.05,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'surprise',
    label: '惊讶',
    transition: 0.1,
    params: {
      ParamMouthOpenY: 0.8,
      ParamMouthForm: 0.2,
      ParamEyeLOpen: 1.0,
      ParamEyeROpen: 1.0,
      ParamBrowLY: 0.5,
      ParamBrowRY: 0.5,
      ParamBrowLAngle: 0.3,
      ParamBrowRAngle: 0.3,
      ParamAngleX: 0,
      ParamAngleY: -0.05,
      ParamAngleZ: 0,
    },
  },
  {
    name: 'thinking',
    label: '思考',
    transition: 0.3,
    params: {
      ParamMouthOpenY: 0,
      ParamMouthForm: 0.1,
      ParamEyeLOpen: 0.5,
      ParamEyeROpen: 0.5,
      ParamEyeBallX: -0.3,
      ParamEyeBallY: 0.2,
      ParamBrowLY: -0.1,
      ParamBrowRY: 0.1,
      ParamBrowLAngle: -0.1,
      ParamBrowRAngle: 0.1,
      ParamAngleX: 0.1,
      ParamAngleY: 0.05,
      ParamAngleZ: 0,
    },
  },
];

/** 通过表情名查找配置 */
export function getExpressionPreset(name: Expression): ExpressionPreset {
  return EXPRESSION_PRESETS.find((e) => e.name === name) || EXPRESSION_PRESETS[0];
}
