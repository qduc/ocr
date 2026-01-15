import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OCRManager } from '../src/ocr-manager';
import { EngineFactory } from '../src/engines/engine-factory';
import type { IOCREngine } from '../src/types/ocr-engine';

describe('OCRManager property tests', () => {
  it('destroys the previous engine before loading the next one', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), async (idA, idB) => {
        fc.pre(idA !== idB);

        const calls: string[] = [];
        const factory = new EngineFactory();

        const engineA: IOCREngine = {
          id: idA,
          isLoading: false,
          load: async () => {
            calls.push(`load:${idA}`);
          },
          process: async () => '',
          destroy: async () => {
            calls.push(`destroy:${idA}`);
          },
        };

        const engineB: IOCREngine = {
          id: idB,
          isLoading: false,
          load: async () => {
            calls.push(`load:${idB}`);
          },
          process: async () => '',
          destroy: async () => {
            calls.push(`destroy:${idB}`);
          },
        };

        factory.register(idA, () => engineA);
        factory.register(idB, () => engineB);

        const manager = new OCRManager(factory);
        await manager.setEngine(idA);
        await manager.setEngine(idB);

        const destroyIndex = calls.indexOf(`destroy:${idA}`);
        const loadIndex = calls.indexOf(`load:${idB}`);
        expect(destroyIndex).toBeGreaterThanOrEqual(0);
        expect(loadIndex).toBeGreaterThanOrEqual(0);
        expect(destroyIndex).toBeLessThan(loadIndex);
      }),
      { numRuns: 50 }
    );
  });
});

describe('OCRManager unit tests', () => {
  it('switches engines and cleans up the previous one', async () => {
    const factory = new EngineFactory();
    let destroyed = false;

    factory.register('a', () => ({
      id: 'a',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {
        destroyed = true;
      },
    }));
    factory.register('b', () => ({
      id: 'b',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    const manager = new OCRManager(factory);
    await manager.setEngine('a');
    await manager.setEngine('b');

    expect(destroyed).toBe(true);
  });

  it('throws when run is called without an engine', async () => {
    const factory = new EngineFactory();
    const manager = new OCRManager(factory);

    await expect(manager.run({} as ImageData)).rejects.toThrow('Engine not initialized');
  });

  it('propagates loading state from the active engine', async () => {
    const factory = new EngineFactory();
    factory.register('loading', () => ({
      id: 'loading',
      isLoading: true,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    const manager = new OCRManager(factory);
    await manager.setEngine('loading');

    expect(manager.getLoadingState()).toBe(true);
  });
});
