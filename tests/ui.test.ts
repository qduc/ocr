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
    fileToImageData: vi.fn(async () => new ImageData(1, 1)),
    resize: vi.fn((data: ImageData) => data),
    preprocess: vi.fn((data: ImageData) => data),
  }) as ImageProcessor;

const attachFile = (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
  });
  input.dispatchEvent(new Event('change'));
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
          registerEngines: (_factory, setStage) => {
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
        document.body.innerHTML = '<div id="app"></div>';
        const root = document.querySelector<HTMLElement>('#app');
        if (!root) throw new Error('Missing root');

        const imageProcessor = createImageProcessorStub();
        const ocrManager = {
          setEngine: vi.fn(async () => {}),
          run: vi.fn(async () => text),
        } as unknown as OCRManager;

        const app = initApp({
          root,
          featureDetector: createSupportedDetector(),
          imageProcessor,
          ocrManager,
          registerEngines: () => {},
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
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn(async () => {}),
      run: vi.fn(async () => 'Detected text'),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Detected text');
  });

  it('shows errors and retries when recoverable', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const imageProcessor = createImageProcessorStub();
    const error = new OCRError('processing failed', OCRErrorCode.PROCESSING_FAILED, true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ocrManager = {
      setEngine: vi.fn(async () => {}),
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
      registerEngines: () => {},
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
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    let resolveEngine: () => void = () => {};
    const imageProcessor = createImageProcessorStub();
    const ocrManager = {
      setEngine: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveEngine = resolve;
          })
      ),
      run: vi.fn(async () => 'Later text'),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor,
      ocrManager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);

    const runPromise = app.runOcr();
    await Promise.resolve();

    expect(app.elements.statusText.textContent).toContain('Loading OCR engine');
    resolveEngine();
    await runPromise;
  });
});
