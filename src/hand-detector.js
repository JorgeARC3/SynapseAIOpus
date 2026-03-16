/**
 * MediaPipe Hand Detector
 * Detects hands in camera feed — reports raw frame-by-frame presence
 * for the SigningEngine, plus landmarks for visualization.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class HandDetector {
  constructor() {
    this.handLandmarker = null;
    this.isRunning = false;
    this._animFrameId = null;

    // Callbacks
    this.onPresence = null;   // (hasHands, landmarks[]) — fires EVERY frame
    this.onLandmarks = null;  // (landmarks[]) — for visualization
  }

  /**
   * Initialize MediaPipe HandLandmarker
   */
  async init() {
    try {
      console.log('[HandDetector] Initializing MediaPipe...');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      console.log('[HandDetector] MediaPipe initialized');
    } catch (err) {
      console.error('[HandDetector] Failed to initialize:', err);
      throw err;
    }
  }

  /**
   * Start detecting hands on the video element.
   * Reports raw per-frame presence to onPresence callback.
   */
  startDetection(videoElement) {
    if (this.isRunning || !this.handLandmarker) return;
    this.isRunning = true;

    let lastTime = -1;

    const detect = () => {
      if (!this.isRunning) return;

      if (videoElement.readyState >= 2) {
        const now = performance.now();
        if (now !== lastTime) {
          lastTime = now;

          try {
            const result = this.handLandmarker.detectForVideo(videoElement, now);
            const hasHands = result.landmarks && result.landmarks.length > 0;

            // Report raw presence every frame (SigningEngine uses this)
            if (this.onPresence) {
              this.onPresence(hasHands, hasHands ? result.landmarks : []);
            }

            // Report landmarks for visualization
            if (this.onLandmarks) {
              this.onLandmarks(hasHands ? result.landmarks : []);
            }
          } catch (err) {
            // Silently skip frame errors
          }
        }
      }

      this._animFrameId = requestAnimationFrame(detect);
    };

    this._animFrameId = requestAnimationFrame(detect);
    console.log('[HandDetector] Detection started');
  }

  /**
   * Stop detection
   */
  stopDetection() {
    this.isRunning = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    console.log('[HandDetector] Detection stopped');
  }
}
