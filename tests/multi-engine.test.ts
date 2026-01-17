/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initApp } from '../src/app';
import { EngineFactory } from '../src/engines/engine-factory';
import { OCRManager } from '../src/ocr-manager';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { ImageProcessor } from '../src/utils/image-processor';

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
  URL.createObjectURL = vi.fn(() => 'mock-url');
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
      webgpu: true,
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

describe('Multi-engine integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches between engines and cleans up resources', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const factory = new EngineFactory();
    const tesseractDestroyed = vi.fn();
    const transformersDestroyed = vi.fn();

    let tesseractInstance: { destroy: () => Promise<void> } | null = null;
    let transformersInstance: { destroy: () => Promise<void> } | null = null;

    factory.register('tesseract', () => {
      tesseractInstance = {
        destroy: (): Promise<void> => Promise.resolve(void tesseractDestroyed()),
      };
      return {
        id: 'tesseract',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Tesseract output' }),
        destroy: (): Promise<void> => Promise.resolve(void tesseractInstance?.destroy()),
      };
    });

    factory.register('transformers', () => {
      transformersInstance = {
        destroy: (): Promise<void> => Promise.resolve(void transformersDestroyed()),
      };
      return {
        id: 'transformers',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Transformers output' }),
        destroy: (): Promise<void> => Promise.resolve(void transformersInstance?.destroy()),
      };
    });

    const manager = new OCRManager(factory);
    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      engineFactory: factory,
      ocrManager: manager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Tesseract output');

    app.elements.engineSelect.value = 'transformers';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Transformers output');
    expect(tesseractDestroyed).toHaveBeenCalled();
    expect(transformersDestroyed).not.toHaveBeenCalled();
  });
});

describe('Multi-engine eSearch integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches from tesseract to esearch and cleans up', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const factory = new EngineFactory();
    const tesseractDestroyed = vi.fn();
    const esearchDestroyed = vi.fn();

    let tesseractInstance: { destroy: () => Promise<void> } | null = null;
    let esearchInstance: { destroy: () => Promise<void> } | null = null;

    factory.register('tesseract', () => {
      tesseractInstance = {
        destroy: (): Promise<void> => Promise.resolve(void tesseractDestroyed()),
      };
      return {
        id: 'tesseract',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Tesseract output' }),
        destroy: (): Promise<void> => Promise.resolve(void tesseractInstance?.destroy()),
      };
    });

    factory.register('esearch', () => {
      esearchInstance = {
        destroy: (): Promise<void> => Promise.resolve(void esearchDestroyed()),
      };
      return {
        id: 'esearch',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'eSearch output' }),
        destroy: (): Promise<void> => Promise.resolve(void esearchInstance?.destroy()),
      };
    });

    const manager = new OCRManager(factory);
    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      engineFactory: factory,
      ocrManager: manager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);
    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Tesseract output');

    app.elements.engineSelect.value = 'esearch';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.runOcr();

    expect(app.elements.output.textContent).toBe('eSearch output');
    expect(tesseractDestroyed).toHaveBeenCalled();
    expect(esearchDestroyed).not.toHaveBeenCalled();
  });

  it('switches from esearch to transformers and cleans up', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const factory = new EngineFactory();
    const esearchDestroyed = vi.fn();
    const transformersDestroyed = vi.fn();

    let esearchInstance: { destroy: () => Promise<void> } | null = null;
    let transformersInstance: { destroy: () => Promise<void> } | null = null;

    factory.register('esearch', () => {
      esearchInstance = {
        destroy: (): Promise<void> => Promise.resolve(void esearchDestroyed()),
      };
      return {
        id: 'esearch',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'eSearch output' }),
        destroy: (): Promise<void> => Promise.resolve(void esearchInstance?.destroy()),
      };
    });

    factory.register('transformers', () => {
      transformersInstance = {
        destroy: (): Promise<void> => Promise.resolve(void transformersDestroyed()),
      };
      return {
        id: 'transformers',
        isLoading: false,
        load: (): Promise<void> => Promise.resolve(),
        process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Transformers output' }),
        destroy: (): Promise<void> => Promise.resolve(void transformersInstance?.destroy()),
      };
    });

    const manager = new OCRManager(factory);
    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      engineFactory: factory,
      ocrManager: manager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);

    // Start with esearch
    app.elements.engineSelect.value = 'esearch';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.runOcr();
    expect(app.elements.output.textContent).toBe('eSearch output');

    // Switch to transformers
    app.elements.engineSelect.value = 'transformers';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.runOcr();

    expect(app.elements.output.textContent).toBe('Transformers output');
    expect(esearchDestroyed).toHaveBeenCalled();
    expect(transformersDestroyed).not.toHaveBeenCalled();
  });

  it('cycles through all three engines with proper cleanup', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const factory = new EngineFactory();
    const tesseractDestroyed = vi.fn();
    const transformersDestroyed = vi.fn();
    const esearchDestroyed = vi.fn();

    factory.register('tesseract', () => ({
      id: 'tesseract',
      isLoading: false,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Tesseract output' }),
      destroy: (): Promise<void> => Promise.resolve(void tesseractDestroyed()),
    }));

    factory.register('transformers', () => ({
      id: 'transformers',
      isLoading: false,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<{ text: string }> => Promise.resolve({ text: 'Transformers output' }),
      destroy: (): Promise<void> => Promise.resolve(void transformersDestroyed()),
    }));

    factory.register('esearch', () => ({
      id: 'esearch',
      isLoading: false,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<{ text: string }> => Promise.resolve({ text: 'eSearch output' }),
      destroy: (): Promise<void> => Promise.resolve(void esearchDestroyed()),
    }));

    const manager = new OCRManager(factory);
    const app = initApp({
      root,
      featureDetector: createSupportedDetector(),
      imageProcessor: createImageProcessorStub(),
      engineFactory: factory,
      ocrManager: manager,
      registerEngines: () => {},
    });

    const file = new File([new Uint8Array([1])], 'sample.png', { type: 'image/png' });
    attachFile(app.elements.fileInput, file);

    // Start with tesseract (default)
    await app.runOcr();
    expect(app.elements.output.textContent).toBe('Tesseract output');

    // Switch to esearch
    app.elements.engineSelect.value = 'esearch';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.runOcr();
    expect(app.elements.output.textContent).toBe('eSearch output');
    expect(tesseractDestroyed).toHaveBeenCalledTimes(1);

    // Switch to transformers
    app.elements.engineSelect.value = 'transformers';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.runOcr();
    expect(app.elements.output.textContent).toBe('Transformers output');
    expect(esearchDestroyed).toHaveBeenCalledTimes(1);

    // Switch back to tesseract
    app.elements.engineSelect.value = 'tesseract';
    app.elements.engineSelect.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.runOcr();
    expect(app.elements.output.textContent).toBe('Tesseract output');
    expect(transformersDestroyed).toHaveBeenCalledTimes(1);
  });
});
