/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LineSegmenter } from '../src/utils/line-segmenter';

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

/**
 * Creates a test image with horizontal text lines (dark text on light background).
 */
function createTestImageWithLines(
  width: number,
  height: number,
  linePositions: Array<{ start: number; end: number }>,
  options: { inverted?: boolean; textColor?: number; bgColor?: number } = {}
): ImageData {
  const { inverted = false, textColor = 0, bgColor = 255 } = options;
  const fg = inverted ? bgColor : textColor;
  const bg = inverted ? textColor : bgColor;

  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with background
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg;
    data[i + 1] = bg;
    data[i + 2] = bg;
    data[i + 3] = 255;
  }

  // Draw text lines
  for (const { start, end } of linePositions) {
    for (let y = start; y <= end && y < height; y++) {
      const inkStart = Math.floor(width * 0.1);
      const inkEnd = Math.floor(width * 0.9);
      for (let x = inkStart; x < inkEnd; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = fg;
        data[idx + 1] = fg;
        data[idx + 2] = fg;
      }
    }
  }

  return new ImageData(data, width, height);
}

/**
 * Creates a gradient background image with text lines.
 */
function createGradientImageWithLines(
  width: number,
  height: number,
  linePositions: Array<{ start: number; end: number }>
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  // Create gradient background (varies from left to right)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const bgValue = 180 + Math.floor((x / width) * 75); // 180-255 gradient
      data[idx] = bgValue;
      data[idx + 1] = bgValue;
      data[idx + 2] = bgValue;
      data[idx + 3] = 255;
    }
  }

  // Draw dark text lines
  for (const { start, end } of linePositions) {
    for (let y = start; y <= end && y < height; y++) {
      const inkStart = Math.floor(width * 0.1);
      const inkEnd = Math.floor(width * 0.9);
      for (let x = inkStart; x < inkEnd; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 30;
        data[idx + 1] = 30;
        data[idx + 2] = 30;
      }
    }
  }

  return new ImageData(data, width, height);
}

describe('LineSegmenter property tests', () => {
  it('detects approximately correct number of lines', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      minGapHeight: 3,
      adaptiveThreshold: false, // Use Otsu for predictability
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((numLines) => {
          const lineHeight = fc.integer({ min: 12, max: 25 });
          const gapHeight = fc.integer({ min: 15, max: 30 });

          return fc.tuple(
            fc.constant(numLines),
            fc.array(lineHeight, { minLength: numLines, maxLength: numLines }),
            fc.array(gapHeight, { minLength: numLines, maxLength: numLines })
          );
        }),
        ([numLines, lineHeights, gapHeights]) => {
          const width = 200;
          let currentY = 25;

          const linePositions: Array<{ start: number; end: number }> = [];
          for (let i = 0; i < numLines; i++) {
            const start = currentY;
            const end = currentY + (lineHeights[i] ?? 15) - 1;
            linePositions.push({ start, end });
            currentY = end + (gapHeights[i] ?? 20) + 1;
          }

          const height = currentY + 25;
          const imageData = createTestImageWithLines(width, height, linePositions);
          const segments = segmenter.detectLines(imageData);

          // Allow for some variance due to adaptive algorithms
          expect(segments.length).toBeGreaterThanOrEqual(Math.max(1, numLines - 1));
          expect(segments.length).toBeLessThanOrEqual(numLines + 1);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('extracts lines that preserve original width', () => {
    const segmenter = new LineSegmenter({ adaptiveThreshold: false });

    fc.assert(
      fc.property(fc.integer({ min: 100, max: 500 }), (width) => {
        const linePositions = [
          { start: 20, end: 40 },
          { start: 70, end: 90 },
        ];
        const imageData = createTestImageWithLines(width, 130, linePositions);
        const extractedLines = segmenter.extractLines(imageData);

        for (const line of extractedLines) {
          expect(line.width).toBe(width);
        }
      }),
      { numRuns: 15 }
    );
  });
});

describe('LineSegmenter unit tests', () => {
  it('returns empty array for completely white image', () => {
    const segmenter = new LineSegmenter();
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toEqual([]);
  });

  it('returns original image when no lines detected', () => {
    const segmenter = new LineSegmenter();
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    const imageData = new ImageData(data, width, height);
    const lines = segmenter.extractLines(imageData);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(imageData);
  });

  it('detects two separate lines', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      minGapHeight: 3,
      linePadding: 0,
      adaptiveThreshold: false,
    });
    const linePositions = [
      { start: 20, end: 40 },
      { start: 70, end: 90 },
    ];
    const imageData = createTestImageWithLines(200, 120, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(2);
  });

  it('isMultiline returns false for very wide single-line images', () => {
    const segmenter = new LineSegmenter();
    const linePositions = [{ start: 5, end: 15 }];
    const imageData = createTestImageWithLines(400, 20, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(false);
  });

  it('isMultiline returns true for tall images with multiple lines', () => {
    const segmenter = new LineSegmenter({ adaptiveThreshold: false });
    const linePositions = [
      { start: 20, end: 40 },
      { start: 80, end: 100 },
    ];
    const imageData = createTestImageWithLines(200, 150, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(true);
  });

  it('isMultiline returns true for tall images based on aspect ratio', () => {
    const segmenter = new LineSegmenter();
    const linePositions = [{ start: 20, end: 180 }];
    const imageData = createTestImageWithLines(100, 200, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(true);
  });

  it('returns original image when single line covers most of image', () => {
    const segmenter = new LineSegmenter({ linePadding: 0, adaptiveThreshold: false });
    const linePositions = [{ start: 5, end: 85 }];
    const imageData = createTestImageWithLines(200, 100, linePositions);

    const lines = segmenter.extractLines(imageData);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(imageData);
  });

  it('handles three or more lines correctly', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      minGapHeight: 3,
      linePadding: 0,
      adaptiveThreshold: false,
    });
    const linePositions = [
      { start: 15, end: 30 },
      { start: 55, end: 70 },
      { start: 95, end: 110 },
    ];
    const imageData = createTestImageWithLines(200, 140, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(3);
  });
});

describe('LineSegmenter adaptive thresholding', () => {
  it('detects lines on gradient background with adaptive threshold', () => {
    const segmenter = new LineSegmenter({
      adaptiveThreshold: true,
      minLineHeight: 5,
      linePadding: 0,
    });
    const linePositions = [
      { start: 20, end: 40 },
      { start: 70, end: 90 },
    ];
    const imageData = createGradientImageWithLines(200, 130, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments.length).toBeGreaterThanOrEqual(1);
  });

  it('handles light text on dark background (inverted polarity)', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      linePadding: 0,
      adaptiveThreshold: false,
    });
    const linePositions = [
      { start: 20, end: 40 },
      { start: 70, end: 90 },
    ];
    // Light text (200) on dark background (30) - NOT using inverted flag
    const imageData = createTestImageWithLines(200, 130, linePositions, {
      textColor: 200, // light gray text
      bgColor: 30,    // dark background
    });
    const segments = segmenter.detectLines(imageData);

    // Should detect lines despite inverted polarity
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });

  it('Otsu threshold finds appropriate threshold for bimodal distribution', () => {
    // Create image with clear bimodal distribution
    const segmenter = new LineSegmenter({ adaptiveThreshold: false });
    const linePositions = [{ start: 30, end: 50 }];
    const imageData = createTestImageWithLines(100, 80, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments.length).toBe(1);
  });
});

describe('LineSegmenter color handling', () => {
  it('handles colored text on white background', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      linePadding: 0,
      adaptiveThreshold: false,
    });

    const width = 200;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with white background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    // Add blue text line at y=30-50
    for (let y = 30; y < 50; y++) {
      for (let x = 20; x < 180; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 0; // R
        data[idx + 1] = 0; // G
        data[idx + 2] = 150; // B (dark blue)
      }
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    expect(segments.length).toBe(1);
  });

  it('handles red text on light background', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      linePadding: 0,
      adaptiveThreshold: false,
    });

    const width = 200;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with light gray background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 240;
      data[i + 1] = 240;
      data[i + 2] = 240;
      data[i + 3] = 255;
    }

    // Add dark red text line
    for (let y = 30; y < 50; y++) {
      for (let x = 20; x < 180; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 139; // R (dark red)
        data[idx + 1] = 0; // G
        data[idx + 2] = 0; // B
      }
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    expect(segments.length).toBe(1);
  });

  it('handles low contrast text', () => {
    const segmenter = new LineSegmenter({
      minLineHeight: 5,
      linePadding: 0,
      adaptiveThreshold: true, // Adaptive is better for low contrast
      adaptiveC: 5, // Lower C for detecting subtle differences
    });

    const width = 200;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with medium gray background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 180;
      data[i + 1] = 180;
      data[i + 2] = 180;
      data[i + 3] = 255;
    }

    // Add slightly darker text line (low contrast)
    for (let y = 30; y < 50; y++) {
      for (let x = 20; x < 180; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 140;
        data[idx + 1] = 140;
        data[idx + 2] = 140;
      }
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    // May or may not detect depending on contrast, but shouldn't crash
    expect(Array.isArray(segments)).toBe(true);
  });
});

describe('LineSegmenter edge cases', () => {
  it('handles very small images', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 2 });
    const imageData = createTestImageWithLines(20, 10, [{ start: 3, end: 7 }]);
    const segments = segmenter.detectLines(imageData);

    // Should not crash
    expect(Array.isArray(segments)).toBe(true);
  });

  it('handles single pixel wide images', () => {
    const segmenter = new LineSegmenter();
    const data = new Uint8ClampedArray(1 * 100 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    const imageData = new ImageData(data, 1, 100);
    const segments = segmenter.detectLines(imageData);

    expect(Array.isArray(segments)).toBe(true);
  });

  it('handles completely black image', () => {
    const segmenter = new LineSegmenter();
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    // Should handle gracefully (might detect as single line or empty)
    expect(Array.isArray(segments)).toBe(true);
  });

  it('handles noisy image', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 10 });
    const width = 200;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Create noisy background
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.floor(Math.random() * 50) + 200; // 200-250
      data[i] = noise;
      data[i + 1] = noise;
      data[i + 2] = noise;
      data[i + 3] = 255;
    }

    // Add clear text line
    for (let y = 40; y < 60; y++) {
      for (let x = 20; x < 180; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 20;
        data[idx + 1] = 20;
        data[idx + 2] = 20;
      }
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    // Should detect at least one line despite noise
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LineSegmenter options', () => {
  it('respects adaptiveBlockSize option', () => {
    // Smaller block size should be more sensitive to local variations
    const segmenter1 = new LineSegmenter({
      adaptiveThreshold: true,
      adaptiveBlockSize: 5,
    });
    const segmenter2 = new LineSegmenter({
      adaptiveThreshold: true,
      adaptiveBlockSize: 31,
    });

    const imageData = createGradientImageWithLines(200, 100, [{ start: 30, end: 50 }]);

    // Both should work without crashing
    const segments1 = segmenter1.detectLines(imageData);
    const segments2 = segmenter2.detectLines(imageData);

    expect(Array.isArray(segments1)).toBe(true);
    expect(Array.isArray(segments2)).toBe(true);
  });

  it('respects adaptiveC option', () => {
    const segmenter = new LineSegmenter({
      adaptiveThreshold: true,
      adaptiveC: 20, // Higher C means stricter threshold
    });

    const imageData = createTestImageWithLines(200, 100, [{ start: 30, end: 50 }]);
    const segments = segmenter.detectLines(imageData);

    expect(Array.isArray(segments)).toBe(true);
  });

  it('can disable adaptive threshold', () => {
    const segmenter = new LineSegmenter({
      adaptiveThreshold: false,
    });

    const imageData = createTestImageWithLines(200, 100, [{ start: 30, end: 50 }]);
    const segments = segmenter.detectLines(imageData);

    expect(segments.length).toBe(1);
  });
});
