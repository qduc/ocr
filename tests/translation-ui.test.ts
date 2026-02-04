/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';
import type { OCRManager } from '../src/ocr-manager';
import type { OCRResult, IOCREngine } from '../src/types/ocr-engine';
import { EngineFactory } from '../src/engines/engine-factory';
import type { ITextTranslator } from '../src/types/translation';

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
    process: (): Promise<OCRResult> => Promise.resolve({ text: '' }),
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

describe('Translation UI', () => {
  it('translates source text and updates result', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn((request: { text: string; from: string; to: string }) =>
      Promise.resolve({ text: `${request.text}|${request.from}|${request.to}` })
    );
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    const source = root.querySelector<HTMLTextAreaElement>('#translate-source')!;
    const runButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    const result = root.querySelector<HTMLTextAreaElement>('#translate-result')!;

    source.value = 'Hello world';
    runButton.click();

    await flushPromises();

    expect(translateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world', from: 'en', to: 'en' })
    );
    expect(result.value).toBe('Hello world|en|en');

    void app;
  });

  it('copies OCR output into translation source', async () => {
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
      createTranslator: () => Promise.resolve({ translate: vi.fn(), destroy: vi.fn() }),
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const source = root.querySelector<HTMLTextAreaElement>('#translate-source')!;
    const useOcr = root.querySelector<HTMLButtonElement>('#translate-use-ocr')!;
    useOcr.click();

    expect(source.value).toBe('Detected text');
  });

  it('shows error when translation fails', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn(() => Promise.reject(new Error('Translation failed')));
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };

    initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    const source = root.querySelector<HTMLTextAreaElement>('#translate-source')!;
    const runButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    const error = root.querySelector<HTMLDivElement>('#translate-error')!;

    source.value = 'Hola';
    runButton.click();

    await flushPromises();

    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('Translation failed');
  });
});
