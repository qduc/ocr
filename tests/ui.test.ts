/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';
import type { OCRManager } from '../src/ocr-manager';
import { OCRError, OCRErrorCode } from '../src/types/ocr-errors';

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
  }) as FeatureDetector;

const createImageProcessorStub = (): ImageProcessor =>
  ({
    fileToImageData: vi.fn((): Promise<ImageData> => Promise.resolve(new ImageData(1, 1))),
    resize: vi.fn((data: ImageData) => data),
    preprocess: vi.fn((data: ImageData) => data),
  }) as ImageProcessor;

const attachFile = (input: HTMLInputElement, file: File): void => {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
  });
  input.dispatchEvent(new Event('change'));
};

const registerTestEngine = (factory: { register: (id: string, creator: () => unknown) => void }): void => {
  factory.register('tesseract', () => ({
    id: 'tesseract',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<string> => Promise.resolve(''),
    destroy: (): Promise<void> => Promise.resolve(),
  }));
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
          run: vi.fn((): Promise<string> => Promise.resolve(text)),
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
      run: vi.fn((): Promise<string> => Promise.resolve('Detected text')),
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
        .mockResolvedValueOnce('Recovered text'),
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
      run: vi.fn((): Promise<string> => Promise.resolve('Later text')),
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
