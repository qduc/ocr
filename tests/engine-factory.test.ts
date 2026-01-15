import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EngineFactory } from '../src/engines/engine-factory';
import type { IOCREngine } from '../src/types/ocr-engine';

describe('EngineFactory property tests', () => {
  it('registered engines are retrievable by id', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (id) => {
        const factory = new EngineFactory();
        const creator = (): IOCREngine => ({
          id,
          isLoading: false,
          load: async () => {},
          process: async () => '',
          destroy: async () => {},
        });

        factory.register(id, creator);
        const engine = await factory.create(id);

        expect(engine.id).toBe(id);
      }),
      { numRuns: 100 }
    );
  });
});

describe('EngineFactory unit tests', () => {
  it('registers multiple engines and lists them', () => {
    const factory = new EngineFactory();
    factory.register('tesseract', () => ({
      id: 'tesseract',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));
    factory.register('transformers', () => ({
      id: 'transformers',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    expect(factory.getAvailableEngines().sort()).toEqual(['tesseract', 'transformers']);
  });

  it('throws when creating an unknown engine', async () => {
    const factory = new EngineFactory();
    await expect(factory.create('missing')).rejects.toThrow('Engine not registered');
  });

  it('throws when registering a duplicate engine', () => {
    const factory = new EngineFactory();
    factory.register('tesseract', () => ({
      id: 'tesseract',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    expect(() =>
      factory.register('tesseract', () => ({
        id: 'tesseract',
        isLoading: false,
        load: async () => {},
        process: async () => '',
        destroy: async () => {},
      }))
    ).toThrow('Engine already registered');
  });

  it('throws when engine id mismatches registration', async () => {
    const factory = new EngineFactory();
    factory.register('tesseract', () => ({
      id: 'wrong-id',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    await expect(factory.create('tesseract')).rejects.toThrow('Engine id mismatch');
  });
});
