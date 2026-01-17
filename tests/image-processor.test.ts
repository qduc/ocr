/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ImageProcessor } from '../src/utils/image-processor';

if (typeof ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = width ?? 0;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = width ?? 0;
        this.height = height ?? 0;
      }
    }
  }

  // @ts-expect-error - test environment polyfill
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

const createProcessor = (): { processor: ImageProcessor; getContext2d: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D } => {
  const getContext2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D =>
    ({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => new ImageData(canvas.width, canvas.height)),
    }) as unknown as CanvasRenderingContext2D;

  const processor = new ImageProcessor({
    createImageBitmap: (): Promise<ImageBitmap> => Promise.resolve(({ width: 2, height: 3 }) as ImageBitmap),
    createCanvas: (width: number, height: number): HTMLCanvasElement => ({ width, height }) as HTMLCanvasElement,
    getContext2d,
  });

  return { processor, getContext2d };
};

describe('ImageProcessor property tests', () => {
  it('supports common image formats', async () => {
    const { processor } = createProcessor();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('image/jpeg', 'image/png', 'image/webp', 'image/bmp'),
        async (type) => {
          const file = new File([new Uint8Array([0])], 'test', { type });
          const data = await processor.sourceToImageData(file);
          expect(data).toBeInstanceOf(ImageData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('resizes large images while preserving aspect ratio', () => {
    const { processor } = createProcessor();
    const arb = fc
      .integer({ min: 10, max: 200 })
      .chain((width) =>
        fc.integer({ min: 10, max: 200 }).chain((height) =>
          fc.integer({ min: 5, max: 100 }).map((maxDimension) => ({
            width,
            height,
            maxDimension,
          }))
        )
      );

    fc.assert(
      fc.property(arb, ({ width, height, maxDimension }) => {
        fc.pre(Math.max(width, height) > maxDimension);
        const data = new Uint8ClampedArray(width * height * 4);
        const imageData = new ImageData(data, width, height);

        const resized = processor.resize(imageData, maxDimension);
        const scale = maxDimension / Math.max(width, height);
        const expectedWidth = Math.max(1, Math.round(width * scale));
        const expectedHeight = Math.max(1, Math.round(height * scale));

        expect(resized.width).toBe(expectedWidth);
        expect(resized.height).toBe(expectedHeight);
        expect(resized.width).toBeLessThanOrEqual(maxDimension);
        expect(resized.height).toBeLessThanOrEqual(maxDimension);
      }),
      { numRuns: 50 }
    );
  });

  it('converts preprocessing output to grayscale', () => {
    const { processor } = createProcessor();
    const arb = fc
      .integer({ min: 1, max: 4 })
      .chain((width) =>
        fc.integer({ min: 1, max: 4 }).chain((height) =>
          fc
            .uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
            .map((data) => ({ width, height, data }))
        )
      );

    fc.assert(
      fc.property(arb, ({ width, height, data }) => {
        const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        const processed = processor.preprocess(imageData);

        for (let i = 0; i < processed.data.length; i += 4) {
          const r = processed.data[i];
          const g = processed.data[i + 1];
          const b = processed.data[i + 2];
          expect(r).toBe(g);
          expect(g).toBe(b);
        }
      }),
      { numRuns: 25 }
    );
  });
});

describe('ImageProcessor unit tests', () => {
  it('returns the original ImageData if resize is not needed', () => {
    const { processor } = createProcessor();
    const imageData = new ImageData(1, 1);
    const resized = processor.resize(imageData, 10);
    expect(resized).toBe(imageData);
  });

  it('throws for unsupported formats', async () => {
    const { processor } = createProcessor();
    const file = new File([new Uint8Array([0])], 'test.txt', { type: 'text/plain' });
    await expect(processor.sourceToImageData(file)).rejects.toThrow('Unsupported image format');
  });

  it('throws when image decoding fails', async () => {
    const processor = new ImageProcessor({
      createImageBitmap: (): Promise<ImageBitmap> => Promise.reject(new Error('Decode failed')),
      createCanvas: (width: number, height: number): HTMLCanvasElement => ({ width, height }) as HTMLCanvasElement,
      getContext2d: (canvas: HTMLCanvasElement): CanvasRenderingContext2D =>
        ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => new ImageData(canvas.width, canvas.height)),
          putImageData: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    });

    const file = new File([new Uint8Array([0])], 'test.png', { type: 'image/png' });
    await expect(processor.sourceToImageData(file)).rejects.toThrow('Decode failed');
  });
});
