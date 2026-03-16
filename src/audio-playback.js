/**
 * Audio Playback Module
 * Plays back PCM 24kHz audio received from Gemini
 */

export class AudioPlayback {
  constructor() {
    this.audioContext = null;
    this.queue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
    this.gainNode = null;
  }

  /**
   * Initialize the audio context for playback
   */
  init() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;
      this.gainNode.connect(this.audioContext.destination);
    }
  }

  /**
   * Add audio chunk for playback (base64 PCM 24kHz)
   */
  playChunk(base64Data) {
    if (!this.audioContext) this.init();

    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert Int16LE to Float32
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      // Schedule playback
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextStartTime);
      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;

    } catch (err) {
      console.error('[AudioPlayback] Error playing chunk:', err);
    }
  }

  /**
   * Flush all queued audio (on interruption)
   */
  flush() {
    this.nextStartTime = 0;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.gainNode = null;
      this.init();
    }
  }

  /**
   * Stop and cleanup
   */
  stop() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.gainNode = null;
    }
    this.nextStartTime = 0;
  }
}
