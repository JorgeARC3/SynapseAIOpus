/**
 * ASL Signing Engine — Burst Capture State Machine
 *
 * Captures video frames at 250ms intervals, composes 2×2 composite images,
 * and emits bursts with [CONTINUE] or [COMPLETE] signals for Gemini.
 *
 * State machine:
 *   IDLE → BURST_ACTIVE → BURST_COOLDOWN → IDLE
 *
 * The BURST_COOLDOWN state (750ms) handles natural pauses between ASL words
 * within a phrase, preventing a multi-word phrase from being split into
 * separate interpretations.
 */

export class SigningEngine {
  static IDLE = 'IDLE';
  static BURST_ACTIVE = 'BURST_ACTIVE';
  static BURST_COOLDOWN = 'BURST_COOLDOWN';

  constructor(videoElement) {
    this.video = videoElement;
    this.state = SigningEngine.IDLE;

    // Config
    this.captureIntervalMs = 250;   // Capture every 250ms
    this.framesPerBurst = 4;        // 4 frames → 1 burst (2×2 composite)
    this.cooldownMs = 750;          // Natural pause tolerance

    // Internal state
    this.frameBuffer = [];          // Array of canvas snapshots
    this.burstIndex = 0;
    this.sequenceId = null;
    this.startTime = 0;
    this._captureInterval = null;
    this._cooldownTimer = null;

    // Frame capture canvas (half-resolution for each sub-frame)
    this._frameW = 640;
    this._frameH = 360;
    this._frameCanvas = document.createElement('canvas');
    this._frameCanvas.width = this._frameW;
    this._frameCanvas.height = this._frameH;
    this._frameCtx = this._frameCanvas.getContext('2d');

    // Composite canvas (2×2 grid = 1280×720)
    this._compositeCanvas = document.createElement('canvas');
    this._compositeCtx = this._compositeCanvas.getContext('2d');

    // Callbacks
    this.onBurst = null;        // (compositeBase64, signal, burstIndex, meta)
    this.onStateChange = null;  // (newState, oldState)
  }

  /**
   * Called every frame by hand detector with current hand presence.
   * Drives the state machine.
   */
  updateHandPresence(hasHands) {
    switch (this.state) {
      case SigningEngine.IDLE:
        if (hasHands) {
          this._startSequence();
        }
        break;

      case SigningEngine.BURST_ACTIVE:
        if (!hasHands) {
          this._startCooldown();
        }
        break;

      case SigningEngine.BURST_COOLDOWN:
        if (hasHands) {
          // Hands returned during cooldown — cancel and continue same sequence
          this._cancelCooldown();
        }
        break;
    }
  }

  // ── Sequence lifecycle ────────────────────────────────

  _startSequence() {
    this.sequenceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    this.burstIndex = 0;
    this.frameBuffer = [];
    this.startTime = Date.now();

    this._setState(SigningEngine.BURST_ACTIVE);

    // Start periodic frame capture
    this._captureInterval = setInterval(() => {
      this._captureFrame();
    }, this.captureIntervalMs);

    // Capture first frame immediately
    this._captureFrame();

    console.log(`[SigningEngine] Sequence started: ${this.sequenceId}`);
  }

  _startCooldown() {
    this._setState(SigningEngine.BURST_COOLDOWN);

    this._cooldownTimer = setTimeout(() => {
      this._cooldownTimer = null;
      this._flushAndEnd();
    }, this.cooldownMs);
  }

  _cancelCooldown() {
    if (this._cooldownTimer) {
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = null;
    }
    this._setState(SigningEngine.BURST_ACTIVE);
    console.log(`[SigningEngine] Cooldown cancelled — continuing sequence`);
  }

  _flushAndEnd() {
    // Stop capturing
    if (this._captureInterval) {
      clearInterval(this._captureInterval);
      this._captureInterval = null;
    }

    // Emit remaining frames (or empty) with [COMPLETE]
    this._emitBurst('[COMPLETE]');

    console.log(`[SigningEngine] Sequence ended: ${this.sequenceId}, total bursts: ${this.burstIndex}`);

    // Reset
    this.frameBuffer = [];
    this._setState(SigningEngine.IDLE);
  }

  // ── Frame capture ─────────────────────────────────────

  _captureFrame() {
    if (!this.video || this.video.readyState < 2) return;

    // Draw video onto small canvas (640×360)
    this._frameCtx.drawImage(this.video, 0, 0, this._frameW, this._frameH);

    // Clone canvas into a stored copy
    const copy = document.createElement('canvas');
    copy.width = this._frameW;
    copy.height = this._frameH;
    copy.getContext('2d').drawImage(this._frameCanvas, 0, 0);

    this.frameBuffer.push(copy);

    // Check if we have enough frames for a burst
    if (this.frameBuffer.length >= this.framesPerBurst) {
      this._emitBurst('[CONTINUE]');
    }
  }

  // ── Burst emission ────────────────────────────────────

  _emitBurst(signal) {
    const frames = this.frameBuffer.splice(0, this.framesPerBurst);

    let compositeBase64 = null;

    if (frames.length > 0) {
      compositeBase64 = this._composeGrid(frames);
    }

    const meta = {
      sequenceId: this.sequenceId,
      burstIndex: this.burstIndex,
      elapsedMs: Date.now() - this.startTime,
      frameCount: frames.length,
      isFirst: this.burstIndex === 0,
      totalBursts: this.burstIndex + 1,
    };

    console.log(
      `[SigningEngine] Burst #${this.burstIndex} [${signal}] — ` +
      `${frames.length} frames, ` +
      `${compositeBase64 ? Math.round(compositeBase64.length / 1024) + 'KB' : 'no image'}, ` +
      `elapsed: ${meta.elapsedMs}ms`
    );

    if (this.onBurst) {
      this.onBurst(compositeBase64, signal, this.burstIndex, meta);
    }

    this.burstIndex++;
  }

  /**
   * Compose frames into a 2×2 grid image
   */
  _composeGrid(frames) {
    const cols = Math.min(frames.length, 2);
    const rows = Math.ceil(frames.length / 2);

    this._compositeCanvas.width = this._frameW * cols;
    this._compositeCanvas.height = this._frameH * rows;

    // Clear
    this._compositeCtx.fillStyle = '#000';
    this._compositeCtx.fillRect(0, 0, this._compositeCanvas.width, this._compositeCanvas.height);

    // Draw each frame into its grid cell
    frames.forEach((canvas, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this._compositeCtx.drawImage(canvas, col * this._frameW, row * this._frameH);
    });

    // Add frame numbers for Gemini's understanding
    this._compositeCtx.fillStyle = 'rgba(255,255,255,0.8)';
    this._compositeCtx.font = 'bold 20px Arial';
    frames.forEach((_, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this._compositeCtx.fillText(
        `F${i + 1}`,
        col * this._frameW + 10,
        row * this._frameH + 28
      );
    });

    const dataUrl = this._compositeCanvas.toDataURL('image/jpeg', 0.9);
    return dataUrl.split(',')[1];
  }

  // ── Cleanup ───────────────────────────────────────────

  stop() {
    if (this._captureInterval) {
      clearInterval(this._captureInterval);
      this._captureInterval = null;
    }
    if (this._cooldownTimer) {
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = null;
    }
    this.frameBuffer = [];
    this.state = SigningEngine.IDLE;
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    console.log(`[SigningEngine] ${old} → ${newState}`);
    if (this.onStateChange) {
      this.onStateChange(newState, old);
    }
  }
}
