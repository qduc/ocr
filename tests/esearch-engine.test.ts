import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { ESearchEngine } from '../src/engines/esearch-engine';
import type { ESearchOCROutput, ESearchModelPaths } from '../src/types/esearch-types';

// Mock onnxruntime-web
vi.mock('onnxruntime-web', () => ({
  default: {},
  InferenceSession: {
    create: vi.fn(),
  },
}));

// Mock esearch-ocr
const mockOcrInstance = {
  ocr: vi.fn(),
  det: vi.fn(),
  rec: vi.fn(),
  recRaw: vi.fn(),
};

const initMock = vi.fn();

vi.mock('esearch-ocr', () => ({
  init: initMock,
}));

// ImageData polyfill for test environment
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

  (globalThis as unknown as { ImageData: typeof ImageDataPolyfill }).ImageData = ImageDataPolyfill;
}

const createMockModelPaths = (): ESearchModelPaths => ({
  det: '/models/esearch/det.onnx',
  rec: '/models/esearch/rec.onnx',
  dict: '/models/esearch/ppocr_keys_v1.txt',
});

const createMockOCROutput = (text: string = 'Hello World'): ESearchOCROutput => ({
  src: [
    {
      text,
      mean: 0.95,
      box: [[0, 0], [100, 0], [100, 20], [0, 20]],
      style: { bg: [255, 255, 255], text: [0, 0, 0] },
    },
  ],
  columns: [],
  parragraphs: [
    {
      text,
      mean: 0.95,
      box: [[0, 0], [100, 0], [100, 20], [0, 20]],
      style: { bg: [255, 255, 255], text: [0, 0, 0] },
    },
  ],
  readingDir: { inline: 'lr', block: 'tb' },
  angle: { reading: { inline: 0, block: 90 }, angle: 0 },
  docDir: 0,
});

const createTestImageData = (width = 100, height = 100) => {
  return new ImageData(width, height);
};

describe('ESearchEngine property tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    // Mock fetch for model downloads
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.onnx')) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });
      }
      if (url.endsWith('.txt')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('a\nb\nc\nd'),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('extracts text from various OCR output structures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
        async (texts) => {
          const output: ESearchOCROutput = {
            src: texts.map((t, i) => ({
              text: t,
              mean: 0.9,
              box: [[i * 10, 0], [i * 10 + 100, 0], [i * 10 + 100, 20], [i * 10, 20]] as [[number, number], [number, number], [number, number], [number, number]],
              style: { bg: [255, 255, 255] as [number, number, number], text: [0, 0, 0] as [number, number, number] },
            })),
            columns: [],
            parragraphs: texts.map((t, i) => ({
              text: t,
              mean: 0.9,
              box: [[i * 10, 0], [i * 10 + 100, 0], [i * 10 + 100, 20], [i * 10, 20]] as [[number, number], [number, number], [number, number], [number, number]],
              style: { bg: [255, 255, 255] as [number, number, number], text: [0, 0, 0] as [number, number, number] },
            })),
            readingDir: { inline: 'lr', block: 'tb' },
            angle: { reading: { inline: 0, block: 90 }, angle: 0 },
            docDir: 0,
          };

          initMock.mockResolvedValueOnce({
            ...mockOcrInstance,
            ocr: vi.fn().mockResolvedValue(output),
          });

          const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
          await engine.load();
          const result = await engine.process(createTestImageData());

          expect(result).toBe(texts.join('\n'));
        }
      ),
      { numRuns: 20 }
    );
  });

  it('handles various image dimensions correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (width, height) => {
          initMock.mockResolvedValueOnce({
            ...mockOcrInstance,
            ocr: vi.fn().mockResolvedValue(createMockOCROutput('Test')),
          });

          const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
          await engine.load();

          const imageData = createTestImageData(width, height);
          const result = await engine.process(imageData);

          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 15 }
    );
  });

  it('cleans up resources on destroy regardless of state', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (loadFirst) => {
        initMock.mockResolvedValueOnce({
          ...mockOcrInstance,
          ocr: vi.fn().mockResolvedValue(createMockOCROutput()),
        });

        const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });

        if (loadFirst) {
          await engine.load();
        }

        // Should not throw even if not loaded
        await expect(engine.destroy()).resolves.toBeUndefined();
      }),
      { numRuns: 10 }
    );
  });
});

describe('ESearchEngine unit tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    // Default mock fetch
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.onnx')) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });
      }
      if (url.endsWith('.txt')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('a\nb\nc'),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('initialization', () => {
    it('creates engine with correct id', () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      expect(engine.id).toBe('esearch');
    });

    it('starts with isLoading as false', () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      expect(engine.isLoading).toBe(false);
    });

    it('accepts onProgress callback in options', () => {
      const progressSpy = vi.fn();
      const engine = new ESearchEngine({
        modelPaths: createMockModelPaths(),
        onProgress: progressSpy,
      });
      expect(engine).toBeDefined();
    });

    it('accepts optimizeSpace option', () => {
      const engine = new ESearchEngine({
        modelPaths: createMockModelPaths(),
        optimizeSpace: false,
      });
      expect(engine).toBeDefined();
    });
  });

  describe('load()', () => {
    it('fetches all required model files', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.onnx')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          });
        }
        if (url.endsWith('.txt')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('dictionary content'),
          });
        }
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });
      globalThis.fetch = fetchMock;

      initMock.mockResolvedValueOnce(mockOcrInstance);

      const modelPaths = createMockModelPaths();
      const engine = new ESearchEngine({ modelPaths });
      await engine.load();

      expect(fetchMock).toHaveBeenCalledWith(modelPaths.det);
      expect(fetchMock).toHaveBeenCalledWith(modelPaths.rec);
      expect(fetchMock).toHaveBeenCalledWith(modelPaths.dict);
    });

    it('initializes esearch-ocr with correct options', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const engine = new ESearchEngine({
        modelPaths: createMockModelPaths(),
        optimizeSpace: false,
      });
      await engine.load();

      expect(initMock).toHaveBeenCalledWith(
        expect.objectContaining({
          det: expect.objectContaining({
            input: expect.any(ArrayBuffer),
          }),
          rec: expect.objectContaining({
            input: expect.any(ArrayBuffer),
            decodeDic: expect.any(String),
            optimize: expect.objectContaining({
              space: false,
            }),
          }),
        })
      );
    });

    it('invokes progress callback during load stages', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const progressSpy = vi.fn();
      const engine = new ESearchEngine({
        modelPaths: createMockModelPaths(),
        onProgress: progressSpy,
      });
      await engine.load();

      // Check that progress was reported at various stages
      expect(progressSpy).toHaveBeenCalledWith('Downloading detection model', expect.any(Number));
      expect(progressSpy).toHaveBeenCalledWith('Downloading recognition model', expect.any(Number));
      expect(progressSpy).toHaveBeenCalledWith('Downloading dictionary', expect.any(Number));
      expect(progressSpy).toHaveBeenCalledWith('Initializing OCR engine', expect.any(Number));
      expect(progressSpy).toHaveBeenCalledWith('Ready', 1);
    });

    it('does not reload if already loaded', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();
      await engine.load(); // Second call

      expect(initMock).toHaveBeenCalledTimes(1);
    });

    it('sets isLoading to false after successful load', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      expect(engine.isLoading).toBe(false);
    });

    it('sets isLoading to false after failed load', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });

      await expect(engine.load()).rejects.toThrow();
      expect(engine.isLoading).toBe(false);
    });
  });

  describe('load() error handling', () => {
    it('throws error when detection model fetch fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('det')) {
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }
        if (url.endsWith('.onnx')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('dict'),
        });
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.load()).rejects.toThrow(/Failed to load eSearch-OCR engine/);
    });

    it('throws error when recognition model fetch fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('rec')) {
          return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' });
        }
        if (url.endsWith('.onnx')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('dict'),
        });
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.load()).rejects.toThrow(/Failed to load eSearch-OCR engine/);
    });

    it('throws error when dictionary fetch fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.txt')) {
          return Promise.resolve({ ok: false, status: 403, statusText: 'Forbidden' });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.load()).rejects.toThrow(/Failed to load eSearch-OCR engine/);
    });

    it('throws error when esearch-ocr init fails', async () => {
      initMock.mockRejectedValueOnce(new Error('ONNX session creation failed'));

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.load()).rejects.toThrow('Failed to load eSearch-OCR engine: ONNX session creation failed');
    });

    it('wraps non-Error exceptions in error message', async () => {
      initMock.mockRejectedValueOnce('string error');

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.load()).rejects.toThrow('Failed to load eSearch-OCR engine: Unknown error');
    });
  });

  describe('process()', () => {
    beforeEach(() => {
      initMock.mockResolvedValue({
        ...mockOcrInstance,
        ocr: vi.fn().mockResolvedValue(createMockOCROutput('Recognized text')),
      });
    });

    it('processes image and returns extracted text', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      const result = await engine.process(createTestImageData());
      expect(result).toBe('Recognized text');
    });

    it('throws error if engine not loaded', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });

      await expect(engine.process(createTestImageData())).rejects.toThrow(
        'eSearch-OCR engine not loaded.'
      );
    });

    it('throws error for null image data', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      // @ts-expect-error - testing invalid input
      await expect(engine.process(null)).rejects.toThrow('Invalid image data for OCR.');
    });

    it('throws error for zero-width image', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      const invalidData = { width: 0, height: 100, data: new Uint8ClampedArray(0) } as ImageData;
      await expect(engine.process(invalidData)).rejects.toThrow('Invalid image data for OCR.');
    });

    it('throws error for zero-height image', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      const invalidData = { width: 100, height: 0, data: new Uint8ClampedArray(0) } as ImageData;
      await expect(engine.process(invalidData)).rejects.toThrow('Invalid image data for OCR.');
    });

    it('wraps OCR processing errors', async () => {
      initMock.mockResolvedValueOnce({
        ...mockOcrInstance,
        ocr: vi.fn().mockRejectedValue(new Error('Recognition failed')),
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      await expect(engine.process(createTestImageData())).rejects.toThrow(
        'eSearch-OCR processing failed: Recognition failed'
      );
    });

    it('handles empty OCR results', async () => {
      initMock.mockResolvedValueOnce({
        ...mockOcrInstance,
        ocr: vi.fn().mockResolvedValue({
          ...createMockOCROutput(),
          parragraphs: [],
        }),
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      const result = await engine.process(createTestImageData());
      expect(result).toBe('');
    });

    it('joins multiple paragraphs with newlines', async () => {
      initMock.mockResolvedValueOnce({
        ...mockOcrInstance,
        ocr: vi.fn().mockResolvedValue({
          ...createMockOCROutput(),
          parragraphs: [
            { text: 'Line 1', mean: 0.9, box: [[0, 0], [100, 0], [100, 20], [0, 20]], style: { bg: [255, 255, 255], text: [0, 0, 0] } },
            { text: 'Line 2', mean: 0.9, box: [[0, 25], [100, 25], [100, 45], [0, 45]], style: { bg: [255, 255, 255], text: [0, 0, 0] } },
            { text: 'Line 3', mean: 0.9, box: [[0, 50], [100, 50], [100, 70], [0, 70]], style: { bg: [255, 255, 255], text: [0, 0, 0] } },
          ],
        }),
      });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();

      const result = await engine.process(createTestImageData());
      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('destroy()', () => {
    it('releases OCR instance reference', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();
      await engine.destroy();

      // After destroy, process should fail
      await expect(engine.process(createTestImageData())).rejects.toThrow(
        'eSearch-OCR engine not loaded.'
      );
    });

    it('can be called multiple times safely', async () => {
      initMock.mockResolvedValueOnce(mockOcrInstance);

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();
      await engine.destroy();
      await engine.destroy();
      await engine.destroy();

      // Should not throw
      expect(true).toBe(true);
    });

    it('can be called before load', async () => {
      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await expect(engine.destroy()).resolves.toBeUndefined();
    });

    it('allows reloading after destroy', async () => {
      initMock
        .mockResolvedValueOnce({
          ...mockOcrInstance,
          ocr: vi.fn().mockResolvedValue(createMockOCROutput('First load')),
        })
        .mockResolvedValueOnce({
          ...mockOcrInstance,
          ocr: vi.fn().mockResolvedValue(createMockOCROutput('Second load')),
        });

      const engine = new ESearchEngine({ modelPaths: createMockModelPaths() });
      await engine.load();
      const result1 = await engine.process(createTestImageData());
      expect(result1).toBe('First load');

      await engine.destroy();
      await engine.load();
      const result2 = await engine.process(createTestImageData());
      expect(result2).toBe('Second load');
    });
  });

  describe('progress callback integration', () => {
    it('reports recognition progress via rec.on callback', async () => {
      let recOnCallback: ((index: number, result: unknown, total: number) => void) | undefined;

      initMock.mockImplementationOnce(async (options: { rec: { on?: (index: number, result: unknown, total: number) => void } }) => {
        recOnCallback = options.rec.on;
        return {
          ...mockOcrInstance,
          ocr: vi.fn().mockImplementation(async () => {
            // Simulate recognition progress
            if (recOnCallback) {
              recOnCallback(0, [], 3);
              recOnCallback(1, [], 3);
              recOnCallback(2, [], 3);
            }
            return createMockOCROutput('Test');
          }),
        };
      });

      const progressSpy = vi.fn();
      const engine = new ESearchEngine({
        modelPaths: createMockModelPaths(),
        onProgress: progressSpy,
      });
      await engine.load();

      // The recognition progress callback was captured during init
      expect(recOnCallback).toBeDefined();
    });
  });
});

describe('extractTextFromESearchOutput utility', () => {
  it('extracts text from standard output', () => {
    const { extractTextFromESearchOutput } = require('../src/types/esearch-types');

    const output: ESearchOCROutput = createMockOCROutput('Hello World');
    expect(extractTextFromESearchOutput(output)).toBe('Hello World');
  });

  it('joins multiple paragraphs with newlines', () => {
    const { extractTextFromESearchOutput } = require('../src/types/esearch-types');

    const output: ESearchOCROutput = {
      ...createMockOCROutput(),
      parragraphs: [
        { text: 'First', mean: 0.9, box: [[0, 0], [10, 0], [10, 10], [0, 10]], style: { bg: [255, 255, 255], text: [0, 0, 0] } },
        { text: 'Second', mean: 0.9, box: [[0, 15], [10, 15], [10, 25], [0, 25]], style: { bg: [255, 255, 255], text: [0, 0, 0] } },
      ],
    };

    expect(extractTextFromESearchOutput(output)).toBe('First\nSecond');
  });

  it('returns empty string for empty paragraphs', () => {
    const { extractTextFromESearchOutput } = require('../src/types/esearch-types');

    const output: ESearchOCROutput = {
      ...createMockOCROutput(),
      parragraphs: [],
    };

    expect(extractTextFromESearchOutput(output)).toBe('');
  });
});

describe('mapESearchResultToStandard utility', () => {
  it('maps esearch results to standard format', () => {
    const { mapESearchResultToStandard } = require('../src/types/esearch-types');

    const items = [
      {
        text: 'Test',
        mean: 0.95,
        box: [[10, 20], [110, 20], [110, 40], [10, 40]] as [[number, number], [number, number], [number, number], [number, number]],
        style: { bg: [255, 255, 255] as [number, number, number], text: [0, 0, 0] as [number, number, number] },
      },
    ];

    const result = mapESearchResultToStandard(items);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      text: 'Test',
      confidence: 0.95,
      boundingBox: {
        x: 10,
        y: 20,
        width: 100,
        height: 20,
      },
    });
  });

  it('handles multiple items', () => {
    const { mapESearchResultToStandard } = require('../src/types/esearch-types');

    const items = [
      {
        text: 'First',
        mean: 0.9,
        box: [[0, 0], [50, 0], [50, 10], [0, 10]] as [[number, number], [number, number], [number, number], [number, number]],
        style: { bg: [255, 255, 255] as [number, number, number], text: [0, 0, 0] as [number, number, number] },
      },
      {
        text: 'Second',
        mean: 0.85,
        box: [[60, 0], [120, 0], [120, 10], [60, 10]] as [[number, number], [number, number], [number, number], [number, number]],
        style: { bg: [255, 255, 255] as [number, number, number], text: [0, 0, 0] as [number, number, number] },
      },
    ];

    const result = mapESearchResultToStandard(items);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First');
    expect(result[1].text).toBe('Second');
  });

  it('returns empty array for empty input', () => {
    const { mapESearchResultToStandard } = require('../src/types/esearch-types');

    const result = mapESearchResultToStandard([]);
    expect(result).toEqual([]);
  });
});
