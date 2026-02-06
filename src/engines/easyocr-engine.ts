import type { IOCREngine, OCRResult } from '@/types/ocr-engine';
import * as ort from 'onnxruntime-web';
import type {
  DetectorModel,
  RecognizerModel,
  OcrResult as EasyOcrResult,
} from '@qduc/easyocr-core';
import { resolveModelForLanguage } from '@qduc/easyocr-core';
import {
  fetchModel,
  getDefaultModelBaseUrl,
  loadDetectorModel,
  loadImage,
  loadRecognizerModel,
  recognize,
} from '@qduc/easyocr-web';
import { ModelCache } from '@/utils/model-cache';

export type EasyOCRProgressCallback = (status: string, progress: number) => void;

export interface EasyOCREngineOptions {
  language?: string;
  onProgress?: EasyOCRProgressCallback;
  modelBaseUrl?: string;
  // Optional runtime hints accepted by callers; ignored by engine if unused
  webgpu?: boolean;
  debug?: boolean;
  debugMode?: string;
}

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_MODEL_REF = 'main';
const DEFAULT_CHARSET_BASE = 'https://raw.githubusercontent.com/qduc/easyocr.js/main/models/';

export class EasyOCREngine implements IOCREngine {
  public readonly id = 'easyocr';
  public isLoading = false;

  private detector: DetectorModel | null = null;
  private recognizer: RecognizerModel | null = null;
  private readonly language: string;
  private readonly onProgress?: EasyOCRProgressCallback;
  private readonly modelBaseUrl: string;
  private readonly charsetBaseUrl: string;

  private static cache = new ModelCache({ dbName: 'ocr-model-cache', storeName: 'easyocr-files' });
  private static charsetCache = new ModelCache({
    dbName: 'ocr-model-cache',
    storeName: 'easyocr-files',
  });

  constructor(options: EasyOCREngineOptions = {}) {
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.onProgress = options.onProgress;
    const base = options.modelBaseUrl ?? getDefaultModelBaseUrl({ ref: DEFAULT_MODEL_REF });
    const normalizedBase = base.replace(/\/onnx\/?$/, '/');
    this.modelBaseUrl = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
    this.charsetBaseUrl = DEFAULT_CHARSET_BASE;
  }

  async load(): Promise<void> {
    if (this.detector && this.recognizer) {
      return;
    }

    this.isLoading = true;
    try {
      this.configureOnnxRuntime();
      this.reportProgress('Downloading detection model', 0);
      const detectorBuffer = await this.fetchModelBuffer(
        `${this.modelBaseUrl}onnx/craft_mlt_25k.onnx`
      );
      this.reportProgress('Downloading detection model', 0.25);

      const languageConfig = this.getLanguageConfig(this.language);
      this.reportProgress('Downloading recognition model', 0.25);
      const recognizerModel = languageConfig.model.endsWith('.onnx')
        ? languageConfig.model
        : `${languageConfig.model}.onnx`;
      const recognizerBuffer = await this.fetchModelBuffer(
        `${this.modelBaseUrl}onnx/${recognizerModel}`
      );
      this.reportProgress('Downloading recognition model', 0.6);

      this.reportProgress('Downloading charset', 0.6);
      const charsetUrl = `${this.charsetBaseUrl}${languageConfig.charset}`;
      const charsetText = await this.loadCharsetWithCache(charsetUrl);
      this.reportProgress('Downloading charset', 0.8);

      this.reportProgress('Initializing EasyOCR', 0.8);
      this.detector = await loadDetectorModel(detectorBuffer);
      this.recognizer = await loadRecognizerModel(recognizerBuffer, {
        charset: charsetText,
        textInputName: languageConfig.textInputName,
      });
      this.reportProgress('Ready', 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load EasyOCR engine: ${message}`);
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<OCRResult> {
    if (!this.detector || !this.recognizer) {
      throw new Error('EasyOCR engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    try {
      const image = await loadImage(data);
      const results = await recognize({
        image,
        detector: this.detector,
        recognizer: this.recognizer,
      });
      return {
        text: results.map((item) => item.text).join('\n'),
        items: results.map(mapEasyOcrResultItem),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`EasyOCR processing failed: ${message}`);
    }
  }

  async destroy(): Promise<void> {
    await Promise.resolve();
    this.detector = null;
    this.recognizer = null;
  }

  private getLanguageConfig(language: string): {
    model: string;
    charset: string;
    textInputName?: string;
  } {
    return resolveModelForLanguage(language);
  }

  private reportProgress(status: string, progress: number): void {
    if (this.onProgress) {
      this.onProgress(status, progress);
    }
  }

  private configureOnnxRuntime(): void {
    if (!ort.env.wasm.wasmPaths) {
      const baseUrl = import.meta.env.BASE_URL;
      ort.env.wasm.wasmPaths = baseUrl + 'onnxruntime-web/';
    }
  }

  private async fetchModelBuffer(url: string): Promise<ArrayBuffer> {
    try {
      return await EasyOCREngine.cache.loadOrFetch(url, async () => {
        const data = await fetchModel(url);
        return data.buffer;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch model from ${url}: ${message}`);
    }
  }

  private async loadCharsetWithCache(url: string): Promise<string> {
    const buffer = await EasyOCREngine.charsetCache.loadOrFetch(url, async () => {
      const data = await fetchModel(url);
      return data.buffer;
    });
    return new TextDecoder().decode(buffer);
  }
}

const mapEasyOcrResultItem = (item: EasyOcrResult): NonNullable<OCRResult['items']>[number] => {
  const xs = item.box.map((point) => point[0]);
  const ys = item.box.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    text: item.text,
    confidence: item.confidence,
    quad: [
      [item.box[0][0], item.box[0][1]],
      [item.box[1][0], item.box[1][1]],
      [item.box[2][0], item.box[2][1]],
      [item.box[3][0], item.box[3][1]],
    ],
    angle:
      (Math.atan2(item.box[1][1] - item.box[0][1], item.box[1][0] - item.box[0][0]) * 180) /
      Math.PI,
    boundingBox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
};
