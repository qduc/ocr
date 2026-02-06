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
  private static dbPromises = new Map<string, Promise<IDBDatabase>>();

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
    const existingPromise = IndexedDBStorage.dbPromises.get(this.dbName);
    if (existingPromise) {
      try {
        const db = await existingPromise;
        if (db.objectStoreNames.contains(this.storeName)) {
          return db;
        }
        // Store missing, connection must be closed to allow upgrade
        db.close();
        IndexedDBStorage.dbPromises.delete(this.dbName);
      } catch (error) {
        IndexedDBStorage.dbPromises.delete(this.dbName);
      }
    }

    const newPromise = new Promise<IDBDatabase>((resolve, reject) => {
      // First, open without version to see what we have
      const openRequest = this.idb.open(this.dbName);

      openRequest.onerror = (): void => {
        IndexedDBStorage.dbPromises.delete(this.dbName);
        reject(openRequest.error ?? new Error('IndexedDB open failed.'));
      };

      openRequest.onsuccess = (): void => {
        const db = openRequest.result;

        db.onversionchange = (): void => {
          db.close();
          IndexedDBStorage.dbPromises.delete(this.dbName);
        };

        if (db.objectStoreNames.contains(this.storeName)) {
          resolve(db);
          return;
        }

        // Store doesn't exist, need to upgrade
        const currentVersion = db.version;
        db.close();

        const upgradeRequest = this.idb.open(this.dbName, currentVersion + 1);

        upgradeRequest.onupgradeneeded = (): void => {
          const upgradeDb = upgradeRequest.result;
          if (!upgradeDb.objectStoreNames.contains(this.storeName)) {
            upgradeDb.createObjectStore(this.storeName);
          }
        };

        upgradeRequest.onsuccess = (): void => {
          const upgradeDb = upgradeRequest.result;
          upgradeDb.onversionchange = (): void => {
            upgradeDb.close();
            IndexedDBStorage.dbPromises.delete(this.dbName);
          };
          resolve(upgradeDb);
        };

        upgradeRequest.onerror = (): void => {
          IndexedDBStorage.dbPromises.delete(this.dbName);
          reject(upgradeRequest.error ?? new Error('IndexedDB upgrade failed.'));
        };

        upgradeRequest.onblocked = (): void => {
          console.warn('IndexedDB upgrade blocked. Please close other instances of this app.');
        };
      };

      openRequest.onupgradeneeded = (): void => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });

    IndexedDBStorage.dbPromises.set(this.dbName, newPromise);
    return newPromise;
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

  async loadOrFetch(key: string, fetcher: () => Promise<ArrayBufferLike>): Promise<ArrayBuffer> {
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

    const dataLike = await fetcher();
    // Ensure we store and return an ArrayBuffer. If the fetcher returned a
    // SharedArrayBuffer or other ArrayBufferLike, make a copy into a regular
    // ArrayBuffer before storing/returning.
    let buffer: ArrayBuffer;
    if (dataLike instanceof ArrayBuffer) {
      buffer = dataLike;
    } else {
      // Create a Uint8Array view and copy the contents to a new ArrayBuffer.
      buffer = new Uint8Array(dataLike as ArrayBufferLike).slice().buffer;
    }

    if (this.storage) {
      await this.storage.set(key, buffer);
    }

    return buffer;
  }
}
