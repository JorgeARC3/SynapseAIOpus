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
    const output = this._outputBuffer.trim();
    const input = this._inputBuffer.trim();
    
    if (output) {
      this.addEntry({
        mode: this._currentMode,
        sourceText: input || '...',
        translatedText: output,
      });
    }

    this._inputBuffer = '';
    this._outputBuffer = '';
  }

  /**
   * Add a translation entry
   */
  addEntry({ mode, sourceText, translatedText, targetLanguage }) {
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

    const sourceBadge = entry.mode === 'asl' ? 'source-asl' : 'source-voice';
    const sourceLabel = entry.mode === 'asl' ? '🤟 ASL' : '🎤 Voice';
    const sourceIcon = entry.mode === 'asl' ? '🤟' : '🎤';
    const detectedLang = entry.mode === 'asl' ? 'ASL' : 'Auto-detected';

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
