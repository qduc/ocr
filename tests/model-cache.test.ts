import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ModelCache, type ModelCacheStorage } from '../src/utils/model-cache';

class MemoryStorage implements ModelCacheStorage {
  private readonly store = new Map<string, ArrayBuffer>();

  init(): Promise<void> {
    return Promise.resolve();
  }

  get(key: string): Promise<ArrayBuffer | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, data: ArrayBuffer): Promise<void> {
    this.store.set(key, data);
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key));
  }
}

const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

describe('ModelCache property tests', () => {
  it('stores and loads cached models accurately', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), fc.uint8Array(), async (key, data) => {
        const cache = new ModelCache({ storage: new MemoryStorage() });
        const buffer = toArrayBuffer(data);

        await cache.store(key, buffer);
        const loaded = await cache.load(key);

        expect(loaded).not.toBeNull();
        const loadedView = new Uint8Array(loaded as ArrayBuffer);
        expect(loadedView).toEqual(new Uint8Array(buffer));
      }),
      { numRuns: 50 }
    );
  });

  it('uses cached data before fetching', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.uint8Array(),
        fc.uint8Array(),
        async (key, cached, fresh) => {
          const cache = new ModelCache({ storage: new MemoryStorage() });
          const cachedBuffer = toArrayBuffer(cached);
          const freshBuffer = toArrayBuffer(fresh);
          const fetcher = vi.fn().mockResolvedValue(freshBuffer);

          await cache.store(key, cachedBuffer);
          const loaded = await cache.loadOrFetch(key, fetcher);

          expect(fetcher).not.toHaveBeenCalled();
          expect(new Uint8Array(loaded)).toEqual(new Uint8Array(cachedBuffer));
        }
      ),
      { numRuns: 25 }
    );
  });

  it('delays fetching until loadOrFetch is called', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (key) => {
        const cache = new ModelCache({ storage: new MemoryStorage() });
        const fetcher = vi.fn().mockResolvedValue(new ArrayBuffer(0));

        await cache.check(key);
        await cache.load(key);

        expect(fetcher).not.toHaveBeenCalled();

        await cache.loadOrFetch(key, fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 20 }
    );
  });
});

describe('ModelCache unit tests', () => {
  it('fetches and stores on cache miss', async () => {
    const cache = new ModelCache({ storage: new MemoryStorage() });
    const data = new Uint8Array([1, 2, 3]);
    const fetcher = vi.fn().mockResolvedValue(toArrayBuffer(data));

    const result = await cache.loadOrFetch('model', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(result)).toEqual(data);
    const cached = await cache.load('model');
    expect(new Uint8Array(cached as ArrayBuffer)).toEqual(data);
  });

  it('falls back to network when IndexedDB is unavailable', async () => {
    const cache = new ModelCache({ indexedDB: undefined });
    const data = new Uint8Array([4, 5, 6]);
    const fetcher = vi.fn().mockResolvedValue(toArrayBuffer(data));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await cache.loadOrFetch('model', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(result)).toEqual(data);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not fetch until loadOrFetch is called', async () => {
    const cache = new ModelCache({ storage: new MemoryStorage() });
    const fetcher = vi.fn().mockResolvedValue(toArrayBuffer(new Uint8Array([7])));

    await cache.check('model');
    await cache.load('model');

    expect(fetcher).not.toHaveBeenCalled();

    await cache.loadOrFetch('model', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
