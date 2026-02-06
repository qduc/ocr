import { pipeline, env, RawImage } from '@xenova/transformers';
import * as ort from 'onnxruntime-web';
import type { IOCREngine, OCRResult, OCRItem } from '@/types/ocr-engine';
import {
  fetchModel,
  getDefaultModelBaseUrl,
  loadDetectorModel,
  loadImage,
} from '@qduc/easyocr-web';
import {
  detectorPreprocess,
  tensorToHeatmap,
  detectorPostprocess,
  groupBoxesByLine,
  resolveOcrOptions,
} from '@qduc/easyocr-core';
import type { DetectorModel, Box } from '@qduc/easyocr-core';
import { ModelCache } from '@/utils/model-cache';
import { ImageProcessor } from '@/utils/image-processor';

export type TransformersProgressCallback = (status: string, progress: number) => void;

type ImageInput =
  | ImageData
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | Blob
  | string
  | RawImage;
type ImageToTextPipeline = (image: ImageInput) => Promise<Array<{ generated_text?: string; text?: string }>>;
type PipelineOptions = Parameters<typeof pipeline>[2] & { device?: string };

export interface TransformersEngineOptions {
  onProgress?: TransformersProgressCallback;
  webgpu?: boolean;
  modelBaseUrl?: string;
}

export class TransformersEngine implements IOCREngine {
  public readonly id = 'transformers';
  public isLoading = false;
  private pipelineInstance: ImageToTextPipeline | null = null;
  private detector: DetectorModel | null = null;
  private readonly onProgress?: TransformersProgressCallback;
  private readonly webgpuOverride?: boolean;
  private readonly easyOcrModelBaseUrl: string;
  private readonly imageProcessor: ImageProcessor;

  private static detectorCache = new ModelCache({
    dbName: 'ocr-model-cache',
    storeName: 'easyocr-files',
  });

  constructor(options: TransformersEngineOptions = {}) {
    this.onProgress = options.onProgress;
    this.webgpuOverride = options.webgpu;
    this.imageProcessor = new ImageProcessor();

    const base = options.modelBaseUrl ?? getDefaultModelBaseUrl({ ref: 'main' });
    const normalizedBase = base.replace(/\/onnx\/?$/, '/');
    this.easyOcrModelBaseUrl = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  }

  async load(): Promise<void> {
    if (this.pipelineInstance && this.detector) {
      return;
    }

    this.isLoading = true;
    try {
      // Ensure onnxruntime-web WASM paths are configured before any engines (EasyOCR or Transformers)
      // attempt to initialize a session, avoiding 404/MIME errors.
      const envWithOnnx = env as unknown as {
        backends: {
          onnx: {
            wasm: {
              wasmPaths?: string;
            };
          };
        };
      };

      if (!envWithOnnx.backends.onnx.wasm.wasmPaths) {
        const baseUrl = import.meta.env.BASE_URL;
        envWithOnnx.backends.onnx.wasm.wasmPaths = baseUrl + 'onnxruntime-web/';
      }

      // Also set global onnxruntime-web env for the detector (EasyOCR)
      if (!ort.env.wasm.wasmPaths) {
        const baseUrl = import.meta.env.BASE_URL;
        ort.env.wasm.wasmPaths = baseUrl + 'onnxruntime-web/';
      }

      this.reportProgress('Downloading detection model', 0);
      const detectorBuffer = await this.fetchDetectorModelBuffer(
        `${this.easyOcrModelBaseUrl}onnx/craft_mlt_25k.onnx`
      );
      this.reportProgress('Downloading detection model', 0.2);

      this.reportProgress('Initializing Detector', 0.2);
      this.detector = await loadDetectorModel(detectorBuffer);
      this.reportProgress('Detector Ready', 0.3);

      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.localModelPath = import.meta.env.BASE_URL + 'transformers-models/';
      env.useBrowserCache = true;

      this.reportProgress('Downloading TrOCR model', 0.3);
      const device = this.isWebGPUSupported() ? 'webgpu' : 'cpu';
      const pipelineOptions: PipelineOptions = {
        device,
        progress_callback: (status: { status: string; progress?: number }) => {
          if (this.onProgress) {
            // Scale TrOCR progress to 0.3 - 1.0 range
            const scaledProgress = 0.3 + (status.progress ?? 0) * 0.7;
            this.reportProgress(status.status, scaledProgress);
          }
        },
      };
      this.pipelineInstance = (await pipeline(
        'image-to-text',
        'Xenova/trocr-small-printed',
        pipelineOptions
      )) as ImageToTextPipeline;
      this.reportProgress('Ready', 1);
    } finally {
      this.isLoading = false;
    }
  }

  private async fetchDetectorModelBuffer(url: string): Promise<Uint8Array> {
    const buffer = await TransformersEngine.detectorCache.loadOrFetch(url, async () => {
      const data = await fetchModel(url);
      return data.buffer;
    });
    return new Uint8Array(buffer);
  }

  private reportProgress(status: string, progress: number): void {
    if (this.onProgress) {
      this.onProgress(status, progress);
    }
  }

  async process(data: ImageData): Promise<OCRResult> {
    if (!this.pipelineInstance || !this.detector) {
      throw new Error('Transformers engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    // 1. Preprocess inside engine
    const processed = this.imageProcessor.preprocess(data);

    // 2. Detect text regions using CRAFT
    const boxes = await this.detectRegions(processed);

    // 3. Merge boxes into line-level regions
    const lines = this.groupRegionsIntoLines(boxes);

    if (lines.length === 0) {
      return { text: '', items: [] };
    }

    // 4. Run TrOCR on each line crop
    const items: OCRItem[] = [];
    for (const line of lines) {
      try {
        const crop = await this.cropImageData(processed, line);
        const rawImage = new RawImage(crop.data, crop.width, crop.height, 4).rgb();
        const results = await this.pipelineInstance(rawImage);
        const first = results[0];
        const text = (first?.generated_text ?? first?.text ?? '').trim();

        if (text) {
          items.push({
            text,
            confidence: 0.8,
            boundingBox: line,
            quad: [
              [line.x, line.y],
              [line.x + line.width, line.y],
              [line.x + line.width, line.y + line.height],
              [line.x, line.y + line.height],
            ],
          });
        }
      } catch (err) {
        console.error('Failed to process line crop:', err);
        // Continue with other lines
      }
    }

    return {
      text: items.map((i) => i.text).join('\n'),
      items,
    };
  }

  async destroy(): Promise<void> {
    const pipelineInstance = this.pipelineInstance as unknown as { dispose?: () => Promise<void> | void };
    if (pipelineInstance?.dispose) {
      await Promise.resolve(pipelineInstance.dispose());
    }
    this.pipelineInstance = null;
    this.detector = null;
  }

  private async detectRegions(imageData: ImageData): Promise<Box[]> {
    if (!this.detector) {
      throw new Error('Detector not loaded');
    }

    const image = await loadImage(imageData);
    const options = resolveOcrOptions({});
    const prep = detectorPreprocess(image, options);

    const outputs = await this.detector.session.run({
      [this.detector.inputName]: prep.input,
    });

    const textTensor = outputs[this.detector.textOutputName];
    const linkTensor = outputs[this.detector.linkOutputName];

    if (!textTensor || !linkTensor) {
      throw new Error('Missing detector outputs');
    }

    const textMap = tensorToHeatmap(textTensor);
    const linkMap = tensorToHeatmap(linkTensor);

    const scaleX = prep.scaleX / 2;
    const scaleY = prep.scaleY / 2;

    const { horizontalList, freeList } = detectorPostprocess(
      textMap,
      linkMap,
      options,
      scaleX,
      scaleY
    );
    return [...horizontalList, ...freeList];
  }

  private groupRegionsIntoLines(boxes: Box[]): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    if (boxes.length === 0) return [];

    const options = resolveOcrOptions({ mergeLines: true });
    const lineGroups = groupBoxesByLine(boxes, options);

    return lineGroups.map((group) => {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const box of group.boxes) {
        for (const [x, y] of box) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    });
  }

  private async cropImageData(
    imageData: ImageData,
    box: { x: number; y: number; width: number; height: number }
  ): Promise<ImageData> {
    const sx = Math.max(0, Math.floor(box.x));
    const sy = Math.max(0, Math.floor(box.y));
    const sw = Math.min(imageData.width - sx, Math.ceil(box.width));
    const sh = Math.min(imageData.height - sy, Math.ceil(box.height));

    if (sw <= 0 || sh <= 0) {
      return new ImageData(sw || 1, sh || 1);
    }

    const bitmap = await createImageBitmap(imageData, sx, sy, sw, sh);
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context for cropping');

    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, sw, sh);
  }

  private isWebGPUSupported(): boolean {
    if (typeof this.webgpuOverride !== 'undefined') {
      return this.webgpuOverride;
    }
    return typeof navigator !== 'undefined' && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  }

  // Note: additional canvas helpers removed to keep the engine lean and avoid unused code.
}
