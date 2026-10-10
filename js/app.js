import { EyeTracker } from './eye_tracker.js';
import { Calibrator } from './calibrator.js';
import { AdaptiveGazeFilter, TemporalQuadrantClassifier } from './smooth_filter.js';
import { sounds } from './audio.js';

class App {
  constructor() {
    this.stage = 'framing'; // 'framing' | 'prepare' | 'calibrating' | 'quadrants'
    
    // Módulos principais
    this.eyeTracker = null;
    this.calibrator = new Calibrator();
    this.gazeFilter = new AdaptiveGazeFilter();
    // Classificador temporal por média móvel (janela de 750ms para eliminar 100% do flickering)
    this.quadrantClassifier = new TemporalQuadrantClassifier(750, 0.55);

    // Elementos DOM
    this.videoEl = document.getElementById('webcam-video');
    this.canvasEl = document.getElementById('webcam-canvas');
    this.gazeCursor = document.getElementById('gaze-cursor');
    this.gazeTrail = document.getElementById('gaze-trail');
    
    // Telas/Estágios
    this.stageFraming = document.getElementById('stage-framing');
    this.stagePrepare = document.getElementById('stage-prepare');
    this.stageCalibrating = document.getElementById('stage-calibrating');
    this.stageQuadrants = document.getElementById('stage-quadrants');
    this.prepareNumberEl = document.getElementById('prepare-number');

    // Elementos de Calibração
    this.calibTarget = document.getElementById('calibration-target');
    this.calibStepText = document.getElementById('calib-step-text');
    this.calibProgressRing = document.getElementById('calib-progress-ring');
    this.calibTimer = null;

    // Elementos de Quadrantes / Botões
    this.quadrantCards = {
      'left-rest': document.getElementById('quad-left-rest'),
      'right-top': document.getElementById('quad-right-top'),
      'right-bottom': document.getElementById('quad-right-bottom')
    };

    // Parâmetros configuráveis
    this.dwellTimeMs = 1200; // Tempo de fixação em ms
    this.currentFocusedQuadrant = null;
    this.focusStartTime = null;
    this.lastTriggeredTime = 0;
    this.cooldownMs = 1500; // Intervalo para não repetir a mesma seleção

    // Diagnósticos
    this.fpsValue = document.getElementById('diag-fps');
    this.gazeCoordsValue = document.getElementById('diag-gaze');
    this.quadConfidenceValue = document.getElementById('diag-quadrant');
    this.showCursor = false; // Desativa o cursor individual para focar apenas no quadrado selecionado

    this.initEventListeners();
  }

  initEventListeners() {
    // Botão Iniciar Câmera / Calibração
    document.getElementById('btn-start-calibration').addEventListener('click', () => {
      this.startCalibrationFlow();
    });

    document.getElementById('btn-recalibrate').addEventListener('click', () => {
      this.startCalibrationFlow();
    });

    document.getElementById('btn-return-framing').addEventListener('click', () => {
      this.setStage('framing');
    });

    // Controles de Sensibilidade e Dwell Time
    const dwellSlider = document.getElementById('slider-dwell');
    const dwellDisplay = document.getElementById('val-dwell');
    if (dwellSlider) {
      dwellSlider.addEventListener('input', (e) => {
        this.dwellTimeMs = parseInt(e.target.value, 10);
        dwellDisplay.textContent = `${(this.dwellTimeMs / 1000).toFixed(1)}s`;
      });
    }

    const windowSlider = document.getElementById('slider-window');
    const windowDisplay = document.getElementById('val-window');
    if (windowSlider) {
      windowSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.quadrantClassifier.setWindowMs(val);
        windowDisplay.textContent = `${(val / 1000).toFixed(2)}s`;
      });
    }

    // Atalhos de teclado para facilidade de teste
    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') {
        this.startCalibrationFlow();
      }
      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => console.log(err));
        } else {
          document.exitFullscreen().catch(err => console.log(err));
        }
      }
    });
  }

  async start() {
    try {
      this.eyeTracker = new EyeTracker(
        this.videoEl,
        this.canvasEl,
        (gaze, fps) => this.onGazeFrame(gaze, fps)
      );
      await this.eyeTracker.init();
      document.getElementById('framing-status-pill').textContent = "● Câmera Ativa & Rosto Detectado";
      document.getElementById('framing-status-pill').className = "status-pill active";
      document.getElementById('btn-start-calibration').disabled = false;
    } catch (err) {
      console.error("Erro ao inicializar webcam/FaceMesh:", err);
      document.getElementById('framing-status-pill').textContent = "❌ Erro ao acessar webcam: " + err.message;
      document.getElementById('framing-status-pill').className = "status-pill error";
    }
  }

  setStage(newStage) {
    this.stage = newStage;
    this.stageFraming.classList.toggle('active', newStage === 'framing');
    if (this.stagePrepare) this.stagePrepare.classList.toggle('active', newStage === 'prepare');
    this.stageCalibrating.classList.toggle('active', newStage === 'calibrating');
    this.stageQuadrants.classList.toggle('active', newStage === 'quadrants');

    if (newStage === 'quadrants') {
      this.gazeCursor.style.display = this.showCursor ? 'block' : 'none';
    } else {
      this.gazeCursor.style.display = 'none';
    }
  }

  startCalibrationFlow() {
    this.setStage('prepare');
    let count = 3;
    if (this.prepareNumberEl) this.prepareNumberEl.textContent = count;
    sounds.playBeep(440, 0.15, 'sine');

    const countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        if (this.prepareNumberEl) this.prepareNumberEl.textContent = count;
        sounds.playBeep(440, 0.15, 'sine');
      } else {
        clearInterval(countdownInterval);
        sounds.playBeep(880, 0.25, 'triangle');
        this.setStage('calibrating');
        this.calibrator.startCalibration();
        this.gazeFilter.reset();
        this.runNextCalibrationPoint();
      }
    }, 1000);
  }

  runNextCalibrationPoint() {
    const target = this.calibrator.getCurrentTarget(window.innerWidth, window.innerHeight);
    if (!target) {
      // Calibração Concluída!
      sounds.playSuccessJingle();
      setTimeout(() => {
        this.setStage('quadrants');
        sounds.speak("Calibração concluída com sucesso. Sistema pronto.");
      }, 800);
      return;
    }

    // Posiciona o alvo de calibração
    this.calibTarget.style.left = `${target.x}px`;
    this.calibTarget.style.top = `${target.y}px`;
    this.calibStepText.textContent = `Ponto ${target.index + 1} de ${target.total}: Olhe fixamente para o círculo`;
    sounds.playCalibrationChime(target.index + 1);

    // Animação de contagem regressiva no círculo (2.5s por ponto)
    const duration = 2400;
    const startTime = performance.now();

    const updateRing = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const offset = 283 - (283 * progress); // 2 * PI * r (r=45)
      this.calibProgressRing.style.strokeDashoffset = offset;

      if (progress < 1) {
        this.calibTimer = requestAnimationFrame(updateRing);
      } else {
        // Concluiu este ponto
        this.calibrator.finishCurrentPoint(target.x, target.y);
        setTimeout(() => this.runNextCalibrationPoint(), 350);
      }
    };

    if (this.calibTimer) cancelAnimationFrame(this.calibTimer);
    this.calibTimer = requestAnimationFrame(updateRing);
  }

  onGazeFrame(gaze, fps) {
    if (this.fpsValue) this.fpsValue.textContent = fps || '--';

    if (!gaze.faceDetected) {
      if (this.quadConfidenceValue) this.quadConfidenceValue.textContent = "Rosto não detectado";
      return;
    }

    if (gaze.isBlinking) {
      if (this.quadConfidenceValue) this.quadConfidenceValue.textContent = "Piscando / Olho fechado";
      return;
    }

    // Se estiver na fase de calibração, envia amostras
    if (this.stage === 'calibrating') {
      this.calibrator.addSample(gaze);
      return;
    }

    // Mapeamento do olhar para a tela
    const rawPos = this.calibrator.predict(gaze.gx, gaze.gy, window.innerWidth, window.innerHeight);
    
    // Suavização do ponto de olhar
    const smoothedPos = this.gazeFilter.filter(rawPos.x, rawPos.y);

    if (this.gazeCoordsValue) {
      this.gazeCoordsValue.textContent = `X: ${Math.round(smoothedPos.x)} | Y: ${Math.round(smoothedPos.y)} (gx: ${gaze.gx.toFixed(2)}, gy: ${gaze.gy.toFixed(2)})`;
    }

    if (this.stage === 'quadrants') {
      this.updateGazeCursor(smoothedPos.x, smoothedPos.y);
      this.evaluateQuadrantFocus(smoothedPos.x, smoothedPos.y);
    }
  }

  updateGazeCursor(x, y) {
    if (!this.showCursor) return;
    this.gazeCursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  evaluateQuadrantFocus(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const now = performance.now();

    // Divisão Horizontal:
    // 60% à esquerda: DESCANSO DO OLHAR (área neutra)
    // 40% à direita: SIM (acima) e NÃO (abaixo)
    let instantQuadKey = null;

    if (x < w * 0.60) {
      instantQuadKey = 'left-rest';
    } else if (y < h * 0.50) {
      instantQuadKey = 'right-top'; // SIM
    } else {
      instantQuadKey = 'right-bottom'; // NÃO
    }

    // Alimenta o buffer temporal de média móvel anti-flicker
    this.quadrantClassifier.addSample(x, y, instantQuadKey, now);
    const stable = this.quadrantClassifier.getStableQuadrant();
    const activeQuadKey = stable ? stable.quadKey : instantQuadKey;

    if (this.quadConfidenceValue) {
      if (activeQuadKey === 'left-rest') {
        this.quadConfidenceValue.textContent = "💤 Olhar em Descanso (Neutro - 60% Esq)";
      } else {
        const confPercent = stable ? Math.round(stable.confidence * 100) : 100;
        const name = activeQuadKey === 'right-top' ? 'SIM (Dir Superior)' : 'NÃO (Dir Inferior)';
        this.quadConfidenceValue.textContent = `Focado em: ${name} (${confPercent}%)`;
      }
    }

    // Se estiver na Área de Descanso: apenas destaca e cancela contagens
    if (activeQuadKey === 'left-rest') {
      if (this.currentFocusedQuadrant !== 'left-rest') {
        this._resetQuadrantProgress();
        this.currentFocusedQuadrant = 'left-rest';
        this._highlightQuadrant('left-rest', true);
      }
      return;
    }

    // Gerencia Dwell Time (Tempo de fixação estável) para SIM e NÃO
    if (activeQuadKey !== this.currentFocusedQuadrant) {
      // Mudou de quadrante: reseta contagem
      this._resetQuadrantProgress();
      this.currentFocusedQuadrant = activeQuadKey;
      this.focusStartTime = now;
      this._highlightQuadrant(activeQuadKey, true);
    } else {
      // Mantém fixação firme no mesmo botão (SIM ou NÃO)
      const elapsed = now - this.focusStartTime;
      const progress = Math.min(1, elapsed / this.dwellTimeMs);
      this._updateDwellProgress(activeQuadKey, progress);

      if (progress >= 1 && (now - this.lastTriggeredTime > this.cooldownMs)) {
        this.triggerQuadrantSelection(activeQuadKey);
        this.lastTriggeredTime = now;
        this.focusStartTime = now; // reinicia
      }
    }
  }

  _highlightQuadrant(quadKey, isActive) {
    Object.keys(this.quadrantCards).forEach((k) => {
      const card = this.quadrantCards[k];
      if (k === quadKey && isActive) {
        card.classList.add('focused');
      } else {
        card.classList.remove('focused');
      }
    });
  }

  _updateDwellProgress(quadKey, progress) {
    const card = this.quadrantCards[quadKey];
    if (!card) return;
    const progressBar = card.querySelector('.dwell-progress-fill');
    if (progressBar) {
      progressBar.style.width = `${progress * 100}%`;
    }
  }

  _resetQuadrantProgress() {
    Object.values(this.quadrantCards).forEach((card) => {
      card.classList.remove('focused', 'selected');
      const progressBar = card.querySelector('.dwell-progress-fill');
      if (progressBar) progressBar.style.width = '0%';
    });
  }

  triggerQuadrantSelection(quadKey) {
    const card = this.quadrantCards[quadKey];
    if (!card) return;

    card.classList.add('selected');
    sounds.playBeep(880, 0.25, 'sine');

    const label = card.getAttribute('data-action-label') || card.querySelector('.quadrant-title').textContent;
    sounds.speak(label);

    setTimeout(() => {
      card.classList.remove('selected');
    }, 800);
  }
}

// Inicializa quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.start();
});
