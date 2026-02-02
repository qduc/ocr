/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { initApp } from '../src/app';
import type { FeatureDetector } from '../src/utils/feature-detector';
import type { OCRManager } from '../src/ocr-manager';

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
  }) as FeatureDetector;

const registerEngines = (factory: {
  register: (id: string, creator: () => unknown) => void;
}): void => {
  factory.register('tesseract', () => ({
    id: 'tesseract',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<{ text: string }> => Promise.resolve({ text: '' }),
    destroy: (): Promise<void> => Promise.resolve(),
  }));
  factory.register('transformers', () => ({
    id: 'transformers',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<{ text: string }> => Promise.resolve({ text: '' }),
    destroy: (): Promise<void> => Promise.resolve(),
  }));
  factory.register('easyocr', () => ({
    id: 'easyocr',
    isLoading: false,
    load: (): Promise<void> => Promise.resolve(),
    process: (): Promise<{ text: string }> => Promise.resolve({ text: '' }),
    destroy: (): Promise<void> => Promise.resolve(),
  }));
};

describe('Engine selection property tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists engine selection across sessions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('tesseract', 'transformers', 'easyocr'),
        async (engineId) => {
          await Promise.resolve();
          document.body.innerHTML = '<div id="app"></div>';
          const root = document.querySelector<HTMLElement>('#app');
          if (!root) throw new Error('Missing root');

          initApp({
            root,
            featureDetector: createSupportedDetector(),
            ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
            registerEngines,
          });

          const select = root.querySelector<HTMLSelectElement>('#engine-select');
          if (!select) throw new Error('Missing select');

          select.value = engineId;
          select.dispatchEvent(new Event('change'));

          document.body.innerHTML = '<div id="app"></div>';
          const newRoot = document.querySelector<HTMLElement>('#app');
          if (!newRoot) throw new Error('Missing root');

          initApp({
            root: newRoot,
            featureDetector: createSupportedDetector(),
            ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
            registerEngines,
          });

          const restoredSelect = newRoot.querySelector<HTMLSelectElement>('#engine-select');
          expect(restoredSelect?.value).toBe(engineId);
        }
      ),
      { numRuns: 10 }
    );
  });
});

describe('Engine selection unit tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders available engines in the dropdown', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    initApp({
      root,
      featureDetector: createSupportedDetector(),
      ocrManager: { setEngine: vi.fn(), run: vi.fn() } as unknown as OCRManager,
      registerEngines,
    });

    const options = root.querySelectorAll<HTMLSelectElement>('#engine-select option');
    expect(options.length).toBe(3);
  });

  it('switches engines when the selection changes', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('Missing root');

    const setEngine = vi.fn(async () => {});
    initApp({
      root,
      featureDetector: createSupportedDetector(),
      ocrManager: { setEngine, run: vi.fn() } as unknown as OCRManager,
      registerEngines,
    });

    const select = root.querySelector<HTMLSelectElement>('#engine-select');
    if (!select) throw new Error('Missing select');

    select.value = 'transformers';
    select.dispatchEvent(new Event('change'));

    await Promise.resolve();
    expect(setEngine).toHaveBeenCalledWith('transformers');
  });
});
