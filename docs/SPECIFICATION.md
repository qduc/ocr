# Technical Specification: Multi-Engine Browser OCR

**Version**: 1.1
**Last Updated**: 2026-01-15
**Status**: Ready for Implementation

## 1. Architectural Overview

The system uses a **Strategy Pattern** managed by a **Factory Service**. This decouples the User Interface from the specific implementation details of different OCR libraries.

### Core Design Principles

- **Lazy Loading:** Libraries and models are only downloaded when the specific engine is selected.
- **Resource Isolation:** Each engine runs in a dedicated **Web Worker** to keep the UI responsive.
- **Memory Hygiene:** A strict lifecycle ensures that when an engine is swapped, the previous engine's memory (WASM heap or GPU tensors) is explicitly cleared.

### Implementation Scope

**MVP (Phase 1)**:

- Single engine: Tesseract.js v5.x
- Desktop browsers only (Chrome 90+, Firefox 88+, Safari 15+)
- ImageData input, plain string output
- IndexedDB model caching

**Post-MVP (Phase 2)**:

- Second engine: Transformers.js with TrOCR model
- Validates Strategy Pattern with multi-engine architecture
- Adds WebGPU acceleration capability

---

## 2. The Implementation Stack

| Layer            | Technology              | Purpose                                               |
| ---------------- | ----------------------- | ----------------------------------------------------- |
| **Orchestrator** | TypeScript / JavaScript | Manages engine switching and state.                   |
| **Processing**   | WebAssembly (WASM)      | Executes C++/Rust OCR logic at native speed.          |
| **Acceleration** | WebGPU / ONNX Runtime   | Uses the user's GPU for transformer-based models.     |
| **Storage**      | IndexedDB / OPFS        | Caches heavy model files (10MB+) for instant reloads. |

---

## 3. Class Structure & Logic

### A. The Engine Interface

This "Contract" ensures that regardless of the library used, the application interacts with them in the exact same way.

```typescript
/** Standard interface for all OCR drivers */
interface IOCREngine {
  id: string; // Unique identifier (e.g., "tesseract", "transformers")
  isLoading: boolean; // Current loading state for UI feedback
  load(): Promise<void>; // Setup: download assets & init worker
  process(data: ImageData): Promise<string>; // Execution: the actual OCR task
  destroy(): Promise<void>; // Cleanup: kill workers & clear RAM
}
```

**Data Contracts** (MVP):

- **Input**: `ImageData` objects only. The UI layer handles file upload → canvas conversion.
- **Output**: Plain `string` containing extracted text. Post-MVP can extend to structured format:
  ```typescript
  interface OCRResult {
    text: string;
    confidence?: number; // 0-100 quality score
    language?: string; // ISO 639-1 code (e.g., 'en')
  }
  ```

### B. The Factory Manager

The Manager handles the "One at a Time" constraint. It ensures that `Engine A` is fully disposed of before `Engine B` starts.

**MVP Implementation** (single engine):

```typescript
class OCRManager {
  private activeEngine: IOCREngine | null = null;

  async setEngine(engineType: 'tesseract') {
    // 1. Cleanup existing engine to prevent memory leaks
    if (this.activeEngine) {
      console.log(`Disposing ${this.activeEngine.id}...`);
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }

    // 2. Dynamic Import (Lazy Loading)
    const { TesseractEngine } = await import('./engines/tesseract.engine.js');

    // 3. Initialize new engine
    this.activeEngine = new TesseractEngine();
    await this.activeEngine.load();
  }

  async run(image: ImageData): Promise<string> {
    if (!this.activeEngine) throw new Error('Engine not initialized.');
    return await this.activeEngine.process(image);
  }

  getLoadingState(): boolean {
    return this.activeEngine?.isLoading ?? false;
  }
}
```

**Post-MVP Implementation** (multi-engine):

```typescript
class OCRManager {
  private activeEngine: IOCREngine | null = null;

  async setEngine(engineType: 'tesseract' | 'transformers') {
    // 1. Cleanup existing engine to prevent memory leaks
    if (this.activeEngine) {
      console.log(`Disposing ${this.activeEngine.id}...`);
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }

    // 2. Dynamic Import (Lazy Loading)
    let EngineClass;
    switch (engineType) {
      case 'tesseract':
        const tesseract = await import('./engines/tesseract.engine.js');
        EngineClass = tesseract.TesseractEngine;
        break;
      case 'transformers':
        const transformers = await import('./engines/transformers.engine.js');
        EngineClass = transformers.TransformersEngine;
        break;
    }

    // 3. Initialize new engine
    this.activeEngine = new EngineClass();
    await this.activeEngine.load();
  }

  async run(image: ImageData): Promise<string> {
    if (!this.activeEngine) throw new Error('Select an engine first.');
    return await this.activeEngine.process(image);
  }

  getLoadingState(): boolean {
    return this.activeEngine?.isLoading ?? false;
  }
}
```

---

## 4. Operational Workflow

**MVP Workflow** (single engine):

1. **Initialization:** On page load, feature detection checks for WASM, Web Workers, and IndexedDB support.
2. **Engine Setup:** Manager initializes Tesseract.js engine via `setEngine('tesseract')`.
3. **Model Loading:** Tesseract.js downloads English traineddata (~4MB) from CDN.
4. **Caching:** Browser stores model in IndexedDB. Subsequent loads are instant (0ms network time).
5. **Image Processing:**
   - User uploads image file
   - UI converts to canvas, then extracts ImageData
   - Manager sends ImageData to Tesseract.js worker (zero-copy transfer)
   - Worker processes and returns plain text string
6. **Display:** UI shows extracted text to user.
7. **Cleanup:** On page unload, worker terminates automatically.

**Post-MVP Workflow** (multi-engine):

1. **Selection:** User selects engine from dropdown: "Fast (Tesseract)" or "High Accuracy (Transformers.js)".
2. **Engine Switch:** If switching engines:
   - Manager calls `destroy()` on current engine
   - Worker terminates, reclaiming 50MB–200MB of RAM
   - Manager dynamically imports new engine class
3. **Bootstrap:** New engine loads its models (WebGPU/WASM binaries).
4. **Caching:** IndexedDB caches models per-engine.
5. **Processing:** Same as MVP workflow.
6. **Cleanup:** When switching engines, proper cleanup prevents memory leaks.

---

## 5. Critical Warnings & Best Practices

> [!IMPORTANT]
> **WASM Memory Limits:** Browsers usually limit WASM memory to 2GB or 4GB. If you don't call `.destroy()` when switching engines, users on mobile devices or low-RAM laptops will experience "Out of Memory" crashes after 3–4 switches.

- **Pre-processing is King:** Most browser OCR engines perform significantly better if you convert the image to grayscale and increase contrast using a simple Canvas filter _before_ passing it to the engine.
- **Progress Indicators:** Because models can be large (20MB+), always implement a progress bar for the `load()` phase so the user knows the app is downloading data, not frozen.
- **WebGPU Fallback:** If using modern transformer models, always check `if (!navigator.gpu)` and fallback to a WASM-only engine if the user's hardware is older.

---

## 6. Concrete Engine Implementations

### A. Tesseract.js Engine (MVP)

**Installation:**

```bash
npm install tesseract.js
```

**Implementation:**

```typescript
// engines/tesseract.engine.ts
import Tesseract, { Worker } from 'tesseract.js';

export class TesseractEngine implements IOCREngine {
  public readonly id = 'tesseract';
  public isLoading = false;
  private worker: Worker | null = null;

  async load(): Promise<void> {
    this.isLoading = true;
    try {
      // Create worker with automatic caching
      this.worker = await Tesseract.createWorker('eng', 1, {
        cacheMethod: 'refresh', // Use IndexedDB cache
        cachePath: '.', // Default cache location
      });
      console.log('Tesseract.js engine loaded');
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.worker) {
      throw new Error('Tesseract engine not loaded. Call load() first.');
    }

    const result = await this.worker.recognize(data);
    return result.data.text;
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      console.log('Tesseract.js engine destroyed');
    }
  }
}
```

**Characteristics:**

- Bundle size: ~2MB core + ~4MB English model
- Performance: 2-5 seconds for typical document
- Browser support: All browsers with WASM (Chrome 90+, Firefox 88+, Safari 15+)
- Memory usage: ~50-100MB during processing

---

### B. Transformers.js Engine (Post-MVP)

**Installation:**

```bash
npm install @huggingface/transformers
```

**Implementation:**

```typescript
// engines/transformers.engine.ts
import { pipeline, ImageToTextPipeline } from '@huggingface/transformers';

export class TransformersEngine implements IOCREngine {
  public readonly id = 'transformers';
  public isLoading = false;
  private ocr: ImageToTextPipeline | null = null;

  async load(): Promise<void> {
    this.isLoading = true;
    try {
      // Load TrOCR model (quantized for browser)
      // Model automatically cached in IndexedDB
      this.ocr = await pipeline('image-to-text', 'Xenova/trocr-small-printed', {
        quantized: true, // Use quantized model for smaller size
      });
      console.log('Transformers.js engine loaded');
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.ocr) {
      throw new Error('Transformers engine not loaded. Call load() first.');
    }

    // Convert ImageData to format expected by Transformers.js
    const result = await this.ocr(data);
    return result[0].generated_text;
  }

  async destroy(): Promise<void> {
    // Transformers.js handles cleanup internally
    this.ocr = null;
    console.log('Transformers.js engine destroyed');
  }
}
```

**Characteristics:**

- Bundle size: Variable (model-dependent, typically 50-150MB quantized)
- Performance: 1-3 seconds with WebGPU, 5-10 seconds CPU fallback
- Browser support: WebGPU recommended (Chrome 113+, limited Safari/Firefox)
- Memory usage: ~200-500MB during processing
- Accuracy: Higher than Tesseract on printed text

**WebGPU Detection:**

```typescript
// Check before loading Transformers engine
if (!navigator.gpu) {
  console.warn('WebGPU not available. Transformers.js will use CPU (slower).');
  // Consider showing user a warning or defaulting to Tesseract.js
}
```

---

### C. EasyOCR.js Engine (Post-MVP)

**Installation:**

```bash
npm install @qduc/easyocr-core @qduc/easyocr-web onnxruntime-web
```

**Implementation:**

```typescript
// engines/easyocr-engine.ts
import { loadDetectorModel, loadRecognizerModel, recognize } from '@qduc/easyocr-web';

export class EasyOCREngine implements IOCREngine {
  public id = 'easyocr';
  // ... implementation details ...
}
```

**Characteristics:**

- Bundle size: ~110MB for detection + recognition models
- Performance: 2-5 seconds (WASM/WebGL)
- Browser support: Extensive (WASM + ONNX Runtime)
- Memory usage: ~300-600MB during processing
- Accuracy: Very high for multilingual text

---

## 7. Feature Detection & Browser Support

**Required Features Check:**

```typescript
// utils/feature-detection.ts
export function checkBrowserSupport(): { supported: boolean; missing: string[] } {
  const missing: string[] = [];

  if (typeof WebAssembly === 'undefined') {
    missing.push('WebAssembly');
  }

  if (typeof Worker === 'undefined') {
    missing.push('Web Workers');
  }

  if (typeof indexedDB === 'undefined') {
    missing.push('IndexedDB');
  }

  return {
    supported: missing.length === 0,
    missing,
  };
}

// In app initialization:
const { supported, missing } = checkBrowserSupport();
if (!supported) {
  throw new Error(
    `Browser not supported. Missing: ${missing.join(', ')}. ` +
      `Please use Chrome 90+, Firefox 88+, or Safari 15+.`
  );
}
```

**Minimum Browser Versions:**

| Browser     | Version  | WASM | Workers | IndexedDB | WebGPU         |
| ----------- | -------- | ---- | ------- | --------- | -------------- |
| Chrome/Edge | 90+      | ✅   | ✅      | ✅        | 113+           |
| Firefox     | 88+      | ✅   | ✅      | ✅        | 141+ (limited) |
| Safari      | 15+      | ✅   | ✅      | ✅        | 26+ (limited)  |
| Mobile      | Post-MVP | -    | -       | -         | -              |

---

## 8. Implementation Checklist

**MVP (Tesseract.js only):**

- [ ] Install dependencies: `npm install tesseract.js`
- [ ] Create `IOCREngine` interface
- [ ] Implement `TesseractEngine` class
- [ ] Implement `OCRManager` class
- [ ] Add feature detection
- [ ] Build UI: file upload → canvas → ImageData conversion
- [ ] Add loading state UI (spinner)
- [ ] Test on Chrome, Firefox, Safari (desktop)
- [ ] Verify IndexedDB caching works
- [ ] Verify worker cleanup on page unload

**Post-MVP (Add Transformers.js and EasyOCR.js):**

- [ ] Install dependencies: `@huggingface/transformers`, `@qduc/easyocr-web`
- [ ] Implement `TransformersEngine` class
- [ ] Implement `EasyOCREngine` class
- [ ] Add WebGPU feature detection
- [ ] Update `OCRManager` to support multiple engines
- [ ] Add engine selection UI (dropdown)
- [ ] Test engine switching (memory cleanup)
- [ ] Performance comparison (Tesseract vs Transformers vs EasyOCR)
- [ ] Document WebGPU browser support limitations

---

## 9. Translation System (Bergamot Integration)

The translation system uses the **Bergamot** engine, which is a WASM-based port of the Marian NMT framework, as used in Firefox Translations.

### Architecture

- **Translator Service**: Wrapped in `ITextTranslator` interface.
- **Worker-based**: Runs in a separate worker to avoid blocking the main thread.
- **Memory Isolation**: Requires `SharedArrayBuffer`, which mandates `crossOriginIsolated` headers (handled by `coi-serviceworker.js`).
- **Model Management**: Models are downloaded from Mozilla's storage and cached in IndexedDB.

### Components

- `src/translation/bergamot-translator.ts`: Core translation logic.
- `src/translation-controller.ts`: Manages the translation UI, language selection, and result display.
- `src/utils/image-writeback.ts`: Renders translated text back onto the image, matching original positions.
- `src/utils/paragraph-grouping.ts`: Groups individual OCR items into semantic paragraphs for better translation quality.

### Language Registry

The language registry is generated via `scripts/generate-bergamot-registry.mjs`, which fetches the latest model list from Mozilla and prepares it for the browser.
