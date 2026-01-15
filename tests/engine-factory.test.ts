import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EngineFactory } from '../src/engines/engine-factory';
import type { IOCREngine } from '../src/types/ocr-engine';

describe('EngineFactory property tests', () => {
  it('registered engines are retrievable by id', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        const factory = new EngineFactory();
        const creator = (): IOCREngine => ({
          id,
          isLoading: false,
          load: async () => {},
          process: async () => '',
          destroy: async () => {},
        });

        factory.register(id, creator);
        const engine = factory.create(id);

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

  it('throws when creating an unknown engine', () => {
    const factory = new EngineFactory();
    expect(() => factory.create('missing')).toThrow('Engine not registered');
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

  it('throws when engine id mismatches registration', () => {
    const factory = new EngineFactory();
    factory.register('tesseract', () => ({
      id: 'wrong-id',
      isLoading: false,
      load: async () => {},
      process: async () => '',
      destroy: async () => {},
    }));

    expect(() => factory.create('tesseract')).toThrow('Engine id mismatch');
  });
});
