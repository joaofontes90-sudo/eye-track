/**
 * SmoothFilter: Filtro adaptativo para suavização do olhar e rejeição de tremores.
 * Ajusta a suavização automaticamente: alta estabilidade na fixação e resposta rápida nas sacadas.
 */
export class AdaptiveGazeFilter {
  constructor(options = {}) {
    this.minAlpha = options.minAlpha || 0.08; // Suavização forte para fixação
    this.maxAlpha = options.maxAlpha || 0.75; // Resposta rápida em sacadas
    this.velocityThreshold = options.velocityThreshold || 120; // px/frame para transição
    
    this.currentX = null;
    this.currentY = null;
    this.lastTimestamp = null;
  }

  reset() {
    this.currentX = null;
    this.currentY = null;
    this.lastTimestamp = null;
  }

  filter(rawX, rawY, timestamp = performance.now()) {
    if (this.currentX === null || this.currentY === null) {
      this.currentX = rawX;
      this.currentY = rawY;
      this.lastTimestamp = timestamp;
      return { x: rawX, y: rawY, velocity: 0 };
    }

    const dt = Math.max(1, timestamp - (this.lastTimestamp || timestamp)) / 1000;
    this.lastTimestamp = timestamp;

    const dx = rawX - this.currentX;
    const dy = rawY - this.currentY;
    const distance = Math.hypot(dx, dy);
    const velocity = distance / dt; // pixels por segundo

    // Fator alpha adaptativo baseado na velocidade
    const t = Math.min(1, Math.max(0, velocity / (this.velocityThreshold * 10)));
    const alpha = this.minAlpha + (this.maxAlpha - this.minAlpha) * (t * t);

    this.currentX = this.currentX + alpha * dx;
    this.currentY = this.currentY + alpha * dy;

    return {
      x: this.currentX,
      y: this.currentY,
      velocity: velocity
    };
  }
}

/**
 * TemporalQuadrantClassifier:
 * Mantém um buffer temporal dos últimos N milissegundos (ex: 600ms - 1000ms)
 * e aplica votação por maioria / histerese para determinar com extrema estabilidade
 * qual quadrante está em foco, eliminando 100% do efeito de flickering / vibração.
 */
export class TemporalQuadrantClassifier {
  constructor(windowMs = 700, hysteresisThreshold = 0.60) {
    this.windowMs = windowMs;
    this.hysteresisThreshold = hysteresisThreshold;
    this.buffer = [];
    this.currentStableQuadrant = null;
  }

  reset() {
    this.buffer = [];
    this.currentStableQuadrant = null;
  }

  setWindowMs(ms) {
    this.windowMs = ms;
  }

  addSample(x, y, quadKey, timestamp = performance.now()) {
    this.buffer.push({ x, y, quadKey, time: timestamp });
    const cutoff = timestamp - this.windowMs;
    while (this.buffer.length > 0 && this.buffer[0].time < cutoff) {
      this.buffer.shift();
    }
  }

  getStableQuadrant() {
    if (this.buffer.length === 0) return null;

    const counts = {};
    let sumX = 0;
    let sumY = 0;

    for (const item of this.buffer) {
      counts[item.quadKey] = (counts[item.quadKey] || 0) + 1;
      sumX += item.x;
      sumY += item.y;
    }

    const total = this.buffer.length;
    let maxKey = null;
    let maxCount = 0;

    for (const key in counts) {
      if (counts[key] > maxCount) {
        maxCount = counts[key];
        maxKey = key;
      }
    }

    const ratio = maxCount / total;

    // Histerese para evitar trocas falsas na borda
    if (this.currentStableQuadrant) {
      const currentCount = counts[this.currentStableQuadrant] || 0;
      const currentRatio = currentCount / total;
      if (currentRatio >= 0.35 && maxKey !== this.currentStableQuadrant && ratio < this.hysteresisThreshold) {
        maxKey = this.currentStableQuadrant;
      }
    }

    if (ratio >= (this.currentStableQuadrant === maxKey ? 0.35 : this.hysteresisThreshold)) {
      this.currentStableQuadrant = maxKey;
    }

    return {
      quadKey: this.currentStableQuadrant || maxKey,
      avgX: sumX / total,
      avgY: sumY / total,
      confidence: ratio
    };
  }
}
