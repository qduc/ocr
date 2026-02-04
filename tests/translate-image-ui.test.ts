/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';
import type { OCRManager } from '../src/ocr-manager';
import type { OCRResult, IOCREngine } from '../src/types/ocr-engine';
import { EngineFactory } from '../src/engines/engine-factory';
import type { ITextTranslator } from '../src/types/translation';
import type { TranslateImageInput, TranslateImageOutput } from '../src/translate-image/types';

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
      webgpu: false,
      supported: true,
      missing: [],
    }),
  }) as unknown as FeatureDetector;

const createImageProcessorStub = (): ImageProcessor =>
  ({
    sourceToImageData: vi.fn((): Promise<ImageData> => Promise.resolve(new ImageData(100, 100))),
    resize: vi.fn((data: ImageData) => data),
    preprocess: vi.fn((data: ImageData) => data),
  }) as unknown as ImageProcessor;

const registerTestEngine = (factory: EngineFactory): void => {
  factory.register('tesseract', () => ({
    id: 'tesseract',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<OCRResult> =>
      Promise.resolve({
        text: 'Detected',
        items: [
          {
            text: 'Detected',
            confidence: 0.9,
            boundingBox: { x: 10, y: 10, width: 40, height: 10 },
          },
        ],
      }),
    destroy: (): Promise<void> => Promise.resolve(),
  } as IOCREngine));
};

const attachFile = (input: HTMLInputElement, file: File): void => {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Translate image UI', () => {
  it('enables download after translation', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn(() => Promise.resolve({ text: 'Translated' }));
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };
    const translateImageImpl = vi.fn(
      (_input: TranslateImageInput): Promise<TranslateImageOutput> =>
        Promise.resolve({
          blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        })
    );

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: {
        setEngine: vi.fn(),
        run: vi.fn((): Promise<OCRResult> =>
          Promise.resolve({
            text: 'Detected',
            items: [
              {
                text: 'Detected',
                confidence: 0.9,
                boundingBox: { x: 10, y: 10, width: 40, height: 10 },
              },
            ],
          })
        ),
      } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
      translateImageImpl,
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const runButton = root.querySelector<HTMLButtonElement>('#translate-image-run')!;
    runButton.click();
    await flushPromises();

    const downloadButton = root.querySelector<HTMLButtonElement>('#translate-image-download')!;
    expect(downloadButton.disabled).toBe(false);
    const translatedCard = root.querySelector<HTMLDivElement>('#translated-preview-card')!;
    const translatedPreview = root.querySelector<HTMLImageElement>('#translated-preview')!;
    expect(translatedCard.classList.contains('hidden')).toBe(false);
    expect(translatedPreview.src).toContain('blob:');
  });

  it('shows errors when image translation fails', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn(() => Promise.resolve({ text: 'Translated' }));
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };
    const translateImageImpl = vi.fn(
      (): Promise<TranslateImageOutput> => Promise.reject(new Error('Translate image failed'))
    );

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: {
        setEngine: vi.fn(),
        run: vi.fn((): Promise<OCRResult> =>
          Promise.resolve({
            text: 'Detected',
            items: [
              {
                text: 'Detected',
                confidence: 0.9,
                boundingBox: { x: 10, y: 10, width: 40, height: 10 },
              },
            ],
          })
        ),
      } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
      translateImageImpl,
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const runButton = root.querySelector<HTMLButtonElement>('#translate-image-run')!;
    runButton.click();
    await flushPromises();

    const error = root.querySelector<HTMLDivElement>('#translate-image-error')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('Translate image failed');
  });
});
