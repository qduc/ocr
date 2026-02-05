import { LatencyOptimisedTranslator } from '@browsermt/bergamot-translator/translator.js';
// TranslatorBacking is not exported in some versions of the package; we'll treat it as unknown at runtime.
import type { ITextTranslator, TranslationRequest, TranslationResponse } from '@/types/translation';
import { ModelCache } from '@/utils/model-cache';

type BergamotInitOptions = {
  cacheSize?: number;
  useNativeIntGemm?: boolean;
  downloadTimeout?: number;
  workerUrl?: string;
  registryUrl?: string;
  pivotLanguage?: string;
  onerror?: (err: Error) => void;
};

type WorkerErrorPayload = {
  message?: string;
  stack?: string;
};

type PendingCall = {
  accept: (value: unknown) => void;
  reject: (error: Error) => void;
  callsite: {
    message: string;
    stack?: string;
  };
};

type WorkerExports = Record<string, (...args: unknown[]) => Promise<unknown>>;

type WorkerHandle = {
  worker: Worker;
  exports: WorkerExports;
};

type TranslatorRequest = {
  from: string;
  to: string;
  text: string;
  html?: boolean;
};

type TranslatorResult = {
  target: {
    text: string;
  };
};

type TranslatorBackingLike = {
  loadWorker: () => Promise<WorkerHandle>;
  onerror: (err: Error) => void;
  options: unknown;
  fetch: (url: string, checksum?: string, extra?: { signal?: AbortSignal }) => Promise<ArrayBuffer>;
};

type LatencyOptimisedTranslatorLike = {
  worker: Promise<unknown>;
  translate: (request: TranslatorRequest) => Promise<TranslatorResult>;
  delete: () => void | Promise<void>;
};

const createWorkerUrl = (): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const baseUrl = new URL(base, window.location.origin);
  return new URL('bergamot/worker/translator-worker.js', baseUrl).toString();
};

const createRegistryUrl = (): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const baseUrl = new URL(base, window.location.origin);
  return new URL('bergamot/registry.json', baseUrl).toString();
};

const decompressGzip = async (buffer: ArrayBuffer): Promise<ArrayBuffer> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip models require DecompressionStream support.');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const response = new Response(stream);
  return response.arrayBuffer();
};

export class BergamotTextTranslator implements ITextTranslator {
  private instance: LatencyOptimisedTranslatorLike | null = null;
  private initializing: Promise<LatencyOptimisedTranslatorLike> | null = null;

  private static readonly cache = new ModelCache({
    dbName: 'ocr-model-cache',
    storeName: 'translation-models',
  });

  private async getTranslator(): Promise<LatencyOptimisedTranslatorLike> {
    if (this.instance) {
      return this.instance;
    }

    if (!this.initializing) {
      const workerUrl = createWorkerUrl();
      const registryUrl = createRegistryUrl();
      // Create a backing instance and patch loadWorker before the translator constructor runs.
      // TranslatorBacking may not be exported by all versions; try to read from global
      const TranslatorBackingCtor = (globalThis as any).TranslatorBacking as
        | (new (options?: BergamotInitOptions) => TranslatorBackingLike)
        | undefined;
      const backing = TranslatorBackingCtor
        ? new TranslatorBackingCtor({
            downloadTimeout: 60000,
            registryUrl,
          })
        : ({} as TranslatorBackingLike);

      const originalLoadWorker = backing.loadWorker.bind(backing);
      const originalFetch = backing.fetch.bind(backing);
      backing.loadWorker = function (this: TranslatorBackingLike): Promise<WorkerHandle> {
        // If we have a custom workerUrl, we use it.
        // The library's default uses new URL('./worker/translator-worker.js', import.meta.url)
        if (workerUrl) {
          const onError = this.onerror.bind(this);
          const options = this.options;
          const loadWithCustomWorker = async (): Promise<WorkerHandle> => {
            const worker = new Worker(workerUrl);

            // Standard library initialization follows
            let serial = 0;
            const pending = new Map<number, PendingCall>();

            const call = (name: string, ...args: unknown[]): Promise<unknown> =>
              new Promise((accept, reject) => {
                const id = ++serial;
                pending.set(id, {
                  accept: (value: unknown) => accept(value),
                  reject: (error: Error) => reject(error),
                  callsite: {
                    message: `${name}(${args.map((arg) => String(arg)).join(', ')})`,
                    stack: new Error().stack,
                  },
                });
                worker.postMessage({ id, name, args });
              });

            worker.addEventListener(
              'message',
              function ({
                data,
              }: MessageEvent<{ id: number; result?: unknown; error?: WorkerErrorPayload }>) {
                const { id, result, error } = data;
                const entry = pending.get(id);
                if (!entry) return;
                pending.delete(id);
                if (error !== undefined) {
                  const errorPayload = error ?? {};
                  entry.reject(
                    Object.assign(new Error(), errorPayload, {
                      message:
                        (errorPayload.message ?? 'Worker error') +
                        ` (response to ${entry.callsite.message})`,
                      stack: errorPayload.stack
                        ? `${errorPayload.stack}\n${entry.callsite.stack}`
                        : entry.callsite.stack,
                    })
                  );
                } else {
                  entry.accept(result);
                }
              }
            );

            worker.addEventListener('error', (ev) => {
              onError(new Error(ev.message || 'Unknown worker error'));
            });

            await call('initialize', options);

            return {
              worker,
              exports: new Proxy(
                {},
                {
                  get(_target, name): unknown {
                    if (name !== 'then')
                      return (...args: unknown[]) => call(name as string, ...args);
                    return undefined;
                  },
                }
              ),
            };
          };
          return loadWithCustomWorker();
        }
        return originalLoadWorker();
      };

      backing.fetch = async (
        url: string,
        checksum?: string,
        extra?: { signal?: AbortSignal }
      ): Promise<ArrayBuffer> => {
        return BergamotTextTranslator.cache.loadOrFetch(url, async () => {
          const buffer = await originalFetch(url, checksum, extra);
          if (url.endsWith('.gz')) {
            return decompressGzip(buffer);
          }
          return buffer;
        });
      };

      // Some versions of the library have differing constructor typings; cast to any
      const translator = new (LatencyOptimisedTranslator as any)(
        {
          workerUrl: workerUrl,
          downloadTimeout: 60000,
          registryUrl,
        } as BergamotInitOptions,
        backing
      ) as unknown as LatencyOptimisedTranslatorLike;

      // Wait for the worker to be initialized
      this.initializing = translator.worker.then(() => translator);
    }

    this.instance = await this.initializing;
    if (!this.instance) {
      throw new Error('Translator initialization failed');
    }
    return this.instance;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const translator = await this.getTranslator();
    const response = await translator.translate({
      from: request.from,
      to: request.to,
      text: request.text,
      html: request.html ?? false,
    });
    return { text: response.target.text };
  }

  destroy(): void {
    if (this.instance) {
      void this.instance.delete();
      this.instance = null;
    }
    this.initializing = null;
  }
}
