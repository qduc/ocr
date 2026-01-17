import { FeatureDetector } from '@/utils/feature-detector';
import { EngineFactory } from '@/engines/engine-factory';
import { OCRManager } from '@/ocr-manager';
import { ImageProcessor } from '@/utils/image-processor';
import {
  createInvalidImageError,
  createProcessingFailedError,
  createUnsupportedBrowserError,
  formatErrorMessage,
  logError,
} from '@/utils/error-handling';
import { OCRError } from '@/types/ocr-errors';
import type { OCRResult } from '@/types/ocr-engine';
import { ENGINE_CONFIGS } from '@/types/ocr-models';
import { SUPPORTED_LANGUAGES, TESSERACT_LANGUAGES } from '@/utils/language-config';

type Stage = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

export interface AppOptions {
  root?: HTMLElement | null;
  featureDetector?: FeatureDetector;
  imageProcessor?: ImageProcessor;
  engineFactory?: EngineFactory;
  ocrManager?: OCRManager;
  registerEngines?: (factory: EngineFactory, setStage: (stage: Stage, message: string, progress?: number) => void) => void;
}

export interface AppInstance {
  runOcr: () => Promise<void>;
  elements: {
    fileInput: HTMLInputElement;
    engineSelect: HTMLSelectElement;
    engineDetails: HTMLDivElement;
    runButton: HTMLButtonElement;
    output: HTMLDivElement;
    errorPanel: HTMLDivElement;
    errorMessage: HTMLParagraphElement;
    errorSuggestion: HTMLParagraphElement;
    retryButton: HTMLButtonElement;
    statusText: HTMLSpanElement;
    progressBar: HTMLDivElement;
    progressText: HTMLDivElement;
    loadMetric: HTMLDivElement;
    processMetric: HTMLDivElement;
    imagePreviewContainer: HTMLDivElement;
  };
  setStage: (stage: Stage, message: string, progress?: number) => void;
}

export const initApp = (options: AppOptions = {}): AppInstance => {
  const root = options.root ?? document.querySelector<HTMLElement>('#app');
  if (!root) {
    throw new Error('App root not found.');
  }

  root.innerHTML = `
    <div class="page">
      <header class="hero">
        <div>
          <p class="eyebrow">Multi-Engine OCR</p>
          <h1>Extract text directly in your browser.</h1>
          <p class="subtitle">
            Tesseract.js powers fast local OCR with caching, no uploads, and a clear retry path.
          </p>
        </div>
        <div class="status-card" data-stage="idle">
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
        </div>
      </header>

      <main class="main-grid">
        <section class="panel upload-panel">
          <h2>1. Choose an image</h2>
          <p class="panel-subtitle">JPEG, PNG, WebP, or BMP. We will preprocess for better accuracy.</p>
          <div class="engine-select">
            <label for="engine-select">OCR engine</label>
            <select id="engine-select"></select>
            <div id="engine-details" class="engine-details"></div>
          </div>
          <div id="language-select-container" class="engine-select hidden">
            <label for="language-select">Language</label>
            <select id="language-select"></select>
          </div>
          <div class="file-input">
            <input id="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/bmp" />
            <div id="file-meta" class="file-meta">No file selected.</div>
            <div id="image-preview-container" class="image-preview-container hidden">
              <div id="preview-wrapper" class="preview-wrapper">
                <img id="image-preview" class="image-preview" src="" alt="Preview" />
                <div id="ocr-overlay" class="ocr-overlay"></div>
              </div>
            </div>
          </div>
          <button id="run-button" class="primary-button" type="button">Extract text</button>
        </section>

        <section class="panel result-panel">
          <div class="result-header">
            <h2>2. OCR output</h2>
            <button id="copy-output-button" class="icon-button hidden" title="Copy all text">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <div id="output" class="output">Upload an image to begin.</div>
        </section>
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
  `;

  const statusCard = root.querySelector<HTMLDivElement>('.status-card');
  const statusText = root.querySelector<HTMLSpanElement>('#status-text');
  const progressBar = root.querySelector<HTMLDivElement>('#progress-bar');
  const progressText = root.querySelector<HTMLDivElement>('#progress-text');
  const loadMetric = root.querySelector<HTMLDivElement>('#load-metric');
  const processMetric = root.querySelector<HTMLDivElement>('#process-metric');
  const fileInput = root.querySelector<HTMLInputElement>('#file-input');
  const fileMeta = root.querySelector<HTMLDivElement>('#file-meta');
  const engineSelect = root.querySelector<HTMLSelectElement>('#engine-select');
  const engineDetails = root.querySelector<HTMLDivElement>('#engine-details');
  const languageSelect = root.querySelector<HTMLSelectElement>('#language-select');
  const languageSelectContainer = root.querySelector<HTMLDivElement>('#language-select-container');
  const runButton = root.querySelector<HTMLButtonElement>('#run-button');
  const output = root.querySelector<HTMLDivElement>('#output');
  const errorPanel = root.querySelector<HTMLDivElement>('#error-panel');
  const errorMessage = root.querySelector<HTMLParagraphElement>('#error-message');
  const errorSuggestion = root.querySelector<HTMLParagraphElement>('#error-suggestion');
  const retryButton = root.querySelector<HTMLButtonElement>('#retry-button');
  const imagePreviewContainer = root.querySelector<HTMLDivElement>('#image-preview-container');
  const imagePreview = root.querySelector<HTMLImageElement>('#image-preview');
  const ocrOverlay = root.querySelector<HTMLDivElement>('#ocr-overlay');
  const imageModal = root.querySelector<HTMLDivElement>('#image-modal');
  const modalImage = root.querySelector<HTMLImageElement>('#modal-image');
  const closeModal = root.querySelector<HTMLSpanElement>('#close-modal');
  const ocrOverlayModal = root.querySelector<HTMLDivElement>('#ocr-overlay-modal');
  const copyOutputButton = root.querySelector<HTMLButtonElement>('#copy-output-button');

  if (
    !statusCard ||
    !statusText ||
    !progressBar ||
    !progressText ||
    !loadMetric ||
    !processMetric ||
    !fileInput ||
    !fileMeta ||
    !engineSelect ||
    !engineDetails ||
    !languageSelect ||
    !languageSelectContainer ||
    !runButton ||
    !output ||
    !errorPanel ||
    !errorMessage ||
    !errorSuggestion ||
    !retryButton ||
    !imagePreviewContainer ||
    !imagePreview ||
    !ocrOverlay ||
    !imageModal ||
    !modalImage ||
    !closeModal ||
    !ocrOverlayModal ||
    !copyOutputButton
  ) {
    throw new Error('UI elements missing.');
  }

  const detector = options.featureDetector ?? new FeatureDetector();
  const capabilities = detector.detect();

  const imageProcessor = options.imageProcessor ?? new ImageProcessor();
  const engineFactory = options.engineFactory ?? new EngineFactory();
  const ocrManager = options.ocrManager ?? new OCRManager(engineFactory);
  let selectedFile: File | null = null;
  let engineReady = false;
  let selectedEngineId: string | null = null;
  const selectedLanguages: Record<string, string> = {
    tesseract: 'eng',
    esearch: 'english',
  };
  let activeEngineId: string | null = null;
  let activeLanguage: string | null = null;
  let currentPreviewUrl: string | null = null;
  let lastResult: OCRResult | null = null;
  let lastProcessedWidth: number = 0;
  let lastProcessedHeight: number = 0;

  const languageOptionsByEngine: Record<string, Record<string, string>> = {
    tesseract: TESSERACT_LANGUAGES,
    esearch: SUPPORTED_LANGUAGES,
  };

  const supportsLanguageSelection = (engineId: string): boolean =>
    Boolean(languageOptionsByEngine[engineId]);

  const getLanguageOptions = (engineId: string): Record<string, string> | null =>
    languageOptionsByEngine[engineId] ?? null;

  const getSelectedLanguage = (engineId: string): string => {
    const options = getLanguageOptions(engineId);
    const keys = options ? Object.keys(options) : [];
    const firstOption = keys.length > 0 ? (keys[0] as string) : 'eng';
    const fallback: string = selectedLanguages[engineId] ?? firstOption;
    const selected: string = selectedLanguages[engineId] ?? fallback;

    if (options && !(selected in options)) {
      selectedLanguages[engineId] = fallback;
      return fallback;
    }

    return selected;
  };

  const getLanguageLabel = (engineId: string, language: string): string => {
    const options = getLanguageOptions(engineId);
    return options?.[language] ?? language;
  };

  const setStage = (stage: Stage, message: string, progress: number = 0): void => {
    statusCard.dataset.stage = stage;
    statusText.textContent = message;
    const clamped = Math.min(100, Math.max(0, Math.round(progress)));
    progressBar.style.width = `${clamped}%`;
    progressText.textContent = `${clamped}%`;
  };

  const setLoadMetric = (durationMs: number): void => {
    loadMetric.textContent = `Load: ${Math.round(durationMs)} ms`;
  };

  const setProcessMetric = (durationMs: number): void => {
    processMetric.textContent = `Process: ${Math.round(durationMs)} ms`;
  };

  const setError = (error: unknown): void => {
    const formatted = formatErrorMessage(error);
    const recoverable = error instanceof OCRError ? error.recoverable : true;
    errorPanel.classList.remove('hidden');
    errorMessage.textContent = formatted.message;
    errorSuggestion.textContent = formatted.recoverySuggestion ?? '';
    retryButton.classList.toggle('hidden', !recoverable);
    setStage('error', 'Needs attention', 0);
  };

  const clearError = (): void => {
    errorPanel.classList.add('hidden');
    errorMessage.textContent = '';
    errorSuggestion.textContent = '';
  };

  const setBusy = (busy: boolean): void => {
    runButton.disabled = busy;
    fileInput.disabled = busy;
    engineSelect.disabled = busy;
    languageSelect.disabled = busy;
    runButton.textContent = busy ? 'Working…' : 'Extract text';
  };

  const registerDefaultEngines = (): void => {
    engineFactory.register('tesseract', async (options) => {
      const { TesseractEngine } = await import('@/engines/tesseract-engine');
      return new TesseractEngine({
        language: options?.language,
        onProgress: (status: string, progress?: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading OCR engine: ${status}`, percent);
        },
      });
    });
    engineFactory.register('transformers', async () => {
      const { TransformersEngine } = await import('@/engines/transformers-engine');
      return new TransformersEngine({
        webgpu: capabilities.webgpu,
        onProgress: (status: string, progress: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading Transformers: ${status}`, percent);
        },
      });
    });
    engineFactory.register('esearch', async (options) => {
      const { ESearchEngine } = await import('@/engines/esearch-engine');
      return new ESearchEngine({
        language: options?.language,
        webgpu: capabilities.webgpu,
        onProgress: (status: string, progress: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading eSearch-OCR: ${status}`, percent);
        },
      });
    });
  };

  const formatSupportedLanguages = (engineId: string): string => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      return '';
    }

    const options = getLanguageOptions(engineId);
    if (!options) {
      return config.supportedLanguages.join(', ');
    }

    return config.supportedLanguages.map((language) => options[language] ?? language).join(', ');
  };

  const updateEngineDetails = (engineId: string): void => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      engineDetails.textContent = 'Unknown engine configuration.';
      return;
    }

    const gpuNote = config.requiresWebGPU && !capabilities.webgpu ? 'WebGPU not detected, CPU fallback in use.' : '';
    const languages = formatSupportedLanguages(engineId);
    engineDetails.textContent = `${config.description} • ${languages}${gpuNote ? ` • ${gpuNote}` : ''}`;
  };

  const getStoredEngine = (): string | null => {
    try {
      return localStorage.getItem('ocr.engine');
    } catch {
      return null;
    }
  };

  const setStoredEngine = (engineId: string): void => {
    try {
      localStorage.setItem('ocr.engine', engineId);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  };

  const updateLanguageSelection = (engineId: string): void => {
    const options = getLanguageOptions(engineId);
    const shouldShow = Boolean(options);
    languageSelectContainer.classList.toggle('hidden', !shouldShow);

    if (!options) {
      languageSelect.innerHTML = '';
      return;
    }

    languageSelect.innerHTML = '';
    for (const [key, name] of Object.entries(options)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      languageSelect.append(option);
    }

    const selected = getSelectedLanguage(engineId);
    selectedLanguages[engineId] = selected;
    languageSelect.value = selected;
  };

  const populateEngines = (): void => {
    const engines = engineFactory.getAvailableEngines();
    engineSelect.innerHTML = '';
    for (const engineId of engines) {
      const option = document.createElement('option');
      option.value = engineId;
      option.textContent = ENGINE_CONFIGS[engineId]?.name ?? engineId;
      engineSelect.append(option);
    }

    const preferred = getStoredEngine();
    selectedEngineId = engines.includes(preferred ?? '') ? preferred : engines[0] ?? null;
    if (selectedEngineId) {
      engineSelect.value = selectedEngineId;
      updateEngineDetails(selectedEngineId);
      updateLanguageSelection(selectedEngineId);
    }
  };

  const switchEngine = async (engineId: string, manageBusy: boolean = true): Promise<void> => {
    const engineName = ENGINE_CONFIGS[engineId]?.name ?? engineId;
    const language = getSelectedLanguage(engineId);
    const langSuffix = supportsLanguageSelection(engineId)
      ? ` (${getLanguageLabel(engineId, language)})`
      : '';
    setStage('loading', `Switching to ${engineName}${langSuffix}...`, 0);
    if (manageBusy) {
      setBusy(true);
    }
    try {
      const loadStart = performance.now();
      if (supportsLanguageSelection(engineId)) {
        await ocrManager.setEngine(engineId, { language });
      } else {
        await ocrManager.setEngine(engineId);
      }
      setLoadMetric(performance.now() - loadStart);
      engineReady = true;
      activeEngineId = engineId;
      activeLanguage = supportsLanguageSelection(engineId) ? language : null;
      setStage('idle', `${engineName} ready`, 0);
    } catch (error) {
      logError(error);
      setError(error);
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  };

  if (!capabilities.supported) {
    const error = createUnsupportedBrowserError(capabilities.missing);
    setError(error);
    setBusy(true);
  } else {
    if (options.registerEngines) {
      options.registerEngines(engineFactory, setStage);
    } else {
      registerDefaultEngines();
    }
    populateEngines();
    setStage('idle', 'Ready for upload', 0);
  }

  fileInput.addEventListener('change', (): void => {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }

    selectedFile = fileInput.files?.[0] ?? null;
    fileMeta.textContent = selectedFile
      ? `${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`
      : 'No file selected.';
    output.textContent = selectedFile
      ? 'Image loaded. Click extract to run OCR.'
      : 'Upload an image to begin.';

    if (selectedFile) {
      currentPreviewUrl = URL.createObjectURL(selectedFile);
      imagePreview.src = currentPreviewUrl;
      imagePreviewContainer.classList.remove('hidden');
      ocrOverlay.innerHTML = '';
      lastResult = null;
      copyOutputButton.classList.add('hidden');
    } else {
      imagePreview.src = '';
      imagePreviewContainer.classList.add('hidden');
      ocrOverlay.innerHTML = '';
      lastResult = null;
      copyOutputButton.classList.add('hidden');
    }
  });

  engineSelect.addEventListener('change', (): void => {
    selectedEngineId = engineSelect.value;
    engineReady = false;
    activeEngineId = null;
    setStoredEngine(selectedEngineId);
    updateEngineDetails(selectedEngineId);
    updateLanguageSelection(selectedEngineId);
    void switchEngine(selectedEngineId);
  });

  languageSelect.addEventListener('change', (): void => {
    if (!selectedEngineId || !supportsLanguageSelection(selectedEngineId)) {
      return;
    }

    selectedLanguages[selectedEngineId] = languageSelect.value;
    engineReady = false;
    activeLanguage = null;
    void switchEngine(selectedEngineId);
  });

  const runOcr = async (): Promise<void> => {
    clearError();
    if (!selectedFile) {
      setError(createInvalidImageError('Select an image file before running OCR.'));
      return;
    }

    setBusy(true);
    try {
      if (!selectedEngineId) {
        setError(createProcessingFailedError('No OCR engine selected.'));
        return;
      }

      const languageMismatch =
        supportsLanguageSelection(selectedEngineId) &&
        activeLanguage !== getSelectedLanguage(selectedEngineId);
      if (!engineReady || activeEngineId !== selectedEngineId || languageMismatch) {
        await switchEngine(selectedEngineId, false);
        if (!engineReady || activeEngineId !== selectedEngineId) {
          return;
        }
      }

      setStage('processing', 'Processing image...', 100);
      const imageData = await imageProcessor.fileToImageData(selectedFile);
      const resized = imageProcessor.resize(imageData, 2000);
      const processed =
        selectedEngineId === 'transformers' ? resized : imageProcessor.preprocess(resized);
      const processStart = performance.now();
      const result = await ocrManager.run(processed);
      setProcessMetric(performance.now() - processStart);
      lastResult = result;
      lastProcessedWidth = processed.width;
      lastProcessedHeight = processed.height;

      output.textContent = result.text.trim().length > 0 ? result.text : 'No text detected in this image.';
      copyOutputButton.classList.toggle('hidden', result.text.trim().length === 0);
      if (result.items && result.items.length > 0) {
        drawBoxes(result.items, processed.width, processed.height);
      } else {
        ocrOverlay.innerHTML = '';
      }
      setStage('complete', 'OCR complete', 100);
    } catch (error) {
      logError(error);
      if (error instanceof OCRError) {
        setError(error);
      } else if (error instanceof Error && error.message.includes('Unsupported image format')) {
        setError(createInvalidImageError(error.message));
      } else if (error instanceof Error && error.message.includes('decode')) {
        setError(createInvalidImageError('Image decoding failed. Try a different file.'));
      } else {
        setError(createProcessingFailedError(error instanceof Error ? error.message : undefined));
      }
    } finally {
      setBusy(false);
    }
  };

  runButton.addEventListener('click', (): void => {
    void runOcr();
  });

  retryButton.addEventListener('click', (): void => {
    void runOcr();
  });

  imagePreview.addEventListener('click', (): void => {
    if (imagePreview.src && !imagePreviewContainer.classList.contains('hidden')) {
      modalImage.src = imagePreview.src;
      imageModal.classList.remove('hidden');
      document.body.style.overflow = 'hidden'; // Prevent scrolling

      if (lastResult?.items && lastProcessedWidth && lastProcessedHeight) {
        drawBoxes(lastResult.items, lastProcessedWidth, lastProcessedHeight);
      }
    }
  });

  const closeImageModal = (): void => {
    imageModal.classList.add('hidden');
    modalImage.src = '';
    ocrOverlayModal.innerHTML = '';
    document.body.style.overflow = ''; // Restore scrolling
  };

  imageModal.addEventListener('click', (e: MouseEvent): void => {
    if (e.target === imageModal || e.target === closeModal) {
      closeImageModal();
    }
  });

  document.addEventListener('keydown', (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) {
      closeImageModal();
    }
  });

  copyOutputButton.addEventListener('click', () => {
    const text = output.textContent ?? '';
    if (text && text !== 'Upload an image to begin.' && text !== 'No text detected in this image.') {
      void navigator.clipboard.writeText(text).then(() => {
        const originalHtml = copyOutputButton.innerHTML;
        copyOutputButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-strong)"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyOutputButton.innerHTML = originalHtml;
        }, 2000);
      });
    }
  });

  const renderOverlay = (
    overlay: HTMLDivElement,
    image: HTMLImageElement,
    items: OCRResult['items'],
    originalWidth: number,
    originalHeight: number
  ): void => {
    if (!items) return;
    overlay.innerHTML = '';

    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;

    if (displayWidth === 0 || displayHeight === 0) return;

    const scaleX = displayWidth / originalWidth;
    const scaleY = displayHeight / originalHeight;

    items.forEach((item) => {
      const box = document.createElement('div');
      box.className = 'ocr-box';
      box.style.left = `${item.boundingBox.x * scaleX}px`;
      box.style.top = `${item.boundingBox.y * scaleY}px`;
      box.style.width = `${item.boundingBox.width * scaleX}px`;
      box.style.height = `${item.boundingBox.height * scaleY}px`;
      box.title = `${item.text} (${Math.round(item.confidence * 100)}%) - Click to copy`;
      box.setAttribute('data-text', item.text);

      const topPos = item.boundingBox.y * scaleY;
      if (topPos < 32) {
        box.classList.add('at-top');
      }

      box.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent modal from closing if in modal
        void navigator.clipboard.writeText(item.text).then(() => {
          box.classList.add('copied');
          const originalText = box.getAttribute('data-text');
          box.setAttribute('data-text', 'Copied!');
          setTimeout(() => {
            box.classList.remove('copied');
            box.setAttribute('data-text', originalText || item.text);
          }, 1500);
        });
      });

      overlay.appendChild(box);
    });
  };

  const drawBoxes = (
    items: OCRResult['items'],
    originalWidth: number,
    originalHeight: number
  ): void => {
    if (!items) return;

    const updateMain = (): void => {
      renderOverlay(ocrOverlay, imagePreview, items, originalWidth, originalHeight);
    };

    const updateModal = (): void => {
      renderOverlay(ocrOverlayModal, modalImage, items, originalWidth, originalHeight);
    };

    if (imagePreview.complete) {
      updateMain();
    } else {
      imagePreview.addEventListener('load', updateMain, { once: true });
    }

    if (!imageModal.classList.contains('hidden')) {
      if (modalImage.complete) {
        updateModal();
      } else {
        modalImage.addEventListener('load', updateModal, { once: true });
      }
    }
  };

  window.addEventListener('resize', (): void => {
    if (lastResult?.items && lastProcessedWidth && lastProcessedHeight) {
      drawBoxes(lastResult.items, lastProcessedWidth, lastProcessedHeight);
    }
  });

  return {
    runOcr,
    elements: {
      fileInput,
      engineSelect,
      engineDetails,
      runButton,
      output,
      errorPanel,
      errorMessage,
      errorSuggestion,
      retryButton,
      statusText,
      progressBar,
      progressText,
      loadMetric,
      processMetric,
      imagePreviewContainer,
    },
    setStage,
  };
};
