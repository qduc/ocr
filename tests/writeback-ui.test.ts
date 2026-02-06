/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';
import type { OCRManager } from '../src/ocr-manager';
import type { OCRResult, IOCREngine } from '../src/types/ocr-engine';
import { EngineFactory } from '../src/engines/engine-factory';
import type { ITextTranslator } from '../src/types/translation';

// (No global ImageData polyfill needed; tests construct a shaped object when required.)

// Force-override toBlob for jsdom
Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
  value: function(callback: (blob: Blob | null) => void) {
    callback(new Blob(['test'], { type: 'image/png' }));
  },
  configurable: true,
});

// Force-override getContext for jsdom
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: function(id: string) {
    if (id === '2d') {
      const self = this as unknown as HTMLCanvasElement;
      return ({
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
        canvas: self,
      } as unknown) as CanvasRenderingContext2D;
    }
    return null;
  },
  configurable: true,
});

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:test');
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
    sourceToImageData: vi.fn((): Promise<ImageData> => Promise.resolve({ data: new Uint8ClampedArray(100 * 100 * 4), width: 100, height: 100 } as ImageData)),
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

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Write-back UI', () => {
  it('performs write-back and shows translated image', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translator: ITextTranslator = {
      translate: vi.fn((req) => Promise.resolve({ text: 'translated:' + req.text })),
      destroy: vi.fn(),
    };

    const mockOcrResult: OCRResult = {
      text: 'hello world',
      items: [
        { text: 'hello', confidence: 1, boundingBox: { x: 10, y: 10, width: 40, height: 20 } },
        { text: 'world', confidence: 1, boundingBox: { x: 60, y: 10, width: 40, height: 20 } },
      ],
    };

    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve(mockOcrResult)),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    // 1. Run OCR
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    Object.defineProperty(app.elements.fileInput, 'files', { value: [file] });
    app.elements.fileInput.dispatchEvent(new Event('change'));
    await app.runOcr();
    await flushPromises();

    // 2. Click Write-back
    const writebackButton = root.querySelector<HTMLButtonElement>('#translate-writeback')!;
    writebackButton.click();

    await flushPromises(); // Grouping + translating
    await flushPromises(); // Rendering + exporting

    // 3. Assertions
    const translatedContainer = root.querySelector<HTMLDivElement>('#translated-image-container')!;
    const translatedPreview = root.querySelector<HTMLImageElement>('#translated-image-preview')!;

    expect(translatedContainer.classList.contains('hidden')).toBe(false);
    expect(translatedPreview.src).toBe('blob:test');
  });

  it('translates once per paragraph when paragraph spans multiple source lines', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const translateSpy = vi.fn((req: { text: string }) => Promise.resolve({ text: 'translated:' + req.text }));
    const translator: ITextTranslator = {
      translate: translateSpy,
      destroy: vi.fn(),
    };

    const mockOcrResult: OCRResult = {
      text: 'line1 line2',
      items: [
        { text: 'Line', confidence: 1, boundingBox: { x: 10, y: 10, width: 30, height: 20 } },
        { text: 'one', confidence: 1, boundingBox: { x: 45, y: 10, width: 30, height: 20 } },
        { text: 'Line', confidence: 1, boundingBox: { x: 10, y: 34, width: 30, height: 20 } },
        { text: 'two', confidence: 1, boundingBox: { x: 45, y: 34, width: 30, height: 20 } },
      ],
    };

    const ocrManager = {
      setEngine: vi.fn((): Promise<void> => Promise.resolve()),
      run: vi.fn((): Promise<OCRResult> => Promise.resolve(mockOcrResult)),
    } as unknown as OCRManager;

    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      ocrManager,
      registerEngines: (factory) => registerTestEngine(factory),
      createTranslator: () => Promise.resolve(translator),
    });

    const file = new File(['test'], 'test.png', { type: 'image/png' });
    Object.defineProperty(app.elements.fileInput, 'files', { value: [file] });
    app.elements.fileInput.dispatchEvent(new Event('change'));
    await app.runOcr();
    await flushPromises();

    const writebackButton = root.querySelector<HTMLButtonElement>('#translate-writeback')!;
    writebackButton.click();
    await flushPromises();
    await flushPromises();

    expect(translateSpy).toHaveBeenCalledTimes(1);
    expect(translateSpy).toHaveBeenCalledWith(expect.objectContaining({ text: 'Line one Line two' }));
  });
});
