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
import { buildParagraphTextForTranslation } from '@/utils/paragraph-grouping';
import type { ITextTranslator } from '@/types/translation';
import { getAppTemplate } from '@/app-template';
import { getAppElements } from '@/app-elements';
import { drawOcrBoxes } from '@/overlay-renderer';
import { createTranslationController } from '@/translation-controller';
import { createEngineUiController } from '@/engine-ui';
import { createImageSourceController } from '@/image-sources';

type Stage = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

export interface AppOptions {
  root?: HTMLElement | null;
  featureDetector?: FeatureDetector;
  imageProcessor?: ImageProcessor;
  engineFactory?: EngineFactory;
  ocrManager?: OCRManager;
  createTranslator?: () => Promise<ITextTranslator>;
  registerEngines?: (
    factory: EngineFactory,
    setStage: (stage: Stage, message: string, progress?: number) => void
  ) => void;
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
    urlInput: HTMLInputElement;
    loadUrlButton: HTMLButtonElement;
    translateResult: HTMLTextAreaElement;
    translateFrom: HTMLSelectElement;
    translateTo: HTMLSelectElement;

    translateRunButton: HTMLButtonElement;
    translateWritebackButton: HTMLButtonElement;
    translateCopyButton: HTMLButtonElement;
    translateStatus: HTMLDivElement;
    translateError: HTMLDivElement;
    translatedImageContainer: HTMLDivElement;
    translatedImagePreview: HTMLImageElement;
    downloadTranslatedButton: HTMLButtonElement;
  };
  setStage: (stage: Stage, message: string, progress?: number) => void;
}

export const initApp = (options: AppOptions = {}): AppInstance => {
  const root = options.root ?? document.querySelector<HTMLElement>('#app');
  if (!root) {
    throw new Error('App root not found.');
  }

  root.innerHTML = getAppTemplate();
  const {
    statusCard,
    statusText,
    progressBar,
    progressText,
    loadMetric,
    processMetric,
    fileInput,
    fileMeta,
    engineSelect,
    engineDetails,
    languageSelect,
    languageSelectContainer,
    languageHint,
    runButton,
    output,
    errorPanel,
    errorMessage,
    errorSuggestion,
    retryButton,
    imagePreviewContainer,
    imagePreview,
    ocrOverlay,
    imageModal,
    modalImage,
    closeModal,
    ocrOverlayModal,
    urlInput,
    loadUrlButton,
    dropOverlay,
    copyOutputButton,
    translateResult,
    translateFrom,
    translateTo,

    translateRunButton,
    translateWritebackButton,
    translateCopyButton,
    translateSwapButton,
    translateStatus,
    translateError,
    translatedImageContainer,
    translatedImagePreview,
    downloadTranslatedButton,
    methodTabs,
    methodPanels,
  } = getAppElements(root);

  const detector = options.featureDetector ?? new FeatureDetector();
  const capabilities = detector.detect();
  const webgpuAvailable = capabilities.webgpu && globalThis.crossOriginIsolated === true;

  const imageProcessor = options.imageProcessor ?? new ImageProcessor();
  const engineFactory = options.engineFactory ?? new EngineFactory();
  const ocrManager = options.ocrManager ?? new OCRManager(engineFactory);
  let selectedSource: Blob | string | null = null;
  let engineReady = false;
  let selectedEngineId: string | null = null;
  const selectedLanguages: Record<string, string> = {
    tesseract: 'eng',
    esearch: 'english',
    easyocr: 'en',
  };
  let activeEngineId: string | null = null;
  let activeLanguage: string | null = null;
  let lastResult: OCRResult | null = null;
  let lastProcessedWidth: number = 0;
  let lastProcessedHeight: number = 0;

  createImageSourceController(
    {
      fileInput,
      fileMeta,
      imagePreviewContainer,
      imagePreview,
      urlInput,
      loadUrlButton,
      dropOverlay,
      methodTabs,
      methodPanels,
      output,
    },
    {
      setError: (error) => setError(createInvalidImageError(formatErrorMessage(error).message)),
      onLoadImage: (source) => {
        selectedSource = source;
      },
      onClearImage: () => {
        selectedSource = null;
      },
      onPreviewLoaded: () => undefined,
      onResetForNewSource: () => {
        translationController.resetForNewSource();
        ocrOverlay.innerHTML = '';
        lastResult = null;
        copyOutputButton.classList.add('hidden');
      },
    }
  );

  const engineUi = createEngineUiController(
    {
      engineSelect,
      engineDetails,
      languageSelect,
      languageSelectContainer,
      languageHint,
    },
    {
      webgpuAvailable,
      selectedLanguages,
      availableEngines: () => engineFactory.getAvailableEngines(),
    }
  );

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

  const translationController = createTranslationController(
    {
      translateResult,
      translateFrom,
      translateTo,

      translateRunButton,
      translateWritebackButton,
      translateCopyButton,
      translateSwapButton,
      translateStatus,
      translateError,
      translatedImageContainer,
      translatedImagePreview,
      downloadTranslatedButton,
    },
    {
      imageProcessor,
      createTranslator: options.createTranslator,
      getOcrText: () => getOcrTextForTranslation(),
      getWritebackContext: () => ({
        items: lastResult?.items ?? null,
        selectedSource,
        lastProcessedWidth,
        lastProcessedHeight,
      }),
    }
  );

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
        webgpu: webgpuAvailable,
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
        webgpu: false, // Force WASM to avoid MaxPool ceil() error in WebGPU
        onProgress: (status: string, progress: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading eSearch-OCR: ${status}`, percent);
        },
      });
    });
    engineFactory.register('easyocr', async (options) => {
      const { EasyOCREngine } = await import('@/engines/easyocr-engine');
      return new EasyOCREngine({
        language: options?.language,
        webgpu: webgpuAvailable,
        debug: true,
        debugMode: 'compare',
        onProgress: (status: string, progress: number): void => {
          const percent = Math.round((progress ?? 0) * 100);
          setStage('loading', `Loading EasyOCR: ${status}`, percent);
        },
      });
    });
  };

  const updateEngineDetails = (engineId: string): void => {
    engineUi.updateEngineDetails(engineId);
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
    engineUi.updateLanguageSelection(engineId);
  };

  const updateTranslateFromDefault = (): void => {
    const engineId = activeEngineId ?? selectedEngineId;
    const ocrLanguage =
      engineId && engineUi.supportsLanguageSelection(engineId)
        ? engineUi.getSelectedLanguage(engineId)
        : 'eng';
    translationController.updateTranslateFromDefault(engineId, ocrLanguage);
  };





  const populateEngines = (): void => {
    engineUi.populateEngines(getStoredEngine);
    selectedEngineId = engineSelect.value || null;
    if (selectedEngineId) {
      updateEngineDetails(selectedEngineId);
      updateLanguageSelection(selectedEngineId);
    }
  };

  const initTranslationControls = (): void => {
    translationController.init(() => {
      const engineId = activeEngineId ?? selectedEngineId;
      const ocrLanguage =
        engineId && engineUi.supportsLanguageSelection(engineId)
          ? engineUi.getSelectedLanguage(engineId)
          : 'eng';
      return { engineId: engineId ?? null, ocrLanguage };
    });
  };

  const switchEngine = async (engineId: string, manageBusy: boolean = true): Promise<void> => {
    const engineName = ENGINE_CONFIGS[engineId]?.name ?? engineId;
    const language = engineUi.getSelectedLanguage(engineId);
    const langSuffix = engineUi.supportsLanguageSelection(engineId)
      ? ` (${engineUi.getLanguageLabel(engineId, language)})`
      : '';
    setStage('loading', `Switching to ${engineName}${langSuffix}...`, 0);
    if (manageBusy) {
      setBusy(true);
    }
    try {
      const loadStart = performance.now();
      if (engineUi.supportsLanguageSelection(engineId)) {
        await ocrManager.setEngine(engineId, { language });
      } else {
        await ocrManager.setEngine(engineId);
      }
      setLoadMetric(performance.now() - loadStart);
      engineReady = true;
      activeEngineId = engineId;
      activeLanguage = engineUi.supportsLanguageSelection(engineId) ? language : null;
      updateTranslateFromDefault();
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
    initTranslationControls();
    setStage('idle', 'Ready for upload', 0);
  }


  engineSelect.addEventListener('change', (): void => {
    selectedEngineId = engineSelect.value;
    engineReady = false;
    activeEngineId = null;
    setStoredEngine(selectedEngineId);
    updateEngineDetails(selectedEngineId);
    updateLanguageSelection(selectedEngineId);
    updateTranslateFromDefault();
    void switchEngine(selectedEngineId);
  });

  languageSelect.addEventListener('change', (): void => {
    if (!selectedEngineId || !engineUi.supportsLanguageSelection(selectedEngineId)) {
      return;
    }

    selectedLanguages[selectedEngineId] = languageSelect.value;
    engineReady = false;
    activeLanguage = null;
    engineUi.updateLanguageHint(selectedEngineId);
    updateTranslateFromDefault();
    void switchEngine(selectedEngineId);
  });

  const runOcr = async (): Promise<void> => {
    clearError();
    if (!selectedSource) {
      setError(
        createInvalidImageError(
          'Select an image file, enter a URL, or paste an image before running OCR.'
        )
      );
      return;
    }

    setBusy(true);
    try {
      if (!selectedEngineId) {
        setError(createProcessingFailedError('No OCR engine selected.'));
        return;
      }

      const languageMismatch =
        engineUi.supportsLanguageSelection(selectedEngineId) &&
        activeLanguage !== engineUi.getSelectedLanguage(selectedEngineId);
      if (!engineReady || activeEngineId !== selectedEngineId || languageMismatch) {
        await switchEngine(selectedEngineId, false);
        if (!engineReady || activeEngineId !== selectedEngineId) {
          return;
        }
      }

      setStage('processing', 'Processing image...', 100);
      translatedImageContainer.classList.add('hidden');
      const imageData = await imageProcessor.sourceToImageData(selectedSource);
      const resized = imageProcessor.resize(imageData, 2000);
      const processed =
        selectedEngineId === 'transformers' ? resized : imageProcessor.preprocess(resized);
      const processStart = performance.now();
      const result = await ocrManager.run(processed);
      setProcessMetric(performance.now() - processStart);
      lastResult = result;
      lastProcessedWidth = processed.width;
      lastProcessedHeight = processed.height;

      output.textContent =
        result.text.trim().length > 0 ? result.text : 'No text detected in this image.';
      copyOutputButton.classList.toggle('hidden', result.text.trim().length === 0);
      translationController.onOcrUpdated();
      if (result.items && result.items.length > 0) {
        drawOcrBoxes(result.items, processed.width, processed.height, {
          mainOverlay: ocrOverlay,
          mainImage: imagePreview,
          modalOverlay: ocrOverlayModal,
          modalImage,
          isModalOpen: () => !imageModal.classList.contains('hidden'),
        });
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
        setError(createInvalidImageError('Image decoding failed. Try a different source.'));
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
        drawOcrBoxes(lastResult.items, lastProcessedWidth, lastProcessedHeight, {
          mainOverlay: ocrOverlay,
          mainImage: imagePreview,
          modalOverlay: ocrOverlayModal,
          modalImage,
          isModalOpen: () => !imageModal.classList.contains('hidden'),
        });
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
    if (
      text &&
      text !== 'Upload an image to begin.' &&
      text !== 'No text detected in this image.'
    ) {
      void navigator.clipboard.writeText(text).then(() => {
        const originalHtml = copyOutputButton.innerHTML;
        copyOutputButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-strong)"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyOutputButton.innerHTML = originalHtml;
        }, 2000);
      });
    }
  });

  const getOcrTextForTranslation = (): string => {
    let text = '';

    if (lastResult?.items && lastResult.items.length > 0) {
      text = buildParagraphTextForTranslation(lastResult.items);
    } else {
      text = lastResult?.text ?? output.textContent ?? '';
    }

    if (
      !text ||
      text === 'Upload an image to begin.' ||
      text === 'No text detected in this image.' ||
      text === 'Image loaded. Click extract to run OCR.'
    ) {
      return '';
    }
    return text;
  };

  // Allow clicking the translated preview to open the same image modal (enlarge)
  translatedImagePreview.addEventListener('click', (): void => {
    if (translatedImagePreview.src && !translatedImageContainer.classList.contains('hidden')) {
      // Show translated image in modal. Do not draw OCR boxes here to avoid
      // coordinate mismatches between processed and written-back image sizes.
      modalImage.src = translatedImagePreview.src;
      ocrOverlayModal.innerHTML = '';
      imageModal.classList.remove('hidden');
      document.body.style.overflow = 'hidden'; // Prevent scrolling
    }
  });


  const drawBoxes = (
    items: OCRResult['items'],
    originalWidth: number,
    originalHeight: number
  ): void => {
    drawOcrBoxes(items, originalWidth, originalHeight, {
      mainOverlay: ocrOverlay,
      mainImage: imagePreview,
      modalOverlay: ocrOverlayModal,
      modalImage,
      isModalOpen: () => !imageModal.classList.contains('hidden'),
    });
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
      urlInput,
      loadUrlButton,
      translateResult,
      translateFrom,
      translateTo,

      translateRunButton,
      translateWritebackButton,
      translateCopyButton,
      translateStatus,
      translateError,
      translatedImageContainer,
      translatedImagePreview,
      downloadTranslatedButton,
    },
    setStage,
  };
};
