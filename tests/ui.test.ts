/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';
import type { OCRManager } from '../src/ocr-manager';
import { OCRError, OCRErrorCode } from '../src/types/ocr-errors';
import type { OCRResult, IOCREngine } from '../src/types/ocr-engine';
import { EngineFactory } from '../src/engines/engine-factory';

if (typeof ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = width ?? 0;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = width ?? 0;
        this.height = height ?? 0;
      }
    }
  }

  // @ts-expect-error - test environment polyfill
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:test');
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = vi.fn();
}

const createSupportedDetector = (): FeatureDetector =>
  ({
    detect: () => ({
      wasm: true,
      webWorkers: true,
      indexedDB: true,
      supported: true,
      missing: [],
    }),
  }) as unknown as FeatureDetector;

const createImageProcessorStub = (): ImageProcessor =>
  ({
    fileToImageData: vi.fn((): Promise<ImageData> => Promise.resolve(new ImageData(100, 100))),
    resize: vi.fn((data: ImageData) => data),
    preprocess: vi.fn((data: ImageData) => data),
  }) as unknown as ImageProcessor;

const attachFile = (input: HTMLInputElement, file: File): void => {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
};

const clearFileInput = (input: HTMLInputElement): void => {
  Object.defineProperty(input, 'files', {
    value: [],
    writable: false,
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
};

const registerTestEngine = (factory: EngineFactory): void => {
  factory.register('tesseract', () => ({
    id: 'tesseract',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<OCRResult> => Promise.resolve({ text: '' }),
    destroy: (): Promise<void> => Promise.resolve(),
  } as IOCREngine));
};

describe('UI property tests', () => {
  it('propagates loading state updates to the UI', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (progress) => {
        document.body.innerHTML = '<div id="app"></div>';
        const root = document.querySelector<HTMLElement>('#app');
        if (!root) throw new Error('Missing root');

        const app = initApp({
          root,
          featureDetector: createSupportedDetector(),
          imageProcessor: createImageProcessorStub(),
          ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
          registerEngines: (factory, setStage) => {
            registerTestEngine(factory);
            setStage('loading', 'Loading OCR engine', progress);
          },
        });

        app.setStage('loading', 'Loading OCR engine', progress);
        const progressText = app.elements.progressText.textContent ?? '';
        expect(progressText).toBe(`${Math.round(progress)}%`);
      }),
      { numRuns: 20 }
    );
  });

  it('displays OCR results after processing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        await Promise.resolve();
        document.body.innerHTML = '<div id="app"></div>';
        const root = document.querySelector<HTMLElement>('#app');
        if (!root) throw new Error('Missing root');

        const imageProcessor = createImageProcessorStub();
        const ocrManager = {
          setEngine: vi.fn((): Promise<void> => Promise.resolve()),
          run: vi.fn((): Promise<OCRResult> => Promise.resolve({ text })),
        } as unknown as OCRManager;

        const app = initApp({
          root,
          featureDetector: createSupportedDetector(),
          imageProcessor,
          ocrManager,
          registerEngines: (factory) => registerTestEngine(factory),
        });

        const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
        attachFile(app.elements.fileInput, file);
        await app.runOcr();

        expect(app.elements.output.textContent).toBe(text.trim().length > 0 ? text : 'No text detected in this image.');
      }),
      { numRuns: 15 }
    );
  });

  it('hides image preview when no file is selected', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    // Initial state: hidden
    expect(app.elements.imagePreviewContainer.classList.contains('hidden')).toBe(true);

    // Select a file: should be visible
    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    expect(app.elements.imagePreviewContainer.classList.contains('hidden')).toBe(false);

    // Clear selection: should be hidden again
    clearFileInput(app.elements.fileInput);
    expect(app.elements.imagePreviewContainer.classList.contains('hidden')).toBe(true);
  });
});

describe('UI integration tests', () => {
  it('runs the upload-to-output flow', async () => {
    await Promise.resolve();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve({ text: 'Detected text' })),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Detected text');
  });

  it('shows errors and retries when recoverable', async () => {
    await Promise.resolve();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const imageProcessor = createImageProcessorStub();
    const error = new OCRError('processing failed', OCRErrorCode.PROCESSING_FAILED, true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ text: 'Recovered text' }),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    expect(app.elements.errorPanel.classList.contains('hidden')).toBe(false);
    await app.runOcr();
    expect(app.elements.output.textContent).toBe('Recovered text');
    errorSpy.mockRestore();
  });

  it('shows loading state while the engine initializes', async () => {
    await Promise.resolve();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    let resolveEngine: () => void = (): void => {};
    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn(
        (): Promise<void> =>
          new Promise<void>((resolve) => {
            resolveEngine = resolve;
          })
      ),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve({ text: 'Later text' })),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);

    const runPromise = app.runOcr();
    await Promise.resolve();

    expect(app.elements.statusText.textContent).toContain('Switching to');
    resolveEngine();
    await runPromise;
  });
});

describe('OCR Overlay tests', () => {
  it('adds at-top class to boxes near the top edge', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const result: OCRResult = {
      text: 'hello world',
      items: [
        {
          text: 'Top item',
          confidence: 0.9,
          boundingBox: { x: 10, y: 5, width: 50, height: 20 },
        },
        {
          text: 'Bottom item',
          confidence: 0.8,
          boundingBox: { x: 10, y: 60, width: 50, height: 20 },
        },
      ],
    };

    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve(result)),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    const imagePreview = root.querySelector<HTMLImageElement>('#image-preview')!;
    Object.defineProperty(imagePreview, 'clientWidth', { value: 100 });
    Object.defineProperty(imagePreview, 'clientHeight', { value: 100 });
    Object.defineProperty(imagePreview, 'complete', { value: true });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const ocrOverlay = root.querySelector<HTMLDivElement>('#ocr-overlay')!;
    const boxes = ocrOverlay.querySelectorAll('.ocr-box');
    expect(boxes.length).toBe(2);
    expect(boxes[0]!.classList.contains('at-top')).toBe(true);
    expect(boxes[1]!.classList.contains('at-top')).toBe(false);
  });

  it('redraws boxes on window resize', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const result: OCRResult = {
      text: 'test',
      items: [{ text: 'item', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 20, height: 10 } }],
    };

    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve(result)),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
    });

    const imagePreview = root.querySelector<HTMLImageElement>('#image-preview')!;
    let clientWidth = 100;
    Object.defineProperty(imagePreview, 'clientWidth', { get: () => clientWidth });
    Object.defineProperty(imagePreview, 'clientHeight', { value: 100 });
    Object.defineProperty(imagePreview, 'complete', { value: true });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const ocrOverlay = root.querySelector<HTMLDivElement>('#ocr-overlay')!;
    let box = ocrOverlay.querySelector('.ocr-box') as HTMLDivElement;
    expect(box.style.left).toBe('10px');

    clientWidth = 200;
    window.dispatchEvent(new Event('resize'));

    box = ocrOverlay.querySelector('.ocr-box') as HTMLDivElement;
    expect(box.style.left).toBe('20px');
  });
});
