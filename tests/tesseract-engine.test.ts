import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TesseractEngine } from '../src/engines/tesseract-engine';
import { createWorker } from 'tesseract.js';

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
}));

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
/** Mock Canvas for JSDOM */
if (typeof HTMLCanvasElement !== 'undefined') {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: vi.fn(),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob());
  });
}

const createWorkerMock = vi.mocked(createWorker);

const makeWorker = (text: string = 'hello') => ({
  recognize: vi.fn().mockResolvedValue({ data: { text } }),
  terminate: vi.fn().mockResolvedValue(undefined),
});

describe('TesseractEngine property tests', () => {
  beforeEach(() => {
    createWorkerMock.mockReset();
  });

  it('terminates the worker on destroy', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const worker = makeWorker(text);
        createWorkerMock.mockResolvedValueOnce(worker as unknown as ReturnType<typeof makeWorker>);

        const engine = new TesseractEngine();
        await engine.load();
        await engine.destroy();

        expect(worker.terminate).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 25 }
    );
  });
});

describe('TesseractEngine unit tests', () => {
  beforeEach(() => {
    createWorkerMock.mockReset();
  });

  it('loads the worker with English language support', async () => {
    const worker = makeWorker();
    createWorkerMock.mockResolvedValueOnce(worker as unknown as ReturnType<typeof makeWorker>);

    const engine = new TesseractEngine();
    await engine.load();

    expect(createWorkerMock).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining({
        cacheMethod: 'refresh',
        logger: expect.any(Function),
      })
    );
  });

  it('invokes progress callback during load', async () => {
    const worker = makeWorker();
    const progressSpy = vi.fn();

    createWorkerMock.mockImplementationOnce(async (_lang, _oem, options) => {
      options?.logger?.({ status: 'loading', progress: 0.5 });
      return worker as unknown as ReturnType<typeof makeWorker>;
    });

    const engine = new TesseractEngine(progressSpy);
    await engine.load();

    expect(progressSpy).toHaveBeenCalledWith('loading', 0.5);
  });

  it('processes images and returns text', async () => {
    const worker = makeWorker('OCR text');
    createWorkerMock.mockResolvedValueOnce(worker as unknown as ReturnType<typeof makeWorker>);

    const engine = new TesseractEngine();
    await engine.load();

    const result = await engine.process(new ImageData(1, 1));
    expect(result).toBe('OCR text');
    expect(worker.recognize).toHaveBeenCalled();
  });

  it('destroys the worker on cleanup', async () => {
    const worker = makeWorker();
    createWorkerMock.mockResolvedValueOnce(worker as unknown as ReturnType<typeof makeWorker>);

    const engine = new TesseractEngine();
    await engine.load();
    await engine.destroy();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
