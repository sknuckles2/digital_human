/**
 * Live2D 核心控制器
 * 管理模型加载、表达式切换、动作播放、口型同步、眨眼和呼吸动画
 */
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { Expression, MotionType } from '../types';

// 必须：将 PIXI 暴露到全局，pixi-live2d-display 需要 window.PIXI.Ticker 来更新模型
if (typeof window !== 'undefined') {
  (window as any).PIXI = PIXI;
}
import { getExpressionPreset } from './expressions';
import { MOTION_MAP } from './motions';
import { LipSyncEngine } from './lipSync';

export type LoadStatus = 'loading' | 'loaded' | 'error';

export interface L2DControllerOptions {
  /** 画布容器元素 */
  container: HTMLElement;
  /** 模型 JSON 文件路径 */
  modelPath: string;
  /** 加载完成回调 */
  onLoad?: (status: LoadStatus) => void;
}

export class L2DController {
  private app: PIXI.Application | null = null;
  private model: Live2DModel | null = null;
  private container: HTMLElement;
  private modelPath: string;
  private onLoad?: (status: LoadStatus) => void;
  private animationId: number | null = null;
  private currentExpression: Expression = 'neutral';
  private lipSync = new LipSyncEngine();
  private isTransitioning = false;

  // 自动眨眼
  private blinkTimer = 0;
  private readonly BLINK_INTERVAL = 3000; // 毫秒
  private readonly BLINK_DURATION = 100;  // 毫秒
  private isBlinking = false;
  private blinkPhase = 0;

  // 呼吸参数
  private breathePhase = 0;

  // 待机动作计时
  private idleMotionTimer = 0;
  private readonly IDLE_MOTION_INTERVAL = 15000; // 15秒播一次待机动作

  constructor(options: L2DControllerOptions) {
    this.container = options.container;
    this.modelPath = options.modelPath;
    this.onLoad = options.onLoad;
  }

  /**
   * 初始化 PIXI 应用并加载模型
   */
  async init(): Promise<void> {
    this.onLoad?.('loading');

    try {
      // 创建 PIXI 应用
      this.app = new PIXI.Application({
        width: this.container.clientWidth,
        height: this.container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      this.container.appendChild(this.app.view as HTMLCanvasElement);

      // 加载 Live2D 模型
      this.model = await Live2DModel.from(this.modelPath);

      // 设置模型在画布中居中
      this.model.anchor.set(0.5, 0.5);
      this.model.position.set(
        this.app.screen.width / 2,
        this.app.screen.height / 2
      );

      // 根据画布大小缩放模型
      this.fitModel(this.app.screen.width, this.app.screen.height);

      this.app.stage.addChild(this.model);

      // 设置默认表情
      this.applyExpression('neutral');

      // 启动动画循环
      this.startAnimationLoop();

      // 窗口大小变化适配
      const resizeHandler = () => this.handleResize();
      window.addEventListener('resize', resizeHandler);

      this.onLoad?.('loaded');
    } catch (err) {
      console.error('Live2D model load failed:', err);
      this.onLoad?.('error');
    }
  }

  /**
   * 适配模型到画布大小
   */
  private fitModel(width: number, height: number): void {
    if (!this.model) return;

    const scaleX = width / (this.model.width || 800);
    const scaleY = height / (this.model.height || 800);
    this.model.scale.set(Math.min(scaleX, scaleY));
  }

  /**
   * 窗口大小变化处理
   */
  private handleResize(): void {
    if (!this.app) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    this.app.renderer.resize(w, h);

    if (this.model) {
      this.model.position.set(w / 2, h / 2);
      this.fitModel(w, h);
    }
  }

  /**
   * 开始动画循环
   */
  private startAnimationLoop(): void {
    if (!this.app) return;

    let lastTime = performance.now();

    const tick = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      this.updateBlink(delta);
      this.updateBreathing(delta);
      this.updateLipSync(delta);
      this.updateIdleMotion(delta);

      this.animationId = requestAnimationFrame(tick);
    };

    this.animationId = requestAnimationFrame(tick);
  }

  /**
   * 自动眨眼
   */
  private updateBlink(delta: number): void {
    if (!this.model) return;

    const eyeLParam = 'ParamEyeLOpen';
    const eyeRParam = 'ParamEyeROpen';

    this.blinkTimer += delta * 1000;

    if (this.isBlinking) {
      this.blinkPhase += delta * 1000;
      const progress = this.blinkPhase / this.BLINK_DURATION;

      if (progress < 0.3) {
        // 闭眼阶段
        const t = progress / 0.3;
        const eyeVal = 1 - t;
        this.setParam(eyeLParam, Math.max(0, eyeVal));
        this.setParam(eyeRParam, Math.max(0, eyeVal));
      } else if (progress < 0.7) {
        // 保持闭眼
        this.setParam(eyeLParam, 0);
        this.setParam(eyeRParam, 0);
      } else {
        // 睁眼阶段
        const t = (progress - 0.7) / 0.3;
        const eyeVal = t;
        this.setParam(eyeLParam, Math.min(1, eyeVal));
        this.setParam(eyeRParam, Math.min(1, eyeVal));
      }

      if (progress >= 1) {
        this.isBlinking = false;
        this.blinkPhase = 0;
        this.setParam(eyeLParam, 1);
        this.setParam(eyeRParam, 1);
      }
    } else if (this.blinkTimer >= this.BLINK_INTERVAL) {
      this.isBlinking = true;
      this.blinkPhase = 0;
      this.blinkTimer = 0;
    }
  }

  /**
   * 呼吸起伏动画
   */
  private updateBreathing(delta: number): void {
    if (!this.model) return;

    this.breathePhase += delta * 2.5;

    const breath = Math.sin(this.breathePhase) * 0.008;
    const bodyY = -breath;

    // 轻微身体起伏
    this.setParam('ParamBodyAngleY', bodyY);

    // 如果不在说话，有轻微肩膀起伏
    if (!this.lipSync.active && !this.isTransitioning) {
      const breatheMouth = Math.sin(this.breathePhase * 0.5) * 0.02 + 0.04;
      const currentMouth = this.getParam('ParamMouthOpenY');
      if (Math.abs(currentMouth - breatheMouth) < 0.05) {
        this.setParam('ParamMouthOpenY', breatheMouth);
      }
    }
  }

  /**
   * 口型同步更新
   */
  private updateLipSync(delta: number): void {
    if (!this.model) return;

    let mouthValue: number;

    if (this.lipSync.active) {
      mouthValue = this.lipSync.update(delta);
    } else {
      mouthValue = this.lipSync.simulate(delta);
    }

    this.setParam('ParamMouthOpenY', mouthValue);
  }

  /**
   * 待机动作（定时播放随机动作）
   */
  private updateIdleMotion(delta: number): void {
    this.idleMotionTimer += delta * 1000;

    if (this.idleMotionTimer >= this.IDLE_MOTION_INTERVAL && !this.lipSync.active) {
      this.idleMotionTimer = 0;
      // 随机播放一个待机动作
      if (this.model) {
        const idleIndex = Math.floor(Math.random() * 3);
        try {
          this.model.motion('Idle', idleIndex);
        } catch {
          // 动作不存在时静默跳过
        }
      }
    }
  }

  /**
   * 切换表情（带平滑过渡）
   */
  private applyExpression(expression: Expression): void {
    if (!this.model) return;

    const preset = getExpressionPreset(expression);
    this.currentExpression = expression;

    // 应用所有参数
    for (const [paramId, value] of Object.entries(preset.params)) {
      this.model.internalModel.coreModel.setParameterValueById(
        paramId,
        value,
        preset.transition
      );
    }
  }

  // ========== 公开接口 ==========

  /**
   * 获取当前表情
   */
  get expression(): Expression {
    return this.currentExpression;
  }

  /**
   * 获取口型同步引擎
   */
  get lipSyncEngine(): LipSyncEngine {
    return this.lipSync;
  }

  /**
   * 设置表情
   */
  setExpression(expression: Expression): void {
    this.isTransitioning = true;
    this.applyExpression(expression);
    setTimeout(() => {
      this.isTransitioning = false;
    }, 500);
  }

  /**
   * 播放动作
   */
  playMotion(type: MotionType): void {
    if (!this.model) return;

    const entry = MOTION_MAP[type];
    if (!entry) return;

    try {
      const index = entry.index === -1
        ? Math.floor(Math.random() * 3)
        : entry.index;
      this.model.motion(entry.group, index);
    } catch {
      // 动作不存在时静默跳过
    }
  }

  /**
   * 开始口型同步（说话时调用）
   */
  startLipSync(): void {
    this.lipSync.start();
  }

  /**
   * 停止口型同步
   */
  stopLipSync(): void {
    this.lipSync.stop();
  }

  /**
   * 更新口型能量（由音频分析器提供）
   */
  updateLipSyncEnergy(energy: number): void {
    this.lipSync.updateEnergy(energy);
  }

  /**
   * 说话时触发（结合表情+口型）
   */
  startSpeaking(): void {
    this.startLipSync();
    this.setExpression('smile');
  }

  /**
   * 停止说话
   */
  stopSpeaking(): void {
    this.stopLipSync();
    this.setExpression('neutral');
  }

  /**
   * 思考状态
   */
  startThinking(): void {
    this.setExpression('thinking');
    this.playMotion('thinking_pose');
  }

  /**
   * 停止思考
   */
  stopThinking(): void {
    this.setExpression('neutral');
  }

  // ========== 参数工具 ==========

  private setParam(id: string, value: number): void {
    if (!this.model) return;
    try {
      this.model.internalModel.coreModel.setParameterValueById(id, value);
    } catch {
      // 参数不存在时静默跳过
    }
  }

  private getParam(id: string): number {
    if (!this.model) return 0;
    try {
      return this.model.internalModel.coreModel.getParameterValueById(id);
    } catch {
      return 0;
    }
  }

  // ========== 清理 ==========

  /**
   * 手动触发画布尺寸重算（窗口/布局变化时调用）
   */
  resize(): void {
    this.handleResize();
  }

  /**
   * 销毁控制器，释放资源
   */
  destroy(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.model) {
      this.model.destroy();
      this.model = null;
    }

    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }
}
