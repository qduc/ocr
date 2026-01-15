import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { IOCREngine } from '../src/types/ocr-engine';

describe('IOCREngine property tests', () => {
  it('engines satisfy the core interface contract', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), fc.boolean(), async (id, text, isLoading) => {
        const engine: IOCREngine = {
          id,
          isLoading,
          load: async () => {},
          process: async (_data: ImageData) => text,
          destroy: async () => {},
        };

        await engine.load();
        const result = await engine.process({} as ImageData);
        await engine.destroy();

        expect(typeof engine.id).toBe('string');
        expect(typeof engine.isLoading).toBe('boolean');
        expect(typeof result).toBe('string');
        expect(result).toBe(text);
      }),
      { numRuns: 100 }
    );
  });
});
