export const getAppTemplate = (): string => `
  <div class="page">
    <header class="hero">
      <div>
        <p class="eyebrow">Multi-Engine OCR</p>
        <h1>Extract text directly in your browser.</h1>
        <p class="subtitle">
          Privacy-first OCR powered by modern browser technologies like WebAssembly and WebGPU.
        </p>
      </div>
    </header>

    <main class="main-grid">
      <section class="panel upload-panel">
        <h2>1. Settings & Source</h2>
        <div class="engine-select">
          <label for="engine-select">OCR engine</label>
          <select id="engine-select"></select>
          <div id="engine-details" class="engine-details"></div>
        </div>
        <div id="language-select-container" class="engine-select hidden">
          <label for="language-select">Language</label>
          <select id="language-select"></select>
          <div id="language-hint" class="field-hint"></div>
        </div>

        <div class="input-methods">
          <div class="method-tabs" role="tablist" aria-label="Image source">
            <button class="method-tab is-active" type="button" data-method="file" role="tab" aria-selected="true">
              Upload
            </button>
            <button class="method-tab" type="button" data-method="url" role="tab" aria-selected="false">
              URL
            </button>
          </div>
          <div class="method-panels">
            <div class="method-panel is-active" data-method="file" role="tabpanel">
              <div class="file-input">
                <label for="file-input" class="method-label">Upload File</label>
                <input id="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/bmp" />
                <div id="file-meta" class="file-meta">No file selected.</div>
              </div>
            </div>

            <div class="method-panel" data-method="url" role="tabpanel">
              <div class="url-input">
                <label for="url-input" class="method-label">Image URL</label>
                <div class="url-row">
                  <input id="url-input" type="url" placeholder="https://example.com/image.jpg" />
                  <button id="load-url-button" class="icon-button" title="Load image from URL">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div id="image-preview-container" class="image-preview-container hidden">
          <div id="preview-wrapper" class="preview-wrapper">
            <img id="image-preview" class="image-preview" src="" alt="Preview" />
            <div id="ocr-overlay" class="ocr-overlay"></div>
          </div>
        </div>

        <div id="translated-image-container" class="image-preview-container hidden">
          <label class="method-label">Translated Image</label>
          <div id="translated-preview-wrapper" class="preview-wrapper">
            <img id="translated-image-preview" class="image-preview" src="" alt="Translated Preview" />
          </div>
          <div class="preview-actions">
             <button id="download-translated" class="ghost-button" type="button">Download PNG</button>
          </div>
        </div>

        <button id="run-button" class="primary-button" type="button">Extract text</button>
      </section>

      <div class="results-column">
        <section class="status-card" data-stage="idle">
          <div class="status-row">
            <span class="status-label">Status</span>
            <span id="status-text">Idle</span>
          </div>
          <div class="progress">
            <div id="progress-bar" class="progress-bar"></div>
          </div>
          <div id="progress-text" class="progress-text">0%</div>
          <div class="metrics">
            <div id="load-metric">Load: --</div>
            <div id="process-metric">Process: --</div>
          </div>
        </section>

      <section class="panel result-panel">
          <div class="result-header">
            <h2>2. OCR output</h2>
            <button id="copy-output-button" class="icon-button hidden" title="Copy all text">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <div id="output" class="output">Upload an image to begin.</div>

          <div class="translate-section">
            <div class="result-header translate-header">
              <h3>Translate</h3>
              <div class="translate-actions">
                <button id="translate-run" class="primary-button" type="button">Translate</button>
                <button id="translate-writeback" class="ghost-button" type="button">Write to image</button>
              </div>
            </div>
            <div class="translate-controls">
              <div class="translate-select">
                <label for="translate-from">From</label>
                <select id="translate-from"></select>
              </div>
              <button id="translate-swap" class="icon-button" type="button" title="Swap languages">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M21 5H9a4 4 0 0 0-4 4v11"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M3 19h12a4 4 0 0 0 4-4V4"></path></svg>
              </button>
              <div class="translate-select">
                <label for="translate-to">To</label>
                <select id="translate-to"></select>
              </div>
              <div class="translate-select">
                <label for="writeback-quality">Write-back</label>
                <select id="writeback-quality">
                  <option value="balanced">Balanced</option>
                  <option value="fast">Fast</option>
                  <option value="high-quality">High quality</option>
                </select>
              </div>
              <button id="translate-copy" class="icon-button" type="button" title="Copy translation">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
            <div class="translate-field">
              <label for="translate-result" class="method-label">Translated text</label>
              <textarea id="translate-result" class="translate-textarea" rows="6" readonly></textarea>
            </div>
            <div id="translate-status" class="translate-status">Idle</div>
            <div id="translate-error" class="translate-error hidden"></div>
          </div>
        </section>
      </div>
      </div>
    </main>

    <section id="error-panel" class="panel error-panel hidden">
      <div class="error-header">
        <h2>Issue detected</h2>
        <button id="retry-button" class="ghost-button" type="button">Retry</button>
      </div>
      <p id="error-message" class="error-message"></p>
      <p id="error-suggestion" class="error-suggestion"></p>
    </section>
  </div>

  <div id="image-modal" class="image-modal hidden">
    <div id="modal-content" class="modal-content">
      <span id="close-modal" class="close-modal">&times;</span>
      <div id="modal-preview-wrapper" class="preview-wrapper">
        <img id="modal-image" class="modal-image" src="" alt="Enlarged Preview" />
        <div id="ocr-overlay-modal" class="ocr-overlay"></div>
      </div>
    </div>
  </div>
  <div id="drop-overlay" class="drop-overlay hidden">
    <div class="drop-content">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
      <span>Drop image to process</span>
    </div>
  </div>
`;
