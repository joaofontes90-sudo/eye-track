/**
 * Calibrator: Gerencia o fluxo de calibração em 5 pontos e calcula a matriz
 * de mapeamento entre as coordenadas relativas da íris e a tela.
 */
export class Calibrator {
  constructor() {
    this.points = [
      { id: 'top-left', name: 'Superior Esquerdo (Descanso)', rx: 0.25, ry: 0.28 },
      { id: 'top-right', name: 'Superior Direito (SIM)', rx: 0.80, ry: 0.28 },
      { id: 'center', name: 'Centro (Descanso)', rx: 0.40, ry: 0.50 },
      { id: 'bottom-right', name: 'Inferior Direito (NÃO)', rx: 0.80, ry: 0.72 },
      { id: 'bottom-left', name: 'Inferior Esquerdo (Descanso)', rx: 0.25, ry: 0.72 }
    ];
    this.currentPointIndex = 0;
    this.isCalibrating = false;
    this.collectedSamples = [];
    this.calibrationData = []; // [{ target: {x, y}, iris: {gx, gy} }]
    this.modelCoeffs = null; // { wx: [], wy: [] }
    this.isCalibrated = false;
  }

  startCalibration() {
    this.currentPointIndex = 0;
    this.calibrationData = [];
    this.collectedSamples = [];
    this.isCalibrating = true;
    this.isCalibrated = false;
    this.modelCoeffs = null;
  }

  getCurrentTarget(screenWidth, screenHeight) {
    if (this.currentPointIndex >= this.points.length) return null;
    const pt = this.points[this.currentPointIndex];
    return {
      index: this.currentPointIndex,
      total: this.points.length,
      name: pt.name,
      x: pt.rx * screenWidth,
      y: pt.ry * screenHeight,
      rx: pt.rx,
      ry: pt.ry
    };
  }

  addSample(irisGaze) {
    if (!this.isCalibrating || !irisGaze || !irisGaze.valid) return;
    this.collectedSamples.push({ gx: irisGaze.gx, gy: irisGaze.gy });
  }

  finishCurrentPoint(targetScreenX, targetScreenY) {
    if (this.collectedSamples.length < 5) {
      console.warn("Amostras insuficientes para o ponto. Tentando com fallback.");
    }
    
    // Descartar os primeiros 30% das amostras (tempo de fixação da sacada inicial)
    const startIdx = Math.floor(this.collectedSamples.length * 0.3);
    const validSamples = this.collectedSamples.slice(startIdx);
    
    if (validSamples.length === 0) {
      // Fallback se poucas amostras
      validSamples.push(...this.collectedSamples);
    }

    // Calcula a mediana para rejeitar ruídos e piscadas
    const medianGx = this._median(validSamples.map(s => s.gx));
    const medianGy = this._median(validSamples.map(s => s.gy));

    this.calibrationData.push({
      targetX: targetScreenX,
      targetY: targetScreenY,
      gx: medianGx,
      gy: medianGy
    });

    this.collectedSamples = [];
    this.currentPointIndex++;

    if (this.currentPointIndex >= this.points.length) {
      this.isCalibrating = false;
      this._fitModel();
      return true; // Calibração concluída
    }
    return false; // Próximo ponto
  }

  _median(values) {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Ajusta um modelo bilinear de regressão regularizado (Ridge Regression):
   * Features: [1, gx, gy, gx * gy]
   */
  _fitModel() {
    if (this.calibrationData.length < 4) {
      console.error("Dados de calibração insuficientes para ajuste.");
      return;
    }

    const N = this.calibrationData.length;
    // Matriz de design X (N x 4): [1, gx, gy, gx*gy]
    const X = [];
    const Yx = [];
    const Yy = [];

    for (const d of this.calibrationData) {
      X.push([1, d.gx, d.gy, d.gx * d.gy]);
      Yx.push(d.targetX);
      Yy.push(d.targetY);
    }

    // Resolver mínimos quadrados com Ridge (lambda * I)
    const numFeatures = 4;
    const lambda = 0.001; // Regularização

    // XtX = X^T * X + lambda * I
    const XtX = Array.from({ length: numFeatures }, () => Array(numFeatures).fill(0));
    const XtYx = Array(numFeatures).fill(0);
    const XtYy = Array(numFeatures).fill(0);

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < numFeatures; j++) {
        XtYx[j] += X[i][j] * Yx[i];
        XtYy[j] += X[i][j] * Yy[i];
        for (let k = 0; k < numFeatures; k++) {
          XtX[j][k] += X[i][j] * X[i][k];
        }
      }
    }

    for (let j = 0; j < numFeatures; j++) {
      XtX[j][j] += lambda;
    }

    const invXtX = this._invertMatrix(XtX);
    if (!invXtX) {
      console.warn("Aviso: matriz singular na calibração. Aplicando ajuste linear adaptativo de segurança.");
      this._fitLinearFallback();
      return;
    }

    // W = inv(XtX) * XtY
    const wx = Array(numFeatures).fill(0);
    const wy = Array(numFeatures).fill(0);

    for (let i = 0; i < numFeatures; i++) {
      for (let j = 0; j < numFeatures; j++) {
        wx[i] += invXtX[i][j] * XtYx[j];
        wy[i] += invXtX[i][j] * XtYy[j];
      }
    }

    this.modelCoeffs = { wx, wy };
    this.isCalibrated = true;
    console.log("Calibração concluída com sucesso! Coeficientes:", this.modelCoeffs);
  }

  _fitLinearFallback() {
    const pts = this.calibrationData;
    if (pts.length === 0) return;

    let minGx = Infinity, maxGx = -Infinity;
    let minGy = Infinity, maxGy = -Infinity;
    let minTx = Infinity, maxTx = -Infinity;
    let minTy = Infinity, maxTy = -Infinity;

    for (const d of pts) {
      if (d.gx < minGx) minGx = d.gx;
      if (d.gx > maxGx) maxGx = d.gx;
      if (d.gy < minGy) minGy = d.gy;
      if (d.gy > maxGy) maxGy = d.gy;
      if (d.targetX < minTx) minTx = d.targetX;
      if (d.targetX > maxTx) maxTx = d.targetX;
      if (d.targetY < minTy) minTy = d.targetY;
      if (d.targetY > maxTy) maxTy = d.targetY;
    }

    const spanGx = Math.max(0.01, maxGx - minGx);
    const spanGy = Math.max(0.01, maxGy - minGy);
    const scaleX = (maxTx - minTx) / spanGx;
    const scaleY = (maxTy - minTy) / spanGy;

    this.modelCoeffs = {
      wx: [minTx - minGx * scaleX, scaleX, 0, 0],
      wy: [minTy - minGy * scaleY, 0, scaleY, 0]
    };
    this.isCalibrated = true;
    console.log("Calibração concluída via Fallback Linear:", this.modelCoeffs);
  }

  predict(gx, gy, screenWidth, screenHeight) {
    if (!this.isCalibrated || !this.modelCoeffs) {
      // Fallback proporcional se ainda não calibrado
      return {
        x: gx * screenWidth,
        y: gy * screenHeight
      };
    }

    const { wx, wy } = this.modelCoeffs;
    const features = [1, gx, gy, gx * gy];

    let px = 0;
    let py = 0;
    for (let i = 0; i < features.length; i++) {
      px += wx[i] * features[i];
      py += wy[i] * features[i];
    }

    // Clamp suave nas bordas da tela
    px = Math.max(-50, Math.min(screenWidth + 50, px));
    py = Math.max(-50, Math.min(screenHeight + 50, py));

    return { x: px, y: py };
  }

  _invertMatrix(M) {
    const n = M.length;
    // Cria matriz aumentada [M | I]
    const A = M.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
    ]);

    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }

      if (maxEl < 1e-12) return null; // Singular

      const tmp = A[maxRow];
      A[maxRow] = A[i];
      A[i] = tmp;

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < 2 * n; j++) {
          if (i === j) {
            A[k][j] = 0;
          } else {
            A[k][j] += c * A[i][j];
          }
        }
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      for (let k = i - 1; k >= 0; k--) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < 2 * n; j++) {
          A[k][j] += c * A[i][j];
        }
      }
      const div = A[i][i];
      for (let j = 0; j < 2 * n; j++) {
        A[i][j] /= div;
      }
    }

    return A.map(row => row.slice(n));
  }
}
