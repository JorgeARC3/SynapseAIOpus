/**
 * Synapse Translator — Main Application Orchestrator
 * Wires together: Gemini Live, Audio, Camera, HandDetector, SigningEngine, History
 */

import './style.css';
import { GeminiLiveManager } from './gemini-live.js';
import { AudioCapture } from './audio-capture.js';
import { AudioPlayback } from './audio-playback.js';
import { Camera } from './camera.js';
import { HandDetector } from './hand-detector.js';
import { SigningEngine } from './signing-engine.js';
import { HistoryManager } from './history.js';

// ============================================
// DOM References
// ============================================
const landing = document.getElementById('landing');
const mainApp = document.getElementById('main-app');
const btnGetStarted = document.getElementById('btn-get-started');
const btnBack = document.getElementById('btn-back');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnClearHistory = document.getElementById('btn-clear-history');
const apiKeyInput = document.getElementById('api-key-input');
const targetLanguageSelect = document.getElementById('target-language');
const connectionStatus = document.getElementById('connection-status');
const handStatus = document.getElementById('hand-status');
const cameraOverlay = document.getElementById('camera-overlay');
const cameraVideo = document.getElementById('camera-video');
const handCanvas = document.getElementById('hand-canvas');
const historyList = document.getElementById('history-list');
const modeButtons = document.querySelectorAll('.mode-btn');
const arTagsContainer = document.getElementById('ar-tags-container');

// ============================================
// Module Instances
// ============================================
const gemini = new GeminiLiveManager();
const audioCapture = new AudioCapture();
const audioPlayback = new AudioPlayback();
const camera = new Camera(cameraVideo, handCanvas);
const handDetector = new HandDetector();
const history = new HistoryManager(historyList);
// SigningEngine is created after camera starts (needs video element)
let signingEngine = null;

// ============================================
// App State
// ============================================
let isSessionActive = false;
let currentCognitiveMode = 'bridge'; // 'bridge' | 'emotion' | 'social' | 'clarity' | 'context'
let currentInputType = 'voice';      // 'voice' | 'asl' (used within bridge mode)
let isModelSpeaking = false;      // True while Gemini is producing audio (prevents mic feedback loop)
let micFailsafeTimeout = null;    // Absolute ultimate fallback timeout to guarantee mic unlock
let currentTurnText = '';         // Buffer for streaming text from Gemini

// ============================================
// Load saved API key
// ============================================
const ENV_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const savedKey = localStorage.getItem('synapse_api_key');
apiKeyInput.value = savedKey || ENV_KEY;

// ============================================
// Navigation
// ============================================
btnGetStarted.addEventListener('click', () => {
  landing.classList.add('hidden');
  mainApp.classList.remove('hidden');
});

btnBack.addEventListener('click', () => {
  if (isSessionActive) stopSession();
  mainApp.classList.add('hidden');
  landing.classList.remove('hidden');
});

// ============================================
// Session Control
// ============================================
btnStart.addEventListener('click', startSession);
btnStop.addEventListener('click', stopSession);
btnClearHistory.addEventListener('click', () => history.clear());

apiKeyInput.addEventListener('change', () => {
  localStorage.setItem('synapse_api_key', apiKeyInput.value);
});

// Mode Switching
modeButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    const mode = e.currentTarget.dataset.mode;
    setCognitiveMode(mode);
  });
});


/**
 * Build the system prompt for Gemini
 */
function buildSystemPrompt(targetLanguage) {
  return `You are Synapse, a real-time translator. You operate in two modes:

## MODE 1: VOICE TRANSLATION
When you hear spoken audio:
- Auto-detect the language
- Translate to ${targetLanguage}
- Speak ONLY the translation, nothing else
- If the speech is already in ${targetLanguage}, translate to English instead
- Be concise and natural

## MODE 2: ASL SIGN LANGUAGE (Burst Protocol)
You will receive composite images showing ASL (American Sign Language) hand signs.
Each composite is a 2×2 grid of 4 sequential video frames (labeled F1-F4, captured 250ms apart) showing hand movements over time.

Protocol:
- Messages with [CONTINUE]: More frames are coming. Analyze the composite image to understand the hand shapes and movement trajectory. Do NOT respond. Do NOT generate any audio or text. Accumulate context silently.
- Messages with [COMPLETE]: All frames for this signing sequence have been sent. Now:
  1. Review ALL composite images you received in this sequence  
  2. Analyze the temporal flow of hand positions across all frames
  3. Identify the ASL SIGN (word or phrase), NOT individual fingerspelled letters
  4. Translate the meaning to ${targetLanguage}
  5. Respond with ONLY the spoken translation

ASL interpretation tips:
- ASL signs are defined by: handshape + movement + location relative to body
- Look at how hands CHANGE position across the F1→F2→F3→F4 sequence
- Common signs: wave=hello, flat hand chin→forward=thank you, fist nod=yes, pinky+index+thumb=I love you
- Focus on COMPLETE SIGNS (words/phrases), not fingerspelling individual letters

## CRITICAL RULES:
- NEVER add commentary, explanations, or descriptions of what you see
- NEVER say things like "I see a hand" or "The person appears to be signing"
- NEVER repeat or translate system commands ([CONTINUE], [COMPLETE], [ASL_SIGNING_START], [SYS_UPDATE])
- NEVER translate your OWN previous audio responses — if you hear your own voice being played back, IGNORE it completely
- If you truly cannot identify any sign, say only: "No reconocido" (or equivalent in ${targetLanguage})
- Your response must be ONLY the translated word or phrase, spoken naturally and concisely
- When translating voice, do NOT translate background noise, music, or echoed audio
- IMPORTANT: Any text output you generate MUST follow this exact format: "[Source Language] | [Content]". Example: "English | Hola". If the source is ASL, use "ASL | [Content]". NEVER output text outside of this strict format. Do NOT include markdown or your thought process!`;
}

async function startSession() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter your Gemini API key');
    apiKeyInput.focus();
    return;
  }

  localStorage.setItem('synapse_api_key', apiKey);
  const targetLanguage = targetLanguageSelect.value;
  history.setTargetLanguage(targetLanguage);

  const systemPrompt = buildSystemPrompt(targetLanguage);

  try {
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');

    // Initialize hand detector
    if (!handDetector.handLandmarker) {
      updateStatus('connecting', 'Loading AI...');
      await handDetector.init();
    }

    // Connect to Gemini
    updateStatus('connecting', 'Connecting...');
    await gemini.connect(apiKey, targetLanguage, systemPrompt);

    // Start camera
    await camera.start();
    cameraOverlay.classList.add('hidden');

    // Create signing engine with the video element
    signingEngine = new SigningEngine(camera.getVideoElement());
    wireSigningEngine();

    // Start audio capture
    await audioCapture.start();

    // Start hand detection
    handDetector.startDetection(camera.getVideoElement());

    // Init audio playback
    audioPlayback.init();

    isSessionActive = true;
    updateInputType('voice');

    console.log('[App] Session started in mode:', currentCognitiveMode);
  } catch (err) {
    console.error('[App] Failed to start session:', err);
    alert('Failed to start session: ' + err.message);
    stopSession();
  }
}

function stopSession() {
  isSessionActive = false;

  gemini.disconnect();
  audioCapture.stop();
  audioPlayback.stop();
  camera.stop();
  handDetector.stopDetection();
  if (signingEngine) signingEngine.stop();

  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  cameraOverlay.classList.remove('hidden');
  updateInputType('idle');
  updateStatus('disconnected', 'OFFLINE');
  updateHandStatus(false);
  isModelSpeaking = false;

  console.log('[App] Session stopped');
}

// ============================================
// Mode Management
// ============================================
function setCognitiveMode(mode) {
  currentCognitiveMode = mode;
  
  // Update UI dock
  modeButtons.forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // If session is active, we need to update Gemini's system prompt dynamically
  if (isSessionActive) {
    history.addOutputText(`[SYS_UPDATE] Switched to ${mode.toUpperCase()} mode.`);
    const lang = targetLanguageSelect.value;
    let modePrompt = '';

    switch (mode) {
      case 'bridge':
        modePrompt = `You are now in BRIDGE MODE. Function as a normal voice/ASL translator to ${lang}. Speak the translation concisely. You MUST also output a TEXT response with the format: "[Source Language] | [Translation]". Example: "English | Hola". CRITICAL: Output ONLY this exact format in text, do NOT output your thought process!`;
        break;
      case 'emotion':
        modePrompt = `You are now in EMOTION MODE. Analyze the facial expressions, vocal tone, and words of the speaker. Provide a very concise emotional reading. You MUST output your analysis as a TEXT response with the format: "[Source Language] | Emotion: [Emotion] - [Reason]". Example: "English | Emotion: Happy - Smiling". CRITICAL: Output ONLY this exact format in text.`;
        break;
      case 'social':
        modePrompt = `You are now in SOCIAL MODE. Analyze body language, eye contact, and conversational dynamics. Provide a very concise social cue alert. You MUST output your analysis as a TEXT response with the format: "[Source Language] | Social Cue: [Observation] - [Advice]". Example: "English | Social Cue: Eye contact lost - Regain attention". CRITICAL: Output ONLY this exact format in text.`;
        break;
      case 'clarity':
        modePrompt = `You are now in CLARITY MODE. The speaker will talk about complex topics or ramble. You must SIMPLIFY their speech into 2-3 concise bullet points. You MUST output the bullet points as a TEXT response with the format: "[Source Language] | [Bullet Points]". CRITICAL: Output ONLY this exact format in text.`;
        break;
      case 'context':
        modePrompt = `You are now in CONTEXT MODE. Act as a conversational memory assistant. If the user asks what was just said, or asks for relevant background context about the current topic, provide it. You MUST output the context as a TEXT response with the format: "[Source Language] | [Context]". CRITICAL: Output ONLY this exact format in text.`;
        break;
    }

    gemini.sendSystemUpdate(modePrompt);
  }
}

function updateInputType(type) {
  currentInputType = type;
  if (currentCognitiveMode === 'bridge') {
    history.setMode(type === 'asl' ? 'asl' : 'voice');
  }
}

// ============================================
// Status Updates
// ============================================
function updateStatus(state, text) {
  connectionStatus.classList.remove('status-disconnected', 'status-connecting', 'status-connected', 'status-error');
  connectionStatus.classList.add(`status-${state}`);
  const statusText = connectionStatus.querySelector('.status-text');
  if (text) statusText.textContent = text;
}

function updateHandStatus(active) {
  if (active) {
    handStatus.classList.add('active');
    handStatus.querySelector('span:last-child').textContent = 'HANDS DETECTED';
  } else {
    handStatus.classList.remove('active');
    handStatus.querySelector('span:last-child').textContent = 'NO HANDS';
  }
}

// ============================================
// Wire SigningEngine callbacks
// ============================================
function wireSigningEngine() {
  // On burst: send composite image + signal to Gemini
  signingEngine.onBurst = (compositeBase64, signal, burstIndex, meta) => {
    if (!isSessionActive || !gemini.isConnected) return;
    gemini.sendBurst(compositeBase64, signal, burstIndex, meta);
  };

  // On state change: update UI mode
  signingEngine.onStateChange = (newState, oldState) => {
    if (newState === SigningEngine.BURST_ACTIVE && oldState === SigningEngine.IDLE) {
      updateInputType('asl');
      updateHandStatus(true);
    } else if (newState === SigningEngine.IDLE) {
      // Delay switching back to voice to let Gemini respond first
      setTimeout(() => {
        if (signingEngine.state === SigningEngine.IDLE) {
          updateInputType('voice');
          updateHandStatus(false);
          camera.clearOverlay();
        }
      }, 1000);
    }
  };
}

// ============================================
// Gemini Callbacks
// ============================================
gemini.on('onAudio', (base64Data) => {
  // Mark that model is speaking (mute mic to prevent feedback)
  isModelSpeaking = true;
  audioPlayback.playChunk(base64Data);
  
  // Failsafe: if the network drops onTurnComplete, force unlock mic after 8s of no chunks
  clearTimeout(micFailsafeTimeout);
  micFailsafeTimeout = setTimeout(() => {
    isModelSpeaking = false;
    console.log('[App] Failsafe: Mic forcefully unlocked after 8s of no audio chunks');
  }, 8000);
});

gemini.on('onInputTranscription', (text) => {
  history.addInputText(text);
});

gemini.on('onOutputTranscription', (text) => {
  // Add clean text to the transcript view
  const cleanText = text.trim();
  if (cleanText) {
    history.addOutputText(cleanText);
  }
});

gemini.on('onTextContent', (text) => {
  // Buffer the text chunk. We draw tags when the turn completes to allow parsing.
  currentTurnText += text;
});

gemini.on('onInterrupted', () => {
  audioPlayback.flush();
  isModelSpeaking = false;
});

gemini.on('onStatus', (status) => {
  switch (status) {
    case 'connecting':
      updateStatus('connecting', 'Connecting...');
      break;
    case 'connected':
      updateStatus('connected', 'ONLINE');
      break;
    case 'disconnected':
      updateStatus('disconnected', 'OFFLINE');
      if (isSessionActive) stopSession();
      break;
    case 'error':
      updateStatus('error', 'ERROR');
      break;
  }
});

gemini.on('onTurnComplete', () => {
  // Render AR Tags from accumulated text
  if (currentTurnText) {
    let textToDisplay = '';
    let detectedSourceLanguage = '';

    const trimmed = currentTurnText.trim();
    
    // Check if Gemini followed the "[Language] | [Text]" format
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|');
      detectedSourceLanguage = parts[0].trim();
      textToDisplay = parts.slice(1).join('|').trim();
    } else {
      textToDisplay = trimmed;
    }

    // Filter out obvious markdown/rambling if format failed
    const isRambling = textToDisplay.startsWith('**') || textToDisplay.includes("I\'ve") || textToDisplay.includes("I\'m") || textToDisplay.includes("I will");
    
    if (!isRambling && textToDisplay.length > 0 && textToDisplay.length < 200) {
      if (detectedSourceLanguage) {
        history.setDetectedLanguage(detectedSourceLanguage);
      }

      // Render the filtered AR Tag
      const tag = document.createElement('div');
      tag.className = 'ar-tag';
      tag.textContent = textToDisplay;

      arTagsContainer.appendChild(tag);

      // Keep only the last 3 tags
      while (arTagsContainer.children.length > 3) {
        arTagsContainer.removeChild(arTagsContainer.firstChild);
      }

      // Auto-remove after 8 seconds
      setTimeout(() => {
        if (tag.parentNode) {
          tag.style.opacity = '0';
          tag.style.transition = 'opacity 0.5s ease-out';
          setTimeout(() => tag.remove(), 500);
        }
      }, 8000);
    }

    // Reset buffer for the next turn
    currentTurnText = '';
  }

  // Model finished sending response payload, but audio might still be playing out of speakers!
  // Wait until the audioPlayback context actually depletes its buffer before unmuting the mic.
  if (audioPlayback.isStillPlaying()) {
    const checkInterval = setInterval(() => {
      if (!audioPlayback.isStillPlaying() || !isSessionActive) {
        isModelSpeaking = false;
        clearInterval(checkInterval);
        clearTimeout(micFailsafeTimeout);
      }
    }, 100);

    // Fallback for the interval itself
    setTimeout(() => {
      clearInterval(checkInterval);
      isModelSpeaking = false;
      clearTimeout(micFailsafeTimeout);
    }, 10000);
  } else {
    isModelSpeaking = false;
    clearTimeout(micFailsafeTimeout);
  }
});

gemini.on('onError', (error) => {
  console.error('[App] Gemini error:', error);
});

// ============================================
// Audio Capture Callback (with mic muting)
// ============================================
audioCapture.onAudioData = (base64Data) => {
  // Don't send mic audio while Gemini is speaking (prevents self-translation)
  // Also don't send audio while we are actively bursting ASL images
  const isASLActive = signingEngine && signingEngine.state !== SigningEngine.IDLE;
  if (isSessionActive && gemini.isConnected && !isModelSpeaking && !isASLActive) {
    gemini.sendAudio(base64Data);
  }
};

// ============================================
// Hand Detector Callbacks
// ============================================
handDetector.onPresence = (hasHands, landmarks) => {
  // Feed raw presence to signing engine (it manages its own state machine)
  if (signingEngine) {
    signingEngine.updateHandPresence(hasHands);
  }
};

handDetector.onLandmarks = (landmarks) => {
  if (landmarks.length > 0) {
    camera.drawLandmarks(landmarks);
  } else if (signingEngine && signingEngine.state === SigningEngine.IDLE) {
    camera.clearOverlay();
  }
};

// ============================================
// Cleanup on page unload
// ============================================
window.addEventListener('beforeunload', () => {
  if (isSessionActive) stopSession();
});

console.log('[Synapse] App loaded');
