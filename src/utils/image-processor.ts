export interface ImageProcessorEnv {
  createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  getContext2d?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
  Image?: typeof Image;
  URL?: typeof URL;
  document?: Document;
}

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

export class ImageProcessor {
  private readonly env: ImageProcessorEnv;

  constructor(env: ImageProcessorEnv = {}) {
    this.env = env;
  }

  async fileToImageData(file: File): Promise<ImageData> {
    if (!SUPPORTED_TYPES.has(file.type)) {
      throw new Error(`Unsupported image format: ${file.type || 'unknown'}`);
    }

    const bitmap = await this.loadImageBitmap(file);
    const canvas = this.createCanvas(bitmap.width, bitmap.height);
    const context = this.getContext(canvas);

    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  preprocess(imageData: ImageData, contrast: number = 0.2): ImageData {
    const grayscale = this.toGrayscale(imageData);
    return this.enhanceContrast(grayscale, contrast);
  }

  toGrayscale(imageData: ImageData): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
    return new ImageData(data, imageData.width, imageData.height);
  }

  enhanceContrast(imageData: ImageData, contrast: number): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    const clampedContrast = Math.max(-1, Math.min(1, contrast));
    const factor = (259 * (clampedContrast * 255 + 255)) / (255 * (259 - clampedContrast * 255));

    for (let i = 0; i < data.length; i += 4) {
      const red = data[i] ?? 0;
      const green = data[i + 1] ?? 0;
      const blue = data[i + 2] ?? 0;
      data[i] = this.clamp(factor * (red - 128) + 128);
      data[i + 1] = this.clamp(factor * (green - 128) + 128);
      data[i + 2] = this.clamp(factor * (blue - 128) + 128);
    }

    return new ImageData(data, imageData.width, imageData.height);
  }

  resize(imageData: ImageData, maxDimension: number): ImageData {
    const { width, height } = imageData;
    const largestDimension = Math.max(width, height);
    if (largestDimension <= maxDimension) {
      return imageData;
    }

    const scale = maxDimension / largestDimension;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = this.createCanvas(targetWidth, targetHeight);
    const context = this.getContext(canvas);
    const sourceCanvas = this.createCanvas(width, height);
    const sourceContext = this.getContext(sourceCanvas);

    sourceContext.putImageData(imageData, 0, 0);
    context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

    return context.getImageData(0, 0, targetWidth, targetHeight);
  }

  private async loadImageBitmap(file: File): Promise<ImageBitmap> {
    if (this.env.createImageBitmap) {
      return await this.env.createImageBitmap(file);
    }

    const ImageConstructor = this.env.Image ?? globalThis.Image;
    const urlApi = this.env.URL ?? globalThis.URL;
    const doc = this.env.document ?? globalThis.document;

    if (!ImageConstructor || !urlApi || !doc) {
      throw new Error('Image decoding is not available in this environment.');
    }

    return await new Promise<ImageBitmap>((resolve, reject) => {
      const image = new ImageConstructor();
      const objectUrl = urlApi.createObjectURL(file);

      image.onload = (): void => {
        urlApi.revokeObjectURL(objectUrl);
        resolve(image as unknown as ImageBitmap);
      };

      image.onerror = (): void => {
        urlApi.revokeObjectURL(objectUrl);
        reject(new Error('Failed to decode image.'));
      };

      image.src = objectUrl;
    });
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement {
    if (this.env.createCanvas) {
      return this.env.createCanvas(width, height);
    }

    const doc = this.env.document ?? globalThis.document;
    if (!doc) {
      throw new Error('Canvas creation is not available in this environment.');
    }

    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = this.env.getContext2d ? this.env.getContext2d(canvas) : canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    return context;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
}
