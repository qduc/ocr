import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FeatureDetector, type FeatureDetectorEnv } from '../src/utils/feature-detector';

describe('FeatureDetector property tests', () => {
  it('detect should reflect environment capabilities', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (wasmAvailable, workersAvailable, indexedDBAvailable, webgpuAvailable) => {
          const env: FeatureDetectorEnv = {
            WebAssembly: wasmAvailable ? {} : undefined,
            Worker: workersAvailable ? function WorkerStub() {} : undefined,
            indexedDB: indexedDBAvailable ? {} : undefined,
            navigator: webgpuAvailable ? { gpu: {} } : {},
          };

          const detector = new FeatureDetector(env);
          const capabilities = detector.detect();

          expect(capabilities.wasm).toBe(wasmAvailable);
          expect(capabilities.webWorkers).toBe(workersAvailable);
          expect(capabilities.indexedDB).toBe(indexedDBAvailable);
          expect(capabilities.webgpu).toBe(webgpuAvailable);

          const expectedMissing: string[] = [];
          if (!wasmAvailable) expectedMissing.push('WebAssembly');
          if (!workersAvailable) expectedMissing.push('Web Workers');
          if (!indexedDBAvailable) expectedMissing.push('IndexedDB');

          expect(capabilities.missing).toEqual(expectedMissing);
          expect(capabilities.supported).toBe(expectedMissing.length === 0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('detectWebGPU reflects navigator.gpu availability', () => {
    fc.assert(
      fc.property(fc.boolean(), (webgpuAvailable) => {
        const env: FeatureDetectorEnv = {
          navigator: webgpuAvailable ? { gpu: {} } : {},
        };
        const detector = new FeatureDetector(env);
        expect(detector.detectWebGPU()).toBe(webgpuAvailable);
      }),
      { numRuns: 50 }
    );
  });
});

describe('FeatureDetector unit tests', () => {
  it('detectWASM returns true when WebAssembly is available', () => {
    const detector = new FeatureDetector({ WebAssembly: {} });
    expect(detector.detectWASM()).toBe(true);
  });

  it('detectWASM returns false when WebAssembly is unavailable', () => {
    const detector = new FeatureDetector({ WebAssembly: undefined });
    expect(detector.detectWASM()).toBe(false);
  });

  it('detectWebWorkers returns true when Worker is available', () => {
    const detector = new FeatureDetector({ Worker: function WorkerStub() {} });
    expect(detector.detectWebWorkers()).toBe(true);
  });

  it('detectWebWorkers returns false when Worker is unavailable', () => {
    const detector = new FeatureDetector({ Worker: undefined });
    expect(detector.detectWebWorkers()).toBe(false);
  });

  it('detectIndexedDB returns true when indexedDB is available', () => {
    const detector = new FeatureDetector({ indexedDB: {} });
    expect(detector.detectIndexedDB()).toBe(true);
  });

  it('detectIndexedDB returns false when indexedDB is unavailable', () => {
    const detector = new FeatureDetector({ indexedDB: undefined });
    expect(detector.detectIndexedDB()).toBe(false);
  });

  it('detectWebGPU returns true when navigator.gpu is available', () => {
    const detector = new FeatureDetector({ navigator: { gpu: {} } });
    expect(detector.detectWebGPU()).toBe(true);
  });

  it('detectWebGPU returns false when navigator.gpu is unavailable', () => {
    const detector = new FeatureDetector({ navigator: {} });
    expect(detector.detectWebGPU()).toBe(false);
  });

  it('detect reports missing features when unsupported', () => {
    const detector = new FeatureDetector({
      WebAssembly: undefined,
      Worker: undefined,
      indexedDB: undefined,
    });

    const capabilities = detector.detect();
    expect(capabilities.supported).toBe(false);
    expect(capabilities.missing).toEqual([
      'WebAssembly',
      'Web Workers',
      'IndexedDB',
    ]);
  });
});
