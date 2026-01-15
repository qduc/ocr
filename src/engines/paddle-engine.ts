import * as ocr from '@paddlejs-models/ocr';
import '@paddlejs/paddlejs-backend-webgl';
import type { IOCREngine } from '@/types/ocr-engine';

export type PaddleProgressCallback = (status: string, progress: number) => void;

export class PaddleEngine implements IOCREngine {
  public readonly id = 'paddle';
  public isLoading = false;
  private isLoaded = false;
  private readonly onProgress?: PaddleProgressCallback;

  constructor(onProgress?: PaddleProgressCallback) {
    this.onProgress = onProgress;
  }

  async load(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    this.isLoading = true;
    try {
      if (this.onProgress) {
        this.onProgress('Initializing PaddleOCR...', 0);
      }

      // ocr.init returns a promise when models are loaded
      await ocr.init();

      this.isLoaded = true;
      if (this.onProgress) {
        this.onProgress('Ready', 1);
      }
    } catch (error) {
      console.error('Failed to load PaddleOCR engine:', error);
      throw new Error(`PaddleOCR load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.isLoaded) {
      throw new Error('PaddleOCR engine not loaded.');
    }

    const canvas = this.imageDataToCanvas(data);

    try {
      const result = await ocr.recognize(canvas);
      if (result && Array.isArray(result.text)) {
        return result.text.join('\n');
      }
      return '';
    } catch (error) {
      console.error('PaddleOCR processing failed:', error);
      throw new Error(`PaddleOCR process failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async destroy(): Promise<void> {
    // PaddleJS doesn't have a formal destroy/terminate method for the OCR model
    // but we can mark it as not loaded.
    this.isLoaded = false;
  }

  private imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
    const { width, height } = imageData;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  }
}
