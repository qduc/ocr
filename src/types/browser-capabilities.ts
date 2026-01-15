export interface BrowserCapabilities {
  wasm: boolean;
  webWorkers: boolean;
  indexedDB: boolean;
  webgpu: boolean;
  supported: boolean;
  missing: string[];
}
