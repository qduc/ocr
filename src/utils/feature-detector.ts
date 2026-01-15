import type { BrowserCapabilities } from '@/types/browser-capabilities';

export interface FeatureDetectorEnv {
  WebAssembly?: unknown;
  Worker?: unknown;
  indexedDB?: unknown;
  navigator?: { gpu?: unknown };
  gpu?: unknown;
}

export class FeatureDetector {
  private readonly env: FeatureDetectorEnv;

  constructor(env: FeatureDetectorEnv = globalThis as FeatureDetectorEnv) {
    this.env = env;
  }

  detectWASM(): boolean {
    return typeof this.env.WebAssembly !== 'undefined';
  }

  detectWebWorkers(): boolean {
    return typeof this.env.Worker !== 'undefined';
  }

  detectIndexedDB(): boolean {
    return typeof this.env.indexedDB !== 'undefined';
  }

  detectWebGPU(): boolean {
    return typeof (this.env.navigator?.gpu ?? this.env.gpu) !== 'undefined';
  }

  detect(): BrowserCapabilities {
    const wasm = this.detectWASM();
    const webWorkers = this.detectWebWorkers();
    const indexedDB = this.detectIndexedDB();
    const webgpu = this.detectWebGPU();

    const missing: string[] = [];
    if (!wasm) missing.push('WebAssembly');
    if (!webWorkers) missing.push('Web Workers');
    if (!indexedDB) missing.push('IndexedDB');

    return {
      wasm,
      webWorkers,
      indexedDB,
      webgpu,
      supported: missing.length === 0,
      missing,
    };
  }
}
