/**
 * Gemini Live API WebSocket Manager
 * Handles connection, audio/video streaming, and transcription
 */

const WS_BASE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

export class GeminiLiveManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.callbacks = {
      onAudio: null,
      onInputTranscription: null,
      onOutputTranscription: null,
      onTurnComplete: null,
      onStatus: null,
      onInterrupted: null,
      onError: null,
      onTextContent: null,
    };
    this._setupComplete = false;
  }

  /**
   * Connect to Gemini Live API
   */
  connect(apiKey, targetLanguage, systemPrompt) {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      this._systemPrompt = systemPrompt;
      const url = `${WS_BASE_URL}?key=${apiKey}`;
      
      this._emitStatus('connecting');
      
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this._emitStatus('error');
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        console.log('[Gemini] WebSocket connected');
        this._sendConfig();
      };

      this.ws.onmessage = async (event) => {
        try {
          // Gemini Live API may send Blob or string messages
          let rawData = event.data;
          if (rawData instanceof Blob) {
            rawData = await rawData.text();
          }

          const response = JSON.parse(rawData);
          this._handleMessage(response);
          
          // Resolve on first setupComplete
          if (!this._setupComplete && response.setupComplete) {
            this._setupComplete = true;
            this.isConnected = true;
            this._emitStatus('connected');
            resolve();
          }
        } catch (err) {
          console.error('[Gemini] Failed to parse message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[Gemini] WebSocket error:', error);
        this._emitStatus('error');
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('[Gemini] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this._setupComplete = false;
        this._emitStatus('disconnected');
      };

      // Timeout
      setTimeout(() => {
        if (!this._setupComplete) {
          reject(new Error('Connection timeout'));
          this.disconnect();
        }
      }, 15000);
    });
  }

  /**
   * Send initial configuration
   */
  _sendConfig() {
    const config = {
      setup: {
        model: `models/${MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          mediaResolution: 'MEDIA_RESOLUTION_HIGH',
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore'
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: this._systemPrompt }]
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      }
    };

    this.ws.send(JSON.stringify(config));
    console.log('[Gemini] Config sent');
  }

  /**
   * Handle incoming messages
   */
  _handleMessage(response) {
    // Debug: log all incoming messages (keys only to avoid flooding)
    const keys = Object.keys(response);
    console.log('[Gemini] Message received, keys:', keys.join(', '));

    // Setup complete
    if (response.setupComplete) {
      console.log('[Gemini] Setup complete');
      return;
    }

    // Server content
    if (response.serverContent) {
      const content = response.serverContent;

      // Audio response
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData) {
            console.log('[Gemini] Audio chunk received, size:', Math.round(part.inlineData.data.length / 1024), 'KB');
            if (this.callbacks.onAudio) {
              this.callbacks.onAudio(part.inlineData.data);
            }
          }
          if (part.text) {
            console.log('[Gemini] Text part in modelTurn:', part.text);
            if (this.callbacks.onTextContent) {
              this.callbacks.onTextContent(part.text);
            }
          }
        }
      }

      // Interrupted
      if (content.interrupted) {
        console.log('[Gemini] Interrupted');
        if (this.callbacks.onInterrupted) {
          this.callbacks.onInterrupted();
        }
      }

      // Input transcription (what user said)
      if (content.inputTranscription?.text) {
        console.log('[Gemini] Input transcription:', content.inputTranscription.text);
        if (this.callbacks.onInputTranscription) {
          this.callbacks.onInputTranscription(content.inputTranscription.text);
        }
      }

      // Output transcription (what Gemini said)
      if (content.outputTranscription?.text) {
        console.log('[Gemini] Output transcription:', content.outputTranscription.text);
        if (this.callbacks.onOutputTranscription) {
          this.callbacks.onOutputTranscription(content.outputTranscription.text);
        }
      }

      // Turn complete
      if (content.turnComplete) {
        console.log('[Gemini] Turn complete');
        if (this.callbacks.onTurnComplete) {
          this.callbacks.onTurnComplete();
        }
      }

      // Grounding metadata or other fields
      if (content.groundingMetadata) {
        console.log('[Gemini] Grounding metadata:', content.groundingMetadata);
      }
    }

    // Tool call
    if (response.toolCall) {
      console.log('[Gemini] Tool call:', response.toolCall);
    }
  }

  /**
   * Send audio chunk (base64 PCM 16kHz)
   */
  sendAudio(base64Data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      realtimeInput: {
        audio: {
          data: base64Data,
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send ASL burst: composite image + signal via clientContent
   *
   * [CONTINUE] → turnComplete: false (Gemini accumulates, no response)
   * [COMPLETE] → turnComplete: true  (Gemini responds with translation)
   */
  sendBurst(compositeBase64, signal, burstIndex, meta) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const parts = [];

    // First burst: explain the protocol to Gemini
    if (meta.isFirst) {
      parts.push({
        text: `[ASL_SIGNING_START] You are receiving a sequence of composite images. Each image is a 2×2 grid of 4 sequential video frames (labeled F1-F4, captured 250ms apart) showing a person performing ASL (American Sign Language) signs. Analyze the hand shapes, movements, and positions across frames to understand the temporal flow of the signing. Do NOT respond until you receive [COMPLETE]. Just process silently.`
      });
    }

    // Add composite image if available
    if (compositeBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: compositeBase64,
        }
      });
    }

    // Add signal
    const isComplete = signal === '[COMPLETE]';

    if (isComplete) {
      parts.push({
        text: `[COMPLETE] All frames sent (${meta.totalBursts} bursts over ${meta.elapsedMs}ms). Now interpret the COMPLETE ASL signing sequence from ALL the composite images above. What ASL sign(s) were performed? Translate to the target language. Say ONLY the translation.`
      });
    } else {
      parts.push({ text: signal });
    }

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: parts
        }],
        turnComplete: isComplete
      }
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[Gemini] Burst #${burstIndex} sent [${signal}], turnComplete=${isComplete}, ${compositeBase64 ? Math.round(compositeBase64.length / 1024) + 'KB' : 'no image'}`);
  }

  /**
   * Send text prompt via clientContent
   */
  sendText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }]
        }],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(message));
    console.log('[Gemini] Text sent:', text);
  }

  /**
   * Send a system command update (simulated as a user prompt instructing the model)
   */
  sendSystemUpdate(promptText) {
    this.sendText(`[SYSTEM_UPDATE] ${promptText}\n\nAcknowledge with OK.`);
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this._setupComplete = false;
    this._emitStatus('disconnected');
  }

  /**
   * Register callbacks
   */
  on(event, callback) {
    if (this.callbacks.hasOwnProperty(event)) {
      this.callbacks[event] = callback;
    }
  }

  _emitStatus(status) {
    if (this.callbacks.onStatus) {
      this.callbacks.onStatus(status);
    }
  }
}
