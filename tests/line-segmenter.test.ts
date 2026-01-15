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
 * Creates a test image with horizontal text lines.
 * Text lines are represented by rows of dark pixels (value 0).
 * Background is white (value 255).
 */
function createTestImageWithLines(
  width: number,
  height: number,
  linePositions: Array<{ start: number; end: number }>
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with white background
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; // R
    data[i + 1] = 255; // G
    data[i + 2] = 255; // B
    data[i + 3] = 255; // A
  }

  // Draw dark text lines
  for (const { start, end } of linePositions) {
    for (let y = start; y <= end && y < height; y++) {
      // Fill most of the row with dark pixels (simulating text)
      const inkStart = Math.floor(width * 0.1);
      const inkEnd = Math.floor(width * 0.9);
      for (let x = inkStart; x < inkEnd; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 0; // R
        data[idx + 1] = 0; // G
        data[idx + 2] = 0; // B
        // Alpha stays 255
      }
    }
  }

  return new ImageData(data, width, height);
}

describe('LineSegmenter property tests', () => {
  it('detects same number of lines as line regions in image', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 5, minGapHeight: 5 });

    fc.assert(
      fc.property(
        // Generate 1-5 lines with random positions
        fc.integer({ min: 1, max: 5 }).chain((numLines) => {
          // Generate line heights and gaps
          const lineHeight = fc.integer({ min: 10, max: 30 });
          const gapHeight = fc.integer({ min: 10, max: 30 });

          return fc.tuple(
            fc.constant(numLines),
            fc.array(lineHeight, { minLength: numLines, maxLength: numLines }),
            fc.array(gapHeight, { minLength: numLines, maxLength: numLines })
          );
        }),
        ([numLines, lineHeights, gapHeights]) => {
          const width = 200;
          let currentY = 20; // Start with some margin

          const linePositions: Array<{ start: number; end: number }> = [];
          for (let i = 0; i < numLines; i++) {
            const start = currentY;
            const end = currentY + lineHeights[i] - 1;
            linePositions.push({ start, end });
            currentY = end + gapHeights[i] + 1;
          }

          const height = currentY + 20; // Add bottom margin
          const imageData = createTestImageWithLines(width, height, linePositions);
          const segments = segmenter.detectLines(imageData);

          expect(segments.length).toBe(numLines);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('extracts lines that preserve original width', () => {
    const segmenter = new LineSegmenter();

    fc.assert(
      fc.property(fc.integer({ min: 100, max: 500 }), (width) => {
        const linePositions = [
          { start: 20, end: 40 },
          { start: 60, end: 80 },
        ];
        const imageData = createTestImageWithLines(width, 120, linePositions);
        const extractedLines = segmenter.extractLines(imageData);

        for (const line of extractedLines) {
          expect(line.width).toBe(width);
        }
      }),
      { numRuns: 20 }
    );
  });

  it('extracted line heights match segment heights', () => {
    const segmenter = new LineSegmenter({ linePadding: 0 });

    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 40 }),
        fc.integer({ min: 15, max: 40 }),
        (line1Height, line2Height) => {
          const width = 200;
          const gap = 30;
          const linePositions = [
            { start: 20, end: 20 + line1Height - 1 },
            { start: 20 + line1Height + gap, end: 20 + line1Height + gap + line2Height - 1 },
          ];
          const height = linePositions[1].end + 20;
          const imageData = createTestImageWithLines(width, height, linePositions);

          const segments = segmenter.detectLines(imageData);
          const extractedLines = segmenter.extractLines(imageData);

          expect(extractedLines.length).toBe(2);
          for (let i = 0; i < segments.length; i++) {
            expect(extractedLines[i].height).toBe(segments[i].height);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe('LineSegmenter unit tests', () => {
  it('returns empty array for completely white image', () => {
    const segmenter = new LineSegmenter();
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with white
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

    // Fill with white
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
    const segmenter = new LineSegmenter({ minLineHeight: 5, minGapHeight: 5, linePadding: 0 });
    const linePositions = [
      { start: 20, end: 40 },
      { start: 60, end: 80 },
    ];
    const imageData = createTestImageWithLines(200, 100, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(2);
    expect(segments[0].top).toBe(20);
    expect(segments[0].bottom).toBe(40);
    expect(segments[1].top).toBe(60);
    expect(segments[1].bottom).toBe(80);
  });

  it('merges close lines when gap is small', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 5, minGapHeight: 15, linePadding: 0 });
    // Two lines with small gap (should be merged)
    const linePositions = [
      { start: 20, end: 30 },
      { start: 35, end: 45 }, // Only 4 pixel gap
    ];
    const imageData = createTestImageWithLines(200, 100, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(1);
    expect(segments[0].top).toBe(20);
    expect(segments[0].bottom).toBe(45);
  });

  it('filters out lines smaller than minimum height', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 15, linePadding: 0 });
    const linePositions = [
      { start: 20, end: 25 }, // Only 6 pixels tall - should be filtered
      { start: 60, end: 80 }, // 21 pixels tall - should remain
    ];
    const imageData = createTestImageWithLines(200, 100, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(1);
    expect(segments[0].top).toBe(60);
  });

  it('applies padding to line segments', () => {
    const padding = 8;
    const segmenter = new LineSegmenter({ minLineHeight: 5, linePadding: padding });
    const linePositions = [{ start: 30, end: 50 }];
    const imageData = createTestImageWithLines(200, 100, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(1);
    expect(segments[0].top).toBe(30 - padding);
    expect(segments[0].bottom).toBe(50 + padding);
  });

  it('clamps padding to image bounds', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 5, linePadding: 50 });
    const linePositions = [{ start: 10, end: 20 }];
    const imageData = createTestImageWithLines(200, 50, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(1);
    expect(segments[0].top).toBe(0);
    expect(segments[0].bottom).toBe(49); // height - 1
  });

  it('isMultiline returns false for very wide single-line images', () => {
    const segmenter = new LineSegmenter();
    const linePositions = [{ start: 5, end: 15 }];
    const imageData = createTestImageWithLines(400, 20, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(false);
  });

  it('isMultiline returns true for tall images with multiple lines', () => {
    const segmenter = new LineSegmenter();
    const linePositions = [
      { start: 20, end: 40 },
      { start: 80, end: 100 },
    ];
    const imageData = createTestImageWithLines(200, 150, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(true);
  });

  it('isMultiline returns true for tall images based on aspect ratio', () => {
    const segmenter = new LineSegmenter();
    // Tall image that should trigger multiline detection
    const linePositions = [{ start: 20, end: 180 }];
    const imageData = createTestImageWithLines(100, 200, linePositions);

    expect(segmenter.isMultiline(imageData)).toBe(true);
  });

  it('extracts correct pixel data for each line', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 5, linePadding: 0 });
    const width = 100;
    const height = 60;
    const linePositions = [{ start: 20, end: 30 }];
    const imageData = createTestImageWithLines(width, height, linePositions);

    const lines = segmenter.extractLines(imageData);

    expect(lines).toHaveLength(1);
    expect(lines[0].width).toBe(width);
    expect(lines[0].height).toBe(11); // 30 - 20 + 1

    // Verify the extracted line contains dark pixels (the text)
    let hasDarkPixels = false;
    for (let i = 0; i < lines[0].data.length; i += 4) {
      if (lines[0].data[i] < 128) {
        hasDarkPixels = true;
        break;
      }
    }
    expect(hasDarkPixels).toBe(true);
  });

  it('returns original image when single line covers most of image', () => {
    const segmenter = new LineSegmenter({ linePadding: 0 });
    // Line covers >80% of image height
    const linePositions = [{ start: 5, end: 85 }];
    const imageData = createTestImageWithLines(200, 100, linePositions);

    const lines = segmenter.extractLines(imageData);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(imageData);
  });

  it('handles three or more lines correctly', () => {
    const segmenter = new LineSegmenter({ minLineHeight: 5, minGapHeight: 5, linePadding: 0 });
    const linePositions = [
      { start: 10, end: 25 },
      { start: 50, end: 65 },
      { start: 90, end: 105 },
    ];
    const imageData = createTestImageWithLines(200, 130, linePositions);
    const segments = segmenter.detectLines(imageData);

    expect(segments).toHaveLength(3);
    expect(segments[0].top).toBe(10);
    expect(segments[1].top).toBe(50);
    expect(segments[2].top).toBe(90);
  });
});

describe('LineSegmenter customization', () => {
  it('respects custom ink threshold', () => {
    // Create image with gray pixels (value 180)
    const width = 100;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    // Add gray line at y=20-30
    for (let y = 20; y < 30; y++) {
      for (let x = 10; x < 90; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 180;
        data[idx + 1] = 180;
        data[idx + 2] = 180;
      }
    }

    const imageData = new ImageData(data, width, height);

    // With default threshold (200), gray pixels are "ink"
    const segmenter1 = new LineSegmenter({ inkThreshold: 200, linePadding: 0 });
    const segments1 = segmenter1.detectLines(imageData);
    expect(segments1.length).toBeGreaterThan(0);

    // With lower threshold (150), gray pixels are background
    const segmenter2 = new LineSegmenter({ inkThreshold: 150, linePadding: 0 });
    const segments2 = segmenter2.detectLines(imageData);
    expect(segments2).toHaveLength(0);
  });

  it('respects custom minRowInkPercent', () => {
    const segmenter = new LineSegmenter({ minRowInkPercent: 50, linePadding: 0 });
    const width = 100;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with white
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    // Add sparse dark pixels (only 10% of width)
    for (let y = 20; y < 30; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      }
    }

    const imageData = new ImageData(data, width, height);
    const segments = segmenter.detectLines(imageData);

    // Should not detect line because ink coverage is too low
    expect(segments).toHaveLength(0);
  });
});
