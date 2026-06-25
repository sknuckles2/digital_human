/**
 * 口型同步引擎
 * 根据音频能量值驱动 Live2D 口型参数
 */
export class LipSyncEngine {
  private mouthOpen = 0.0;
  private targetMouthOpen = 0.0;
  private smoothingFactor = 0.3;
  private isActive = false;
  private simTimer = 0;
  private simTarget = 0.25;
  private lastEnergyTime = 0;

  /** 当前嘴部开合值 (0~1) */
  get value(): number {
    return this.mouthOpen;
  }

  /** 是否处于活跃状态（正在说话） */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * 开始口型同步
   */
  start(): void {
    this.isActive = true;
    this.mouthOpen = 0.15;
    this.targetMouthOpen = 0.25;
    this.simTarget = 0.25;
    this.simTimer = 0;
    this.lastEnergyTime = 0;
  }

  /**
   * 停止口型同步
   */
  stop(): void {
    this.isActive = false;
    this.targetMouthOpen = 0;
  }

  /**
   * 更新音频能量值（由音频分析器调用）
   * @param energy 0~1 的音频能量
   */
  updateEnergy(energy: number): void {
    if (!this.isActive) return;
    this.lastEnergyTime = performance.now();
    this.targetMouthOpen = Math.min(1, energy * 1.5);
    if (this.targetMouthOpen < 0.02) {
      this.targetMouthOpen = 0.05;
    }
  }

  /**
   * 每帧更新（平滑过渡）
   * 在没有音频能量数据时，自动模拟说话口型
   * @param delta 帧间隔（秒）
   */
  update(delta: number): number {
    if (!this.isActive) {
      // 渐回中性（微张）
      this.mouthOpen += (0.04 - this.mouthOpen) * delta * 4;
      return this.mouthOpen;
    }

    // 如果超过 1 秒没有收到能量数据，启动自动模拟
    const now = performance.now();
    if (now - this.lastEnergyTime > 1000) {
      this.simTimer += delta;
      // 每 0.15~0.4 秒切换一次口型目标，模拟说话节奏
      if (this.simTimer > 0.15 + Math.random() * 0.25) {
        this.simTimer = 0;
        // 在 0.15~0.7 之间随机变化，模拟自然说话
        this.simTarget = 0.15 + Math.random() * 0.55;
      }
      this.targetMouthOpen = this.simTarget;
    }

    const speed = 1 / Math.max(0.05, this.smoothingFactor) * delta;
    this.mouthOpen += (this.targetMouthOpen - this.mouthOpen) * Math.min(1, speed * 8);
    this.mouthOpen = Math.max(0.05, Math.min(0.9, this.mouthOpen));

    return this.mouthOpen;
  }

  /**
   * 空闲时的呼吸微动
   */
  simulate(delta: number): number {
    const breathe = Math.sin(Date.now() * 0.003) * 0.025 + 0.035;
    this.mouthOpen += (breathe - this.mouthOpen) * delta * 2;
    return this.mouthOpen;
  }
}
