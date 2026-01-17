import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ESearchEngine } from '../src/engines/esearch-engine';

// Mock dependencies
vi.mock('onnxruntime-web', () => ({
  default: { env: { wasm: {} } },
  env: { wasm: {} },
  InferenceSession: { create: vi.fn() }
}));
vi.mock('esearch-ocr', () => ({
  init: vi.fn().mockResolvedValue({ ocr: vi.fn() })
}));

// Mock ModelCache
const { mockLoadOrFetch } = vi.hoisted(() => ({
  mockLoadOrFetch: vi.fn(),
}));

vi.mock('../src/utils/model-cache', () => ({
  ModelCache: vi.fn().mockImplementation(() => ({
    loadOrFetch: mockLoadOrFetch,
  })),
}));

describe('ESearchEngine Caching', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    // Default fetch mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      text: () => Promise.resolve('dummy'),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses ModelCache to load models and dictionary', async () => {
    // Setup mock to execute the fetcher so load() completes successfully
    mockLoadOrFetch.mockImplementation((_key: string, fetcher: () => Promise<ArrayBuffer>) => {
      return fetcher();
    });

    const engine = new ESearchEngine({
      modelPaths: { det: 'det.onnx', rec: 'rec.onnx', dict: 'dict.txt' }
    });

    await engine.load();

    // Verify ModelCache.loadOrFetch was called for all 3 resources
    expect(mockLoadOrFetch).toHaveBeenCalledTimes(3);
    expect(mockLoadOrFetch).toHaveBeenCalledWith('det.onnx', expect.any(Function));
    expect(mockLoadOrFetch).toHaveBeenCalledWith('rec.onnx', expect.any(Function));
    expect(mockLoadOrFetch).toHaveBeenCalledWith('dict.txt', expect.any(Function));
  });

  it('avoids fetch when ModelCache returns cached data', async () => {
    // Setup mock to return cached data WITHOUT calling fetcher
    mockLoadOrFetch.mockImplementation((key: string, _fetcher: () => Promise<ArrayBuffer>) => {
      if (key.endsWith('.txt')) {
        // For dictionary, we need to emulate how fetchTextFile handles it
        // The real implementation expects generic buffer from cache for text too,
        // but let's see. fetchTextFile calls loadOrFetch, which returns buffer.
        // It then decodes it.
        // So we should return an ArrayBuffer here.
        return Promise.resolve(new TextEncoder().encode('cached_dict').buffer);
      }
      return Promise.resolve(new ArrayBuffer(20)); // Cached model
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const engine = new ESearchEngine({
      modelPaths: { det: 'det.onnx', rec: 'rec.onnx', dict: 'dict.txt' }
    });

    await engine.load();

    // Verify fetch was NOT called
    expect(fetchSpy).not.toHaveBeenCalled();

    // Verify ModelCache was still queried
    expect(mockLoadOrFetch).toHaveBeenCalledTimes(3);
  });
});
