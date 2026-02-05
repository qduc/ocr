import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Bergamot from '@browsermt/bergamot-translator/translator.js';
import { BergamotTextTranslator } from '../src/translation/bergamot-translator';

// Mock the bergamot library
vi.mock('@browsermt/bergamot-translator/translator.js', () => {
  return {
    LatencyOptimisedTranslator: vi.fn(),
    TranslatorBacking: vi.fn().mockImplementation(() => {
      return {
        loadWorker: vi.fn().mockResolvedValue({}),
        onerror: vi.fn(),
        options: {},
        fetch: vi.fn(),
      };
    }),
  };
});

describe('BergamotTextTranslator', () => {
  let translator: any;
  let mockTranslate: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockTranslate = vi.fn().mockImplementation(async (req) => {
      // Simulate some latency
      await new Promise(resolve => setTimeout(resolve, 10));
      return { target: { text: `translated: ${req.text}` } };
    });

    (Bergamot.LatencyOptimisedTranslator as any).mockImplementation(() => {
      return {
        worker: Promise.resolve(),
        translate: mockTranslate,
        delete: vi.fn(),
      };
    });

    translator = new BergamotTextTranslator();
  });

  it('should serialize concurrent translation requests', async () => {
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    mockTranslate.mockImplementation(async (req) => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise(resolve => setTimeout(resolve, 20));
      concurrentCalls--;
      return { target: { text: `translated: ${req.text}` } };
    });

    const results = await Promise.all([
      translator.translate({ from: 'en', to: 'fr', text: 'one' }),
      translator.translate({ from: 'en', to: 'fr', text: 'two' }),
      translator.translate({ from: 'en', to: 'fr', text: 'three' }),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].text).toBe('translated: one');
    expect(results[1].text).toBe('translated: two');
    expect(results[2].text).toBe('translated: three');
    
    // If serialized, maxConcurrentCalls should be 1
    expect(maxConcurrentCalls).toBe(1);
    expect(mockTranslate).toHaveBeenCalledTimes(3);
  });

  it('should continue processing the queue after a failure', async () => {
    mockTranslate
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce({ target: { text: 'success' } });

    await expect(translator.translate({ from: 'en', to: 'fr', text: 'fail' })).rejects.toThrow('Failed');
    
    const result = await translator.translate({ from: 'en', to: 'fr', text: 'next' });
    expect(result.text).toBe('success');
    expect(mockTranslate).toHaveBeenCalledTimes(2);
  });
});
