/**
 * Camera Module
 * Manages camera feed and frame capture for ASL detection
 */

export class Camera {
  constructor(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.stream = null;
    this.isActive = false;
    this._captureCanvas = document.createElement('canvas');
    this._captureCtx = this._captureCanvas.getContext('2d');
    this._captureCanvas.width = 1280;
    this._captureCanvas.height = 720;
  }

  /**
   * Start camera feed
   */
  async start() {
    if (this.isActive) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });

      this.video.srcObject = this.stream;
      await this.video.play();

      // Match canvas size to video
      this._resizeCanvas();
      this.isActive = true;
      console.log('[Camera] Started');
    } catch (err) {
      console.error('[Camera] Failed to start:', err);
      throw err;
    }
  }

  /**
   * Stop camera
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isActive = false;
    console.log('[Camera] Stopped');
  }

  /**
   * Resize canvas to match video dimensions
   */
  _resizeCanvas() {
    const width = this.video.videoWidth || 640;
    const height = this.video.videoHeight || 480;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Capture current frame as base64 JPEG
   */
  captureFrame() {
    if (!this.isActive || !this.video.videoWidth) return null;

    this._captureCanvas.width = this.video.videoWidth;
    this._captureCanvas.height = this.video.videoHeight;
    this._captureCtx.drawImage(this.video, 0, 0);

    // Get high-quality JPEG base64 (without data:image/jpeg;base64, prefix)
    const dataUrl = this._captureCanvas.toDataURL('image/jpeg', 0.95);
    const base64 = dataUrl.split(',')[1];
    console.log(`[Camera] Frame captured: ${this.video.videoWidth}x${this.video.videoHeight}, size: ${Math.round(base64.length / 1024)}KB`);
    return base64;
  }

  /**
   * Get video element for MediaPipe processing
   */
  getVideoElement() {
    return this.video;
  }

  /**
   * Clear hand landmark overlay
   */
  clearOverlay() {
    if (this.canvas.width && this.canvas.height) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Draw hand landmarks on canvas overlay
   */
  drawLandmarks(landmarks) {
    if (!this.canvas.width) this._resizeCanvas();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const hand of landmarks) {
      // Draw connections
      const connections = [
        [0,1],[1,2],[2,3],[3,4], // thumb
        [0,5],[5,6],[6,7],[7,8], // index
        [0,9],[9,10],[10,11],[11,12], // middle  
        [0,13],[13,14],[14,15],[15,16], // ring
        [0,17],[17,18],[18,19],[19,20], // pinky
        [5,9],[9,13],[13,17] // palm
      ];

      this.ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
      this.ctx.lineWidth = 2;

      for (const [a, b] of connections) {
        if (hand[a] && hand[b]) {
          this.ctx.beginPath();
          this.ctx.moveTo(hand[a].x * this.canvas.width, hand[a].y * this.canvas.height);
          this.ctx.lineTo(hand[b].x * this.canvas.width, hand[b].y * this.canvas.height);
          this.ctx.stroke();
        }
      }

      // Draw landmarks
      for (const point of hand) {
        this.ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
        this.ctx.beginPath();
        this.ctx.arc(
          point.x * this.canvas.width,
          point.y * this.canvas.height,
          4, 0, Math.PI * 2
        );
        this.ctx.fill();
      }
    }
  }
}
