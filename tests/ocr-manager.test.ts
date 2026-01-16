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
          load: (): Promise<void> => {
            calls.push(`load:${idA}`);
            return Promise.resolve();
          },
          process: (): Promise<string> => Promise.resolve(''),
          destroy: (): Promise<void> => {
            calls.push(`destroy:${idA}`);
            return Promise.resolve();
          },
        };

        const engineB: IOCREngine = {
          id: idB,
          isLoading: false,
          load: (): Promise<void> => {
            calls.push(`load:${idB}`);
            return Promise.resolve();
          },
          process: (): Promise<string> => Promise.resolve(''),
          destroy: (): Promise<void> => {
            calls.push(`destroy:${idB}`);
            return Promise.resolve();
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

    factory.register('a', (): IOCREngine => ({
      id: 'a',
      isLoading: false,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<string> => Promise.resolve(''),
      destroy: (): Promise<void> => {
        destroyed = true;
        return Promise.resolve();
      },
    }));
    factory.register('b', (): IOCREngine => ({
      id: 'b',
      isLoading: false,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<string> => Promise.resolve(''),
      destroy: (): Promise<void> => Promise.resolve(),
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
    factory.register('loading', (): IOCREngine => ({
      id: 'loading',
      isLoading: true,
      load: (): Promise<void> => Promise.resolve(),
      process: (): Promise<string> => Promise.resolve(''),
      destroy: (): Promise<void> => Promise.resolve(),
    }));

    const manager = new OCRManager(factory);
    await manager.setEngine('loading');

    expect(manager.getLoadingState()).toBe(true);
  });
});
