/**
 * Audio Worklet Processor
 * Captures raw PCM from mic, downsamples to 16kHz, converts to Int16LE
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // ~128ms at 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32 mono channel
    const inputSampleRate = sampleRate; // from AudioWorkletGlobalScope
    const targetRate = 16000;
    const ratio = inputSampleRate / targetRate;

    // Simple downsampling by picking every N-th sample
    for (let i = 0; i < samples.length; i += ratio) {
      const idx = Math.floor(i);
      if (idx < samples.length) {
        this.buffer[this.bufferIndex++] = samples[idx];

        if (this.bufferIndex >= this.bufferSize) {
          // Convert Float32 to Int16LE
          const int16 = new Int16Array(this.bufferSize);
          for (let j = 0; j < this.bufferSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Send to main thread
          this.port.postMessage({
            type: 'audio',
            data: int16.buffer
          }, [int16.buffer]);

          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
