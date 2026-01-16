export interface ModelCacheStorage {
  init(): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  set(key: string, data: ArrayBuffer): Promise<void>;
  has(key: string): Promise<boolean>;
}

export interface ModelCacheOptions {
  dbName?: string;
  storeName?: string;
  indexedDB?: IDBFactory | undefined;
  storage?: ModelCacheStorage;
}

class IndexedDBStorage implements ModelCacheStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
    private readonly idb: IDBFactory
  ) {}

  async init(): Promise<void> {
    await this.getDb();
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const db = await this.getDb();
    const store = db.transaction(this.storeName, 'readonly').objectStore(this.storeName);
    const request = store.get(key) as IDBRequest<ArrayBuffer | undefined>;
    const result = await this.requestToPromise<ArrayBuffer | undefined>(request);
    return result ?? null;
  }

  async set(key: string, data: ArrayBuffer): Promise<void> {
    const db = await this.getDb();
    const store = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName);
    const request = store.put(data, key);
    await this.requestToPromise(request);
  }

  async has(key: string): Promise<boolean> {
    const db = await this.getDb();
    const store = db.transaction(this.storeName, 'readonly').objectStore(this.storeName);
    const request = store.getKey(key);
    const result = await this.requestToPromise<IDBValidKey | undefined>(request);
    return typeof result !== 'undefined';
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.idb.open(this.dbName, 1);
        request.onupgradeneeded = (): void => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error ?? new Error('IndexedDB open failed.'));
      });
    }

    return this.dbPromise;
  }

  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }
}

export class ModelCache {
  private readonly storage: ModelCacheStorage | null;
  private warnedUnavailable = false;

  constructor(options: ModelCacheOptions = {}) {
    if (options.storage) {
      this.storage = options.storage;
      return;
    }

    const idbFactory = options.indexedDB ?? globalThis.indexedDB;
    if (!idbFactory) {
      this.storage = null;
      return;
    }

    this.storage = new IndexedDBStorage(
      options.dbName ?? 'ocr-model-cache',
      options.storeName ?? 'models',
      idbFactory
    );
  }

  async check(key: string): Promise<boolean> {
    if (!this.storage) {
      return false;
    }

    await this.storage.init();
    return await this.storage.has(key);
  }

  async load(key: string): Promise<ArrayBuffer | null> {
    if (!this.storage) {
      return null;
    }

    await this.storage.init();
    return await this.storage.get(key);
  }

  async store(key: string, data: ArrayBuffer): Promise<void> {
    if (!this.storage) {
      return;
    }

    await this.storage.init();
    await this.storage.set(key, data);
  }

  async loadOrFetch(key: string, fetcher: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (this.storage) {
      await this.storage.init();
      const cached = await this.storage.get(key);
      if (cached) {
        return cached;
      }
    } else if (!this.warnedUnavailable) {
      this.warnedUnavailable = true;
      console.warn('IndexedDB is unavailable; caching is disabled.');
    }

    const data = await fetcher();
    if (this.storage) {
      await this.storage.set(key, data);
    }

    return data;
  }
}
