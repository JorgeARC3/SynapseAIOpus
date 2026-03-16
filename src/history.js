/**
 * Translation History Manager
 * Manages and renders translation history entries
 */

export class HistoryManager {
  constructor(listElement) {
    this.listEl = listElement;
    this.entries = [];
    this._emptyState = this.listEl.innerHTML;
    
    // Accumulation buffers for building entries from streaming transcriptions
    this._inputBuffer = '';
    this._outputBuffer = '';
    this._currentMode = 'voice'; // 'voice' or 'asl'
    this._pendingEntry = null;
    this._flushTimeout = null;
  }

  /**
   * Set current translation mode
   */
  setMode(mode) {
    this._currentMode = mode;
  }

  /**
   * Accumulate input transcription text
   */
  addInputText(text) {
    this._inputBuffer += text;
  }

  /**
   * Accumulate output transcription text and schedule entry creation
   */
  addOutputText(text) {
    this._outputBuffer += text;

    // Schedule flush - wait for more text or finalize
    if (this._flushTimeout) clearTimeout(this._flushTimeout);
    this._flushTimeout = setTimeout(() => {
      this._flushEntry();
    }, 1500);
  }

  /**
   * Force flush the current pending entry
   */
  _flushEntry() {
    let output = this._outputBuffer.trim();
    const input = this._inputBuffer.trim();
    let detectedSourceLang = this._detectedLang;

    // 1. Check if Gemini piped the language format into the audio transcript itself
    if (output.includes('|')) {
      const parts = output.split('|');
      detectedSourceLang = parts[0].trim();
      output = parts.slice(1).join('|').trim();
    }

    // 2. Aggressively filter out Markdown rambling if Gemini forgot the rules
    const isRambling = output.startsWith('**') || output.includes("I've begun analyzing") || output.includes("I've reviewed");
    
    if (output && !isRambling) {
      this.addEntry({
        mode: this._currentMode,
        sourceText: input || '...',
        translatedText: output,
        detectedLanguage: detectedSourceLang
      });
    }

    this._inputBuffer = '';
    this._outputBuffer = '';
    this._detectedLang = null;
  }

  /**
   * Set detected language for the current streaming utterance
   */
  setDetectedLanguage(lang) {
    this._detectedLang = lang;
  }

  /**
   * Add a translation entry
   */
  addEntry({ mode, sourceText, translatedText, targetLanguage, detectedLanguage }) {
    // Remove empty state if present
    if (this.entries.length === 0) {
      this.listEl.innerHTML = '';
    }

    const entry = {
      id: Date.now(),
      mode,
      sourceText,
      translatedText,
      targetLanguage: targetLanguage || this._targetLanguage || '?',
      detectedLanguage: detectedLanguage,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    this._renderEntry(entry);
    this._scrollToBottom();
  }

  /**
   * Set target language for display
   */
  setTargetLanguage(lang) {
    this._targetLanguage = lang;
  }

  /**
   * Render a single entry
   */
  _renderEntry(entry) {
    const el = document.createElement('div');
    el.className = 'history-entry';
    el.dataset.id = entry.id;

    // Override detected language if specified, else use fallback
    let detectedLang = entry.detectedLanguage;
    if (!detectedLang) {
      detectedLang = entry.mode === 'asl' ? 'ASL' : 'Auto-detected';
    }

    // If Gemini explicitly detected ASL or we piped it, ensure the styling mode matches
    let finalMode = entry.mode;
    if (detectedLang.toUpperCase().includes('ASL') || detectedLang.toUpperCase().includes('SIGN')) {
      finalMode = 'asl';
      detectedLang = 'ASL';
    }

    const sourceBadge = finalMode === 'asl' ? 'source-asl' : 'source-voice';
    const sourceLabel = finalMode === 'asl' ? '🤟 ASL' : '🎤 Voice';

    const timeStr = entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    el.innerHTML = `
      <div class="history-entry-header">
        <div class="history-entry-source">
          <span class="source-badge ${sourceBadge}">${sourceLabel}</span>
          <span class="history-entry-flow">${detectedLang} → ${entry.targetLanguage}</span>
        </div>
        <span class="history-entry-time">${timeStr}</span>
      </div>
      <div class="history-entry-text">${this._escapeHtml(entry.translatedText)}</div>
    `;

    this.listEl.appendChild(el);
  }

  /**
   * Clear all history
   */
  clear() {
    this.entries = [];
    this.listEl.innerHTML = this._emptyState;
    this._inputBuffer = '';
    this._outputBuffer = '';
  }

  /**
   * Scroll to bottom of history list
   */
  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    });
  }

  /**
   * Escape HTML
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
