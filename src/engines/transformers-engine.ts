import { pipeline, env } from '@xenova/transformers';
import type { IOCREngine } from '@/types/ocr-engine';

export type TransformersProgressCallback = (status: string, progress: number) => void;

type ImageToTextPipeline = (image: ImageData) => Promise<Array<{ generated_text?: string; text?: string }>>;

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

    const results = await this.pipelineInstance(data);
    const first = results[0];
    return first?.generated_text ?? first?.text ?? '';
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
}
