import { FeatureDetector } from '@/utils/feature-detector';
import { EngineFactory } from '@/engines/engine-factory';
import { OCRManager } from '@/ocr-manager';
import { TesseractEngine } from '@/engines/tesseract-engine';
import { TransformersEngine } from '@/engines/transformers-engine';
import { ImageProcessor } from '@/utils/image-processor';
import {
  createInvalidImageError,
  createProcessingFailedError,
  createUnsupportedBrowserError,
  formatErrorMessage,
  logError,
} from '@/utils/error-handling';
import { OCRError } from '@/types/ocr-errors';
import { ENGINE_CONFIGS } from '@/types/ocr-models';

type Stage = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

export interface AppOptions {
  root?: HTMLElement | null;
  featureDetector?: FeatureDetector;
  imageProcessor?: ImageProcessor;
  engineFactory?: EngineFactory;
  ocrManager?: OCRManager;
  registerEngines?: (factory: EngineFactory, setStage: (stage: Stage, message: string, progress?: number) => void) => void;
}

export const initApp = (options: AppOptions = {}) => {
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
          <div class="file-input">
            <input id="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/bmp" />
            <div id="file-meta" class="file-meta">No file selected.</div>
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
  const fileInput = root.querySelector<HTMLInputElement>('#file-input');
  const fileMeta = root.querySelector<HTMLDivElement>('#file-meta');
  const engineSelect = root.querySelector<HTMLSelectElement>('#engine-select');
  const engineDetails = root.querySelector<HTMLDivElement>('#engine-details');
  const runButton = root.querySelector<HTMLButtonElement>('#run-button');
  const output = root.querySelector<HTMLDivElement>('#output');
  const errorPanel = root.querySelector<HTMLDivElement>('#error-panel');
  const errorMessage = root.querySelector<HTMLParagraphElement>('#error-message');
  const errorSuggestion = root.querySelector<HTMLParagraphElement>('#error-suggestion');
  const retryButton = root.querySelector<HTMLButtonElement>('#retry-button');

  if (
    !statusCard ||
    !statusText ||
    !progressBar ||
    !progressText ||
    !fileInput ||
    !fileMeta ||
    !engineSelect ||
    !engineDetails ||
    !runButton ||
    !output ||
    !errorPanel ||
    !errorMessage ||
    !errorSuggestion ||
    !retryButton
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
  let activeEngineId: string | null = null;

  const setStage = (stage: Stage, message: string, progress: number = 0) => {
    statusCard.dataset.stage = stage;
    statusText.textContent = message;
    const clamped = Math.min(100, Math.max(0, Math.round(progress)));
    progressBar.style.width = `${clamped}%`;
    progressText.textContent = `${clamped}%`;
  };

  const setError = (error: unknown) => {
    const formatted = formatErrorMessage(error);
    const recoverable = error instanceof OCRError ? error.recoverable : true;
    errorPanel.classList.remove('hidden');
    errorMessage.textContent = formatted.message;
    errorSuggestion.textContent = formatted.recoverySuggestion ?? '';
    retryButton.classList.toggle('hidden', !recoverable);
    setStage('error', 'Needs attention', 0);
  };

  const clearError = () => {
    errorPanel.classList.add('hidden');
    errorMessage.textContent = '';
    errorSuggestion.textContent = '';
  };

  const setBusy = (busy: boolean) => {
    runButton.disabled = busy;
    fileInput.disabled = busy;
    engineSelect.disabled = busy;
    runButton.textContent = busy ? 'Working…' : 'Extract text';
  };

  const registerDefaultEngines = () => {
    engineFactory.register('tesseract', () => {
      return new TesseractEngine((status, progress) => {
        const percent = Math.round((progress ?? 0) * 100);
        setStage('loading', `Loading OCR engine: ${status}`, percent);
      });
    });
    engineFactory.register('transformers', () => {
      return new TransformersEngine({
        webgpu: capabilities.webgpu,
        onProgress: (status, progress) => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading Transformers: ${status}`, percent);
        },
      });
    });
  };

  const updateEngineDetails = (engineId: string) => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      engineDetails.textContent = 'Unknown engine configuration.';
      return;
    }

    const gpuNote = config.requiresWebGPU && !capabilities.webgpu ? 'WebGPU not detected, CPU fallback in use.' : '';
    engineDetails.textContent = `${config.description} • ${config.supportedLanguages.join(', ')}${gpuNote ? ` • ${gpuNote}` : ''}`;
  };

  const getStoredEngine = () => {
    try {
      return localStorage.getItem('ocr.engine');
    } catch {
      return null;
    }
  };

  const setStoredEngine = (engineId: string) => {
    try {
      localStorage.setItem('ocr.engine', engineId);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  };

  const populateEngines = () => {
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
    }
  };

  const switchEngine = async (engineId: string, manageBusy: boolean = true) => {
    const engineName = ENGINE_CONFIGS[engineId]?.name ?? engineId;
    setStage('loading', `Switching to ${engineName}...`, 0);
    if (manageBusy) {
      setBusy(true);
    }
    try {
      await ocrManager.setEngine(engineId);
      engineReady = true;
      activeEngineId = engineId;
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

  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files?.[0] ?? null;
    fileMeta.textContent = selectedFile
      ? `${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`
      : 'No file selected.';
    output.textContent = selectedFile ? 'Image loaded. Click extract to run OCR.' : 'Upload an image to begin.';
  });

  engineSelect.addEventListener('change', () => {
    selectedEngineId = engineSelect.value;
    engineReady = false;
    activeEngineId = null;
    setStoredEngine(selectedEngineId);
    updateEngineDetails(selectedEngineId);
    void switchEngine(selectedEngineId);
  });

  const runOcr = async () => {
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

      if (!engineReady || activeEngineId !== selectedEngineId) {
        await switchEngine(selectedEngineId, false);
        if (!engineReady || activeEngineId !== selectedEngineId) {
          return;
        }
      }

      setStage('processing', 'Processing image...', 100);
      const imageData = await imageProcessor.fileToImageData(selectedFile);
      const resized = imageProcessor.resize(imageData, 2000);
      const preprocessed = imageProcessor.preprocess(resized);
      const text = await ocrManager.run(preprocessed);

      output.textContent = text.trim().length > 0 ? text : 'No text detected in this image.';
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

  runButton.addEventListener('click', () => {
    void runOcr();
  });

  retryButton.addEventListener('click', () => {
    void runOcr();
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
    },
    setStage,
  };
};
