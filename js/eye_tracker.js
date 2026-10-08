/**
 * EyeTracker: Integração com MediaPipe FaceMesh para detecção de íris e geometria ocular de alta precisão.
 */
export class EyeTracker {
  constructor(videoElement, canvasElement, onFrameCallback) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement ? canvasElement.getContext('2d') : null;
    this.onFrame = onFrameCallback;
    
    this.faceMesh = null;
    this.camera = null;
    this.isRunning = false;

    this.lastEyeGaze = null;
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
  }

  async init() {
    // Configura o FaceMesh do MediaPipe
    this.faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // Habilita os 10 pontos da íris (468-477)
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.faceMesh.onResults((results) => this._onFaceMeshResults(results));

    // Inicializa stream de vídeo da webcam do MacBook
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
        frameRate: { ideal: 60 }
      },
      audio: false
    });

    this.video.srcObject = stream;
    await new Promise((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        if (this.canvas) {
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
        }
        resolve();
      };
    });

    // Inicia loop de envio de quadros
    this.isRunning = true;
    this._processVideo();
  }

  async _processVideo() {
    if (!this.isRunning) return;
    if (this.video.readyState >= 2) {
      await this.faceMesh.send({ image: this.video });
    }
    requestAnimationFrame(() => this._processVideo());
  }

  _onFaceMeshResults(results) {
    this._updateFps();

    let eyeGaze = {
      valid: false,
      gx: 0.5,
      gy: 0.5,
      leftEye: null,
      rightEye: null,
      faceDetected: false,
      isBlinking: false
    };

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      eyeGaze.faceDetected = true;

      // Fusão Binocular de Alta Precisão (Olho Direito + Olho Esquerdo)
      const rightEyeInfo = this._extractEyeGeometry(landmarks, 'right');
      const leftEyeInfo = this._extractEyeGeometry(landmarks, 'left');

      eyeGaze.rightEye = rightEyeInfo;
      eyeGaze.leftEye = leftEyeInfo;

      // Limiar seguro para detecção de piscada real
      const rightBlink = rightEyeInfo.openness < 0.07;
      const leftBlink = leftEyeInfo.openness < 0.07;
      const isBlinking = rightBlink && leftBlink;
      eyeGaze.isBlinking = isBlinking;

      if (!isBlinking) {
        if (rightEyeInfo.valid && leftEyeInfo.valid) {
          eyeGaze.valid = true;
          // Fusão ponderada de ambos os olhos para máxima estabilidade
          eyeGaze.gx = (rightEyeInfo.gx + leftEyeInfo.gx) / 2;
          eyeGaze.gy = (rightEyeInfo.gy + leftEyeInfo.gy) / 2;
        } else if (rightEyeInfo.valid) {
          eyeGaze.valid = true;
          eyeGaze.gx = rightEyeInfo.gx;
          eyeGaze.gy = rightEyeInfo.gy;
        } else if (leftEyeInfo.valid) {
          eyeGaze.valid = true;
          eyeGaze.gx = leftEyeInfo.gx;
          eyeGaze.gy = leftEyeInfo.gy;
        }
      }

      // Renderiza feedback visual no canvas espelhado
      if (this.ctx) {
        this._drawDiagnostics(results, eyeGaze);
      }
    } else {
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    this.lastEyeGaze = eyeGaze;
    if (this.onFrame) {
      this.onFrame(eyeGaze, this.fps);
    }
  }

  _extractEyeGeometry(lm, eyeSide) {
    let irisIdx, innerCanthusIdx, outerCanthusIdx, topLidIdx, bottomLidIdx;

    if (eyeSide === 'right') {
      // Olho Direito Anatômico do Paciente (MediaPipe Right Eye)
      irisIdx = 468;
      innerCanthusIdx = 133;
      outerCanthusIdx = 33;
      topLidIdx = 159;
      bottomLidIdx = 145;
    } else {
      // Olho Esquerdo Anatômico do Paciente (MediaPipe Left Eye)
      irisIdx = 473;
      innerCanthusIdx = 362;
      outerCanthusIdx = 263;
      topLidIdx = 386;
      bottomLidIdx = 374;
    }

    const iris = lm[irisIdx];
    const inner = lm[innerCanthusIdx];
    const outer = lm[outerCanthusIdx];
    const top = lm[topLidIdx];
    const bottom = lm[bottomLidIdx];

    if (!iris || !inner || !outer || !top || !bottom) {
      return { valid: false, gx: 0.5, gy: 0.5, openness: 0.2 };
    }

    // Vetor horizontal e vertical entre cantos do olho
    const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    const eyeHeight = Math.hypot(bottom.x - top.x, bottom.y - top.y);
    const openness = eyeHeight / (eyeWidth || 1);

    const minX = Math.min(inner.x, outer.x);
    const maxX = Math.max(inner.x, outer.x);
    const spanX = maxX - minX;

    // Normaliza gx: invertido para refletir a tela espelhada naturalmente
    let rawGx = spanX > 0.001 ? (iris.x - minX) / spanX : 0.5;
    let gx = 1 - rawGx; // Espelhamento natural (olhar para a direita move o cursor para a direita)

    const minY = Math.min(top.y, bottom.y);
    const maxY = Math.max(top.y, bottom.y);
    const spanY = maxY - minY;
    let gy = spanY > 0.001 ? (iris.y - minY) / spanY : 0.5;

    // Clampa valores no intervalo [0, 1]
    gx = Math.max(0, Math.min(1, gx));
    gy = Math.max(0, Math.min(1, gy));

    return {
      valid: true,
      iris,
      inner,
      outer,
      top,
      bottom,
      gx,
      gy,
      openness
    };
  }

  _drawDiagnostics(results, eyeGaze) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Desenha malha facial e contorno dos olhos ativos
    if (window.drawConnectors && results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        window.drawConnectors(ctx, landmarks, window.FACEMESH_FACE_OVAL, {
          color: 'rgba(56, 189, 248, 0.3)',
          lineWidth: 1
        });
        window.drawConnectors(ctx, landmarks, window.FACEMESH_RIGHT_IRIS, {
          color: '#22c55e',
          lineWidth: 2
        });
        window.drawConnectors(ctx, landmarks, window.FACEMESH_LEFT_IRIS, {
          color: '#22c55e',
          lineWidth: 2
        });
      }
    }

    const drawIrisTarget = (eyeInfo, label) => {
      if (!eyeInfo || !eyeInfo.iris) return;
      const p = eyeInfo.iris;
      const px = p.x * w;
      const py = p.y * h;

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#22c55e';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    drawIrisTarget(eyeGaze.rightEye, "Dir");
    drawIrisTarget(eyeGaze.leftEye, "Esq");

    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#22c55e";
    ctx.fillText("👁️ Rastreamento Binocular Ativo", 16, h - 18);

    ctx.restore();
  }

  _updateFps() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  stop() {
    this.isRunning = false;
    if (this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(track => track.stop());
    }
  }
}
