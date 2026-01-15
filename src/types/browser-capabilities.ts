export interface BrowserCapabilities {
  wasm: boolean;
  webWorkers: boolean;
  indexedDB: boolean;
  supported: boolean;
  missing: string[];
}
