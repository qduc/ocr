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
import { SUPPORTED_LANGUAGES } from '@/utils/language-config';

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
          <h2>2. OCR output</h2>
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
    !ocrOverlay
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
  let selectedLanguage: string = 'english';
  let activeEngineId: string | null = null;
  let activeLanguage: string | null = null;
  let currentPreviewUrl: string | null = null;
  let lastResult: OCRResult | null = null;
  let lastProcessedWidth: number = 0;
  let lastProcessedHeight: number = 0;

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
    runButton.textContent = busy ? 'Working…' : 'Extract text';
  };

  const registerDefaultEngines = (): void => {
    engineFactory.register('tesseract', async () => {
      const { TesseractEngine } = await import('@/engines/tesseract-engine');
      return new TesseractEngine((status: string, progress?: number): void => {
        const percent = Math.round((progress ?? 0) * 100);
        setStage('loading', `Loading OCR engine: ${status}`, percent);
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
        onProgress: (status: string, progress: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading eSearch-OCR: ${status}`, percent);
        },
      });
    });
  };

  const updateEngineDetails = (engineId: string): void => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      engineDetails.textContent = 'Unknown engine configuration.';
      return;
    }

    const gpuNote = config.requiresWebGPU && !capabilities.webgpu ? 'WebGPU not detected, CPU fallback in use.' : '';
    engineDetails.textContent = `${config.description} • ${config.supportedLanguages.join(', ')}${gpuNote ? ` • ${gpuNote}` : ''}`;
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

  const populateLanguages = (): void => {
    languageSelect.innerHTML = '';
    for (const [key, name] of Object.entries(SUPPORTED_LANGUAGES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      languageSelect.append(option);
    }
    languageSelect.value = selectedLanguage;
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
      languageSelectContainer.classList.toggle('hidden', selectedEngineId !== 'esearch');
    }
  };

  const switchEngine = async (engineId: string, manageBusy: boolean = true): Promise<void> => {
    const engineName = ENGINE_CONFIGS[engineId]?.name ?? engineId;
    const langSuffix = engineId === 'esearch' ? ` (${SUPPORTED_LANGUAGES[selectedLanguage]})` : '';
    setStage('loading', `Switching to ${engineName}${langSuffix}...`, 0);
    if (manageBusy) {
      setBusy(true);
    }
    try {
      const loadStart = performance.now();
      await ocrManager.setEngine(engineId, { language: selectedLanguage });
      setLoadMetric(performance.now() - loadStart);
      engineReady = true;
      activeEngineId = engineId;
      activeLanguage = selectedLanguage;
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
    populateLanguages();
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
    } else {
      imagePreview.src = '';
      imagePreviewContainer.classList.add('hidden');
      ocrOverlay.innerHTML = '';
      lastResult = null;
    }
  });

  engineSelect.addEventListener('change', (): void => {
    selectedEngineId = engineSelect.value;
    engineReady = false;
    activeEngineId = null;
    setStoredEngine(selectedEngineId);
    updateEngineDetails(selectedEngineId);
    languageSelectContainer.classList.toggle('hidden', selectedEngineId !== 'esearch');
    void switchEngine(selectedEngineId);
  });

  languageSelect.addEventListener('change', (): void => {
    selectedLanguage = languageSelect.value;
    engineReady = false;
    activeLanguage = null;
    if (selectedEngineId === 'esearch') {
      void switchEngine(selectedEngineId);
    }
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

      const languageMismatch = selectedEngineId === 'esearch' && activeLanguage !== selectedLanguage;
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

  const drawBoxes = (items: OCRResult['items'], originalWidth: number, originalHeight: number): void => {
    if (!items) return;
    ocrOverlay.innerHTML = '';

    // Wait for image to load to get its displayed dimensions
    const updateOverlay = (): void => {
      const displayWidth = imagePreview.clientWidth;
      const displayHeight = imagePreview.clientHeight;

      const scaleX = displayWidth / originalWidth;
      const scaleY = displayHeight / originalHeight;

      items.forEach((item) => {
        const box = document.createElement('div');
        box.className = 'ocr-box';
        box.style.left = `${item.boundingBox.x * scaleX}px`;
        box.style.top = `${item.boundingBox.y * scaleY}px`;
        box.style.width = `${item.boundingBox.width * scaleX}px`;
        box.style.height = `${item.boundingBox.height * scaleY}px`;
        box.title = `${item.text} (${Math.round(item.confidence * 100)}%)`;
        box.setAttribute('data-text', item.text);
        const topPos = item.boundingBox.y * scaleY;
        if (topPos < 32) {
          box.classList.add('at-top');
        }
        ocrOverlay.appendChild(box);
      });
    };

    if (imagePreview.complete) {
      updateOverlay();
    } else {
      imagePreview.onload = updateOverlay;
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
