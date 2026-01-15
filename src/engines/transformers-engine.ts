import { pipeline, env, RawImage } from '@xenova/transformers';
import type { IOCREngine } from '@/types/ocr-engine';
import { LineSegmenter, LineSegmenterOptions } from '@/utils/line-segmenter';

export type TransformersProgressCallback = (status: string, progress: number) => void;

type ImageInput =
  | ImageData
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | Blob
  | string;
type ImageToTextPipeline = (image: ImageInput) => Promise<Array<{ generated_text?: string; text?: string }>>;

export interface TransformersEngineOptions {
  onProgress?: TransformersProgressCallback;
  webgpu?: boolean;
  /** Enable multiline support via line segmentation. Default: true */
  multiline?: boolean;
  /** Options for line segmentation algorithm */
  lineSegmenterOptions?: LineSegmenterOptions;
}

export class TransformersEngine implements IOCREngine {
  public readonly id = 'transformers';
  public isLoading = false;
  private pipelineInstance: ImageToTextPipeline | null = null;
  private readonly onProgress?: TransformersProgressCallback;
  private readonly webgpuOverride?: boolean;
  private readonly multilineEnabled: boolean;
  private readonly lineSegmenter: LineSegmenter;

  constructor(options: TransformersEngineOptions = {}) {
    this.onProgress = options.onProgress;
    this.webgpuOverride = options.webgpu;
    this.multilineEnabled = options.multiline ?? true;
    this.lineSegmenter = new LineSegmenter(options.lineSegmenterOptions);
  }

  async load(): Promise<void> {
    if (this.pipelineInstance) {
      return;
    }

    this.isLoading = true;
    try {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.localModelPath = '/transformers-models/';
      env.useBrowserCache = true;
      const device = this.isWebGPUSupported() ? 'webgpu' : 'cpu';
      this.pipelineInstance = (await pipeline('image-to-text', 'Xenova/trocr-base-printed', {
        device,
        progress_callback: (status) => {
          if (this.onProgress) {
            this.onProgress(status.status ?? 'loading', status.progress ?? 0);
          }
        },
      })) as ImageToTextPipeline;
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.pipelineInstance) {
      throw new Error('Transformers engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    // Check if multiline processing should be used
    if (this.multilineEnabled && this.lineSegmenter.isMultiline(data)) {
      return this.processMultiline(data);
    }

    return this.processSingleLine(data);
  }

  /**
   * Processes a single line of text.
   */
  private async processSingleLine(data: ImageData): Promise<string> {
    const rawImage = new RawImage(data.data, data.width, data.height, 4).rgb();
    const results = await this.pipelineInstance!(rawImage);
    const first = results[0];
    return (first?.generated_text ?? first?.text ?? '').trim();
  }

  /**
   * Processes multiline text by segmenting into individual lines.
   */
  private async processMultiline(data: ImageData): Promise<string> {
    const lineImages = this.lineSegmenter.extractLines(data);
    const lineTexts: string[] = [];

    for (const lineImage of lineImages) {
      const text = await this.processSingleLine(lineImage);
      if (text) {
        lineTexts.push(text);
      }
    }

    return lineTexts.join('\n');
  }

  async destroy(): Promise<void> {
    const pipelineInstance = this.pipelineInstance as unknown as { dispose?: () => void };
    if (pipelineInstance?.dispose) {
      pipelineInstance.dispose();
    }
    this.pipelineInstance = null;
  }

  private isWebGPUSupported(): boolean {
    if (typeof this.webgpuOverride !== 'undefined') {
      return this.webgpuOverride;
    }
    return typeof navigator !== 'undefined' && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  }

  private async imageDataToBlob(imageData: ImageData): Promise<Blob> {
    const { width, height } = imageData;
    const canvas = this.createCanvas(width, height);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    context.putImageData(imageData, 0, 0);

    if ('convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    }

    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode image for OCR.'));
        }
      }, 'image/png');
    });
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }

    throw new Error('Canvas creation is not available in this environment.');
  }
}
