/**
 * Audio Capture Module
 * Captures microphone audio and streams it as base64 PCM 16kHz
 */

export class AudioCapture {
  constructor() {
    this.audioContext = null;
    this.stream = null;
    this.workletNode = null;
    this.source = null;
    this.onAudioData = null;
    this.isCapturing = false;
  }

  /**
   * Start capturing audio from microphone
   */
  async start() {
    if (this.isCapturing) return;

    try {
      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: 16000 });

      // Load worklet
      const workletUrl = new URL('./audio-worklet-processor.js', import.meta.url);
      await this.audioContext.audioWorklet.addModule(workletUrl);

      // Create source and worklet node
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');

      // Listen for audio data
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio' && this.onAudioData) {
          const base64 = this._arrayBufferToBase64(event.data.data);
          this.onAudioData(base64);
        }
      };

      // Connect pipeline
      this.source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[AudioCapture] Started');
    } catch (err) {
      console.error('[AudioCapture] Failed to start:', err);
      throw err;
    }
  }

  /**
   * Stop capturing audio
   */
  stop() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.isCapturing = false;
    console.log('[AudioCapture] Stopped');
  }

  /**
   * Convert ArrayBuffer to base64
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
