import { pipeline, env, RawImage } from '@xenova/transformers';
import type { IOCREngine, OCRResult } from '@/types/ocr-engine';

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
}

export class TransformersEngine implements IOCREngine {
  public readonly id = 'transformers';
  public isLoading = false;
  private pipelineInstance: ImageToTextPipeline | null = null;
  private readonly onProgress?: TransformersProgressCallback;
  private readonly webgpuOverride?: boolean;

  constructor(options: TransformersEngineOptions = {}) {
    this.onProgress = options.onProgress;
    this.webgpuOverride = options.webgpu;
  }

  async load(): Promise<void> {
    if (this.pipelineInstance) {
      return;
    }

    this.isLoading = true;
    try {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.localModelPath = import.meta.env.BASE_URL + 'transformers-models/';
      env.useBrowserCache = true;

      // If Transformers is using the onnxruntime-web WASM backend, ensure it fetches
      // runtime artifacts from a stable public URL (Vite doesn't guarantee `/node_modules/.vite/deps/`).
      const envWithOnnx = env as unknown as {
        backends?: {
          onnx?: {
            wasm?: {
              wasmPaths?: string;
            };
          };
        };
      };
      if (envWithOnnx.backends?.onnx?.wasm && !envWithOnnx.backends.onnx.wasm.wasmPaths) {
        // Use the base URL from Vite to ensure it works in subdirectories (like GitHub Pages).
        // import.meta.env.BASE_URL is provided by Vite at build time.
        const baseUrl = import.meta.env.BASE_URL;
        envWithOnnx.backends.onnx.wasm.wasmPaths = baseUrl + 'onnxruntime-web/';
      }

      const device = this.isWebGPUSupported() ? 'webgpu' : 'cpu';
      const pipelineOptions: PipelineOptions = {
        device,
        progress_callback: (status: { status: string; progress?: number }) => {
          if (this.onProgress) {
            this.onProgress(status.status, status.progress ?? 0);
          }
        },
      };
      this.pipelineInstance = (await pipeline(
        'image-to-text',
        'Xenova/trocr-base-printed',
        pipelineOptions,
      )) as ImageToTextPipeline;
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<OCRResult> {
    if (!this.pipelineInstance) {
      throw new Error('Transformers engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    const rawImage = new RawImage(data.data, data.width, data.height, 4).rgb();
    const results = await this.pipelineInstance(rawImage);
    const first = results[0];
    return {
      text: first?.generated_text ?? first?.text ?? '',
    };
  }

  async destroy(): Promise<void> {
    const pipelineInstance = this.pipelineInstance as unknown as { dispose?: () => Promise<void> | void };
    if (pipelineInstance?.dispose) {
      await Promise.resolve(pipelineInstance.dispose());
    }
    this.pipelineInstance = null;
  }

  private isWebGPUSupported(): boolean {
    if (typeof this.webgpuOverride !== 'undefined') {
      return this.webgpuOverride;
    }
    return typeof navigator !== 'undefined' && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  }

  // Note: additional canvas helpers removed to keep the engine lean and avoid unused code.
}
