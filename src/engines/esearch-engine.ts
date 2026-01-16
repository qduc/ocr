import * as ort from 'onnxruntime-web';
// @ts-expect-error esearch-ocr lacks proper TypeScript exports in package.json
import * as ocrImport from 'esearch-ocr';
import type { IOCREngine } from '@/types/ocr-engine';
import type {
  ESearchOCRInstance,
  ESearchModelPaths,
  ESearchOCROutput,
  ESearchInitOptions,
} from '@/types/esearch-types';
import { extractTextFromESearchOutput } from '@/types/esearch-types';
import { getHuggingFaceModelUrls } from '@/utils/language-config';

/**
 * Type-safe wrapper for esearch-ocr init function.
 */
type ESearchOCRModule = {
  init: (options: ESearchInitOptions) => Promise<ESearchOCRInstance>;
};

const initOCR = (ocrImport as unknown as ESearchOCRModule).init;

/**
 * Progress callback for eSearch-OCR engine operations.
 * @param status Current operation status description
 * @param progress Progress value between 0 and 1
 */
export type ESearchProgressCallback = (status: string, progress: number) => void;

/**
 * Configuration options for the eSearch-OCR engine.
 */
export interface ESearchEngineOptions {
  /** Progress callback for model loading and processing */
  onProgress?: ESearchProgressCallback;

  /**
   * Model file URLs or paths.
   * If language is provided, these will be used as fallbacks or overrides.
   */
  modelPaths?: ESearchModelPaths;

  /**
   * Optimize English space recognition.
   * Set to false for v5 models to avoid extra spaces.
   * @default true
   */
  optimizeSpace?: boolean;

  /**
   * Language code to fetch from Hugging Face.
   * Overrides modelPaths if provided.
   */
  language?: string;
}

/**
 * eSearch-OCR engine implementation using PaddleOCR models via ONNX Runtime.
 *
 * This engine provides high-quality OCR for Chinese-English mixed text
 * using the esearch-ocr library with PaddleOCR models converted to ONNX format.
 *
 * @example
 * ```typescript
 * const engine = new ESearchEngine({
 *   language: 'english',
 *   onProgress: (status, progress) => console.log(status, progress),
 * });
 *
 * await engine.load();
 * const text = await engine.process(imageData);
 * await engine.destroy();
 * ```
 */
export class ESearchEngine implements IOCREngine {
  public readonly id = 'esearch';
  public isLoading = false;

  private ocrInstance: ESearchOCRInstance | null = null;
  private readonly onProgress?: ESearchProgressCallback;
  private readonly modelPaths: ESearchModelPaths;
  private readonly optimizeSpace: boolean;

  /**
   * Creates a new eSearch-OCR engine instance.
   * @param options Configuration options including model paths and callbacks
   */
  constructor(options: ESearchEngineOptions) {
    this.onProgress = options.onProgress;

    if (options.language) {
      this.modelPaths = getHuggingFaceModelUrls(options.language);
    } else if (options.modelPaths) {
      this.modelPaths = options.modelPaths;
    } else {
      // Default to English from Hugging Face if nothing else specified
      this.modelPaths = getHuggingFaceModelUrls('english');
    }

    this.optimizeSpace = options.optimizeSpace ?? true;
  }

  /**
   * Loads the OCR models and initializes the engine.
   * Downloads model files from the configured URLs and creates ONNX sessions.
   * @throws Error if model loading fails or dependencies are unavailable
   */
  async load(): Promise<void> {
    if (this.ocrInstance) {
      return;
    }

    this.isLoading = true;
    try {
      this.reportProgress('Downloading detection model', 0);
      const detBuffer = await this.fetchModelAsArrayBuffer(this.modelPaths.det);
      this.reportProgress('Downloading detection model', 0.33);

      this.reportProgress('Downloading recognition model', 0.33);
      const recBuffer = await this.fetchModelAsArrayBuffer(this.modelPaths.rec);
      this.reportProgress('Downloading recognition model', 0.66);

      this.reportProgress('Downloading dictionary', 0.66);
      const dictText = await this.fetchTextFile(this.modelPaths.dict);
      this.reportProgress('Downloading dictionary', 0.8);

      this.configureOnnxRuntime();
      this.reportProgress('Initializing OCR engine', 0.8);
      this.ocrInstance = await initOCR({
        ort,
        det: {
          input: detBuffer,
        },
        rec: {
          input: recBuffer,
          decodeDic: dictText,
          optimize: {
            space: this.optimizeSpace,
          },
          on: (index: number, _result: unknown, total: number) => {
            const progress = 0.8 + (index / total) * 0.2;
            this.reportProgress(`Recognizing text ${index + 1}/${total}`, progress);
          },
        },
      });

      this.reportProgress('Ready', 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load eSearch-OCR engine: ${message}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Configure onnxruntime-web to fetch its WASM artifacts from a stable URL.
   *
   * Vite's `/node_modules/.vite/deps/` output is not a stable/public asset location.
   * Managed by `vite-plugin-static-copy` in `vite.config.ts`,
   * ORT can reliably fetch them from `/onnxruntime-web/` in both dev and production builds.
   */
  private configureOnnxRuntime(): void {
    // Only set this if the app hasn't already configured a custom path.
    if (!ort.env.wasm.wasmPaths) {
      // Use an absolute URL to prevent Vite from trying to process these files as modules.
      // Vite warns when "importing" files from /public in dev mode.
      // Use self.location.origin to work in both main thread and workers.
      const baseUrl = (typeof self !== 'undefined' ? self.location.origin : window.location.origin) + '/onnxruntime-web/';
      ort.env.wasm.wasmPaths = baseUrl;
    }
  }

  /**
   * Processes an image and extracts text using OCR.
   * @param data The ImageData to process
   * @returns Extracted text as a plain string
   * @throws Error if the engine is not loaded or processing fails
   */
  async process(data: ImageData): Promise<string> {
    if (!this.ocrInstance) {
      throw new Error('eSearch-OCR engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    try {
      const result: ESearchOCROutput = await this.ocrInstance.ocr(data);
      return extractTextFromESearchOutput(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`eSearch-OCR processing failed: ${message}`);
    }
  }

  /**
   * Releases all resources held by the engine.
   * Cleans up ONNX sessions and frees memory.
   */
  async destroy(): Promise<void> {
    // The esearch-ocr library doesn't expose a dispose method,
    // but we can release the reference to allow garbage collection
    await Promise.resolve();
    this.ocrInstance = null;
  }

  /**
   * Reports progress to the callback if configured.
   * @param status Current operation status
   * @param progress Progress value between 0 and 1
   */
  private reportProgress(status: string, progress: number): void {
    if (this.onProgress) {
      this.onProgress(status, progress);
    }
  }

  /**
   * Fetches a model file and returns it as an ArrayBuffer.
   * @param url URL or path to the model file
   * @returns ArrayBuffer containing the model data
   * @throws Error if fetch fails
   */
  private async fetchModelAsArrayBuffer(url: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch model from ${url}: ${message}`);
    }
  }

  /**
   * Fetches a text file (e.g., dictionary) and returns its content.
   * @param url URL or path to the text file
   * @returns Text content of the file
   * @throws Error if fetch fails
   */
  private async fetchTextFile(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch dictionary from ${url}: ${message}`);
    }
  }
}
