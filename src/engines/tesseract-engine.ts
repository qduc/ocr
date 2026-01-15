import { createWorker, type Worker } from 'tesseract.js';
import type { IOCREngine } from '@/types/ocr-engine';

export type TesseractProgressCallback = (status: string, progress: number) => void;

export class TesseractEngine implements IOCREngine {
  public readonly id = 'tesseract';
  public isLoading = false;
  private worker: Worker | null = null;
  private readonly onProgress?: TesseractProgressCallback;

  constructor(onProgress?: TesseractProgressCallback) {
    this.onProgress = onProgress;
  }

  async load(): Promise<void> {
    if (this.worker) {
      return;
    }

    this.isLoading = true;
    try {
      this.worker = await createWorker('eng', 1, {
        cacheMethod: 'refresh',
        cachePath: '.',
        logger: (message) => {
          if (this.onProgress) {
            this.onProgress(message.status, message.progress ?? 0);
          }
        },
      });
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.worker) {
      throw new Error('Tesseract engine not loaded.');
    }

    const result = await this.worker.recognize(data);
    return result.data.text ?? '';
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
