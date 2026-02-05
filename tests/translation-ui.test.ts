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
  it('translates OCR output and updates result', async () => {
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

    const runButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    const result = root.querySelector<HTMLTextAreaElement>('#translate-result')!;

    app.elements.output.textContent = 'Hello world';
    runButton.click();

    await flushPromises();

    expect(translateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world', from: 'en', to: 'en' })
    );
    expect(result.value).toBe('Hello world|en|en');

    void app;
  });

  it('groups items into paragraphs for translation when bounding boxes are present', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn((request: { text: string }) =>
      Promise.resolve({ text: `translated:${request.text}` })
    );
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };

    const mockOcrResult: OCRResult = {
      text: 'line1line2', // raw text from engine (might be messy)
      items: [
        { text: 'Line 1', confidence: 1, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
        { text: 'Line 2', confidence: 1, boundingBox: { x: 10, y: 35, width: 100, height: 20 } },
        { text: 'Para 2', confidence: 1, boundingBox: { x: 10, y: 100, width: 100, height: 20 } },
      ],
    };

    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve(mockOcrResult)),
    } as unknown as OCRManager;

    initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    // We need to trigger OCR first to set lastResult
    const fileInput = root.querySelector<HTMLInputElement>('#file-input')!;
    attachFile(fileInput, new File(['test'], 'test.png', { type: 'image/png' }));
    const runOcrButton = root.querySelector<HTMLButtonElement>('#run-button')!;
    runOcrButton.click();
    await flushPromises();

    // Now click translate
    const translateRunButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    translateRunButton.click();
    await flushPromises();

    // The items should be grouped: "Line 1 Line 2\n\nPara 2"
    // (Line 1 & 2 are grouped into one line/paragraph because gap is 5 < 20*1.5=30)
    const expectedText = 'Line 1 Line 2\n\nPara 2';

    expect(translateSpy).toHaveBeenCalledWith(expect.objectContaining({ text: expectedText }));
    const result = root.querySelector<HTMLTextAreaElement>('#translate-result')!;
    expect(result.value).toBe(`translated:${expectedText}`);
  });

  it('translates OCR output after OCR completes', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const imageProcessor = createImageProcessorStub();
    const translateSpy = vi.fn((request: { text: string; from: string; to: string }) =>
      Promise.resolve({ text: `${request.text}|${request.from}|${request.to}` })
    );
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
      createTranslator: () =>
        Promise.resolve({ translate: translateSpy, destroy: vi.fn() } as ITextTranslator),
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    const runButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    const result = root.querySelector<HTMLTextAreaElement>('#translate-result')!;
    runButton.click();

    await flushPromises();

    expect(translateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Detected text', from: 'en', to: 'en' })
    );
    expect(result.value).toBe('Detected text|en|en');
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

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    const runButton = root.querySelector<HTMLButtonElement>('#translate-run')!;
    const error = root.querySelector<HTMLDivElement>('#translate-error')!;

    app.elements.output.textContent = 'Hola';
    runButton.click();

    await flushPromises();

    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('Translation failed');
  });
});
