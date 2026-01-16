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

    const blob = await this.imageDataToBlob(data);
    const result = await this.worker.recognize(blob);
    return result.data.text ?? '';
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
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
      return await (canvas).convertToBlob({ type: 'image/png' });
    }

    return await new Promise<Blob>((resolve, reject) => {
      (canvas).toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode image for OCR.'));
        }
      }, 'image/png');
    });
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }

    if (typeof document === 'undefined') {
      throw new Error('Canvas creation is not available in this environment.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}
