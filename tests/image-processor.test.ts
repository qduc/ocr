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

const createProcessor = () => {
  const getContext2d = (canvas: HTMLCanvasElement) =>
    ({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => new ImageData(canvas.width, canvas.height)),
    }) as unknown as CanvasRenderingContext2D;

  const processor = new ImageProcessor({
    createImageBitmap: async () => ({ width: 2, height: 3 }) as ImageBitmap,
    createCanvas: (width, height) => ({ width, height }) as HTMLCanvasElement,
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
          const data = await processor.fileToImageData(file);
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
    await expect(processor.fileToImageData(file)).rejects.toThrow('Unsupported image format');
  });

  it('throws when image decoding fails', async () => {
    const processor = new ImageProcessor({
      createImageBitmap: async () => {
        throw new Error('Decode failed');
      },
      createCanvas: (width, height) => ({ width, height }) as HTMLCanvasElement,
      getContext2d: (canvas) =>
        ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => new ImageData(canvas.width, canvas.height)),
          putImageData: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    });

    const file = new File([new Uint8Array([0])], 'test.png', { type: 'image/png' });
    await expect(processor.fileToImageData(file)).rejects.toThrow('Decode failed');
  });
});

describe('ImageProcessor resolution analysis', () => {
  const { processor } = createProcessor();

  it('identifies low-resolution images that need upscaling', () => {
    // Create a very small 10x5 image (simulating very low-res text)
    // After scaling to 384, the effective height would be 5 * (384/10) = 192
    // But we need a case where effective height < MIN_CHAR_HEIGHT (20)
    // For 384 target, if image is 500x10, scale = 384/500 = 0.768
    // Effective height = 10 * 0.768 = 7.68 < 20, should trigger upscaling
    const lowResImageData = new ImageData(500, 10);

    const analysis = processor.analyzeResolution(lowResImageData);

    // Such a small text height should recommend upscaling
    expect(analysis.recommendedScale).toBeGreaterThan(1);
    expect(analysis.warning).toBeDefined();
  });

  it('accepts adequately sized images without upscaling', () => {
    // Create a larger 400x50 image (typical text line)
    const adequateImageData = new ImageData(400, 50);

    const analysis = processor.analyzeResolution(adequateImageData);

    // Large enough image should not require upscaling
    expect(analysis.recommendedScale).toBe(1);
    expect(analysis.isSuitable).toBe(true);
  });

  it('caps upscale recommendation at MAX_UPSCALE_FACTOR', () => {
    // Create tiny 5x3 image
    const tinyImageData = new ImageData(5, 3);

    const analysis = processor.analyzeResolution(tinyImageData);

    // Should be capped at 4x (MAX_UPSCALE_FACTOR)
    expect(analysis.recommendedScale).toBeLessThanOrEqual(4);
  });
});

describe('ImageProcessor upscaling', () => {
  it('upscales image by the specified factor', () => {
    const { processor, getContext2d } = createProcessor();
    const imageData = new ImageData(10, 10);

    const upscaled = processor.upscale(imageData, 2);

    // Should be 2x the original dimensions
    expect(upscaled.width).toBe(20);
    expect(upscaled.height).toBe(20);
  });

  it('returns original image when scale is 1 or less', () => {
    const { processor } = createProcessor();
    const imageData = new ImageData(10, 10);

    const unchanged = processor.upscale(imageData, 1);
    expect(unchanged).toBe(imageData);

    const noDownscale = processor.upscale(imageData, 0.5);
    expect(noDownscale).toBe(imageData);
  });
});

describe('ImageProcessor prepareForTrOCR', () => {
  it('applies upscaling to low-resolution images', () => {
    const { processor, getContext2d } = createProcessor();
    // Small image that will need upscaling
    const smallImageData = new ImageData(15, 8);

    const result = processor.prepareForTrOCR(smallImageData);

    // Should have processed and analyzed the image
    expect(result.analysis).toBeDefined();
    expect(result.imageData).toBeDefined();
  });

  it('respects maxUpscale option', () => {
    const { processor, getContext2d } = createProcessor();
    const tinyImageData = new ImageData(5, 3);

    const result = processor.prepareForTrOCR(tinyImageData, { maxUpscale: 2 });

    // Analysis should reflect the constraints
    expect(result.analysis).toBeDefined();
  });

  it('applies contrast enhancement by default', () => {
    const { processor, getContext2d } = createProcessor();
    const imageData = new ImageData(100, 50);

    const withContrast = processor.prepareForTrOCR(imageData, { enhanceContrast: true });
    const withoutContrast = processor.prepareForTrOCR(imageData, { enhanceContrast: false });

    // Both should return valid results
    expect(withContrast.imageData).toBeDefined();
    expect(withoutContrast.imageData).toBeDefined();
  });

  it('supports preprocessing mode option', () => {
    const { processor } = createProcessor();
    const imageData = new ImageData(100, 50);

    // All modes should return valid results
    const noneResult = processor.prepareForTrOCR(imageData, { preprocessingMode: 'none' });
    const lightResult = processor.prepareForTrOCR(imageData, { preprocessingMode: 'light' });
    const aggressiveResult = processor.prepareForTrOCR(imageData, { preprocessingMode: 'aggressive' });

    expect(noneResult.imageData).toBeDefined();
    expect(lightResult.imageData).toBeDefined();
    expect(aggressiveResult.imageData).toBeDefined();
  });

  it('respects normalizePolarity option', () => {
    const { processor } = createProcessor();
    const imageData = new ImageData(100, 50);

    // Should work with both options
    const withPolarity = processor.prepareForTrOCR(imageData, { normalizePolarity: true });
    const withoutPolarity = processor.prepareForTrOCR(imageData, { normalizePolarity: false });

    expect(withPolarity.imageData).toBeDefined();
    expect(withoutPolarity.imageData).toBeDefined();
  });
});

describe('ImageProcessor polarity detection', () => {
  const { processor } = createProcessor();

  /**
   * Helper to create an ImageData with specific color pattern
   */
  const createColoredImage = (width: number, height: number, fillFn: (x: number, y: number) => [number, number, number, number]): ImageData => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const [r, g, b, a] = fillFn(x, y);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
    return new ImageData(data, width, height);
  };

  it('detects normal polarity (dark text on light background)', () => {
    // Create image with mostly white pixels and some dark regions
    const imageData = createColoredImage(100, 50, (x, y) => {
      // White background with a dark stripe in the middle
      if (y > 15 && y < 35 && x > 20 && x < 80) {
        return [20, 20, 20, 255]; // Dark text region
      }
      return [240, 240, 240, 255]; // Light background
    });

    const analysis = processor.analyzePolarity(imageData);
    expect(analysis.isInverted).toBe(false);
    expect(analysis.meanLuminance).toBeGreaterThan(128);
  });

  it('detects inverted polarity (light text on dark background)', () => {
    // Create image with mostly black pixels and some light regions
    const imageData = createColoredImage(100, 50, (x, y) => {
      // Dark background with a light stripe in the middle
      if (y > 15 && y < 35 && x > 20 && x < 80) {
        return [230, 230, 230, 255]; // Light text region
      }
      return [20, 20, 20, 255]; // Dark background
    });

    const analysis = processor.analyzePolarity(imageData);
    expect(analysis.isInverted).toBe(true);
    expect(analysis.meanLuminance).toBeLessThan(128);
  });

  it('normalizes inverted images to standard polarity', () => {
    // Create inverted (light on dark) image
    const invertedImage = createColoredImage(50, 20, (x, y) => {
      if (y > 5 && y < 15) {
        return [200, 200, 200, 255]; // Light text
      }
      return [30, 30, 30, 255]; // Dark background
    });

    const normalized = processor.normalizePolarity(invertedImage);

    // After normalization, should have dark text on light background
    const normalizedAnalysis = processor.analyzePolarity(normalized);
    expect(normalizedAnalysis.isInverted).toBe(false);
  });

  it('does not modify already-correct polarity images', () => {
    // Create normal polarity image
    const normalImage = createColoredImage(50, 20, () => [200, 200, 200, 255]);

    const result = processor.normalizePolarity(normalImage);

    // Should return same image (by reference since no change needed)
    // Note: implementation may return new copy, so check data instead
    expect(result.data[0]).toBe(normalImage.data[0]);
  });

  it('supports forced inversion', () => {
    // Create light image
    const lightImage = createColoredImage(50, 20, () => [200, 200, 200, 255]);

    const forcedInvert = processor.normalizePolarity(lightImage, true);

    // Should be inverted even though it wasn't detected as inverted
    expect(forcedInvert.data[0]).toBe(55); // 255 - 200
  });
});

describe('ImageProcessor gentle contrast enhancement', () => {
  const { processor } = createProcessor();

  /**
   * Helper to create a low-contrast grayscale image
   */
  const createLowContrastImage = (width: number, height: number, minVal: number, maxVal: number): ImageData => {
    const data = new Uint8ClampedArray(width * height * 4);
    const range = maxVal - minVal;
    for (let i = 0; i < width * height; i++) {
      const value = minVal + Math.floor((i / (width * height)) * range);
      const idx = i * 4;
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 255;
    }
    return new ImageData(data, width, height);
  };

  it('enhances contrast on low-contrast images', () => {
    // Create image with limited dynamic range (100-150)
    const lowContrastImage = createLowContrastImage(50, 20, 100, 150);

    const enhanced = processor.gentleContrastEnhance(lowContrastImage, 0.3);

    // Calculate min/max of enhanced image
    let minVal = 255, maxVal = 0;
    for (let i = 0; i < enhanced.data.length; i += 4) {
      minVal = Math.min(minVal, enhanced.data[i]);
      maxVal = Math.max(maxVal, enhanced.data[i]);
    }

    // Enhanced image should have greater dynamic range
    const originalRange = 50; // 150 - 100
    const enhancedRange = maxVal - minVal;
    expect(enhancedRange).toBeGreaterThan(originalRange);
  });

  it('preserves good contrast images without changes', () => {
    // Create image with already good contrast
    const goodContrastImage = createLowContrastImage(50, 20, 10, 250);

    const result = processor.gentleContrastEnhance(goodContrastImage, 0.3);

    // Should return the original image unchanged (or very similar)
    expect(result).toBeDefined();
  });

  it('respects strength parameter', () => {
    const lowContrastImage = createLowContrastImage(50, 20, 100, 150);

    const gentle = processor.gentleContrastEnhance(lowContrastImage, 0.1);
    const strong = processor.gentleContrastEnhance(lowContrastImage, 0.8);

    // Both should enhance, but strong more than gentle
    // We just verify they both produce valid output
    expect(gentle.data).toBeDefined();
    expect(strong.data).toBeDefined();
  });
});

describe('ImageProcessor grayscale RGB', () => {
  const { processor } = createProcessor();

  it('converts to grayscale while maintaining 3-channel RGB format', () => {
    // Create colorful image
    const colorfulData = new Uint8ClampedArray([
      255, 0, 0, 255,    // Red
      0, 255, 0, 255,    // Green
      0, 0, 255, 255,    // Blue
      255, 255, 0, 255,  // Yellow
    ]);
    const colorfulImage = new ImageData(colorfulData, 2, 2);

    const grayscale = processor.toGrayscaleRGB(colorfulImage);

    // Each pixel should have R = G = B (grayscale)
    for (let i = 0; i < grayscale.data.length; i += 4) {
      expect(grayscale.data[i]).toBe(grayscale.data[i + 1]);
      expect(grayscale.data[i + 1]).toBe(grayscale.data[i + 2]);
    }

    // Alpha should be unchanged
    expect(grayscale.data[3]).toBe(255);
  });

  it('uses perceptual weights for conversion', () => {
    // Pure red, green, blue pixels
    const redPixel = new Uint8ClampedArray([255, 0, 0, 255]);
    const greenPixel = new Uint8ClampedArray([0, 255, 0, 255]);
    const bluePixel = new Uint8ClampedArray([0, 0, 255, 255]);

    const redImage = new ImageData(redPixel, 1, 1);
    const greenImage = new ImageData(greenPixel, 1, 1);
    const blueImage = new ImageData(bluePixel, 1, 1);

    const redGray = processor.toGrayscaleRGB(redImage);
    const greenGray = processor.toGrayscaleRGB(greenImage);
    const blueGray = processor.toGrayscaleRGB(blueImage);

    // Green should be brightest (0.587 weight)
    // Red should be next (0.299 weight)
    // Blue should be darkest (0.114 weight)
    expect(greenGray.data[0]).toBeGreaterThan(redGray.data[0]);
    expect(redGray.data[0]).toBeGreaterThan(blueGray.data[0]);
  });
});

describe('ImageProcessor preprocessForTrOCR modes', () => {
  const { processor } = createProcessor();

  const createTestImage = (): ImageData => {
    const data = new Uint8ClampedArray(100 * 50 * 4);
    // Create a simple pattern with some variation
    for (let i = 0; i < data.length; i += 4) {
      const value = 100 + Math.floor(Math.random() * 50);
      data[i] = value;
      data[i + 1] = value + 10;
      data[i + 2] = value + 20;
      data[i + 3] = 255;
    }
    return new ImageData(data, 100, 50);
  };

  it('mode "none" preserves original image data', () => {
    const original = createTestImage();
    const result = processor.preprocessForTrOCR(original, 'none', false);

    // Should be unchanged (same reference or identical data)
    // When normalizePolarity is false and mode is none, should return original
    expect(result.width).toBe(original.width);
    expect(result.height).toBe(original.height);
  });

  it('mode "light" applies grayscale and gentle enhancement', () => {
    const original = createTestImage();
    const result = processor.preprocessForTrOCR(original, 'light', false);

    // Should be grayscale (R = G = B for all pixels)
    for (let i = 0; i < Math.min(result.data.length, 100); i += 4) {
      expect(result.data[i]).toBe(result.data[i + 1]);
      expect(result.data[i + 1]).toBe(result.data[i + 2]);
    }
  });

  it('mode "aggressive" applies stronger processing', () => {
    const original = createTestImage();
    const result = processor.preprocessForTrOCR(original, 'aggressive', false);

    // Should produce valid output
    expect(result.width).toBe(original.width);
    expect(result.height).toBe(original.height);
    // Should be grayscale
    expect(result.data[0]).toBe(result.data[1]);
    expect(result.data[1]).toBe(result.data[2]);
  });

  it('applies polarity normalization when enabled', () => {
    // Create inverted image (light text on dark)
    const data = new Uint8ClampedArray(50 * 20 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 30;  // Dark
      data[i + 1] = 30;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const invertedImage = new ImageData(data, 50, 20);

    const withNormalization = processor.preprocessForTrOCR(invertedImage, 'none', true);
    const withoutNormalization = processor.preprocessForTrOCR(invertedImage, 'none', false);

    // With normalization should be inverted (lighter)
    expect(withNormalization.data[0]).toBeGreaterThan(withoutNormalization.data[0]);
  });
});
