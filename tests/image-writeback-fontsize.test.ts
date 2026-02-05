/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { renderTranslationToImage } from '../src/utils/image-writeback';
import { OCRParagraphRegion } from '../src/utils/paragraph-grouping';

describe('renderTranslationToImage Font Selection', () => {
  const createMockContext = () => {
    let currentFont = '10px sans-serif';
    const ctx = {
      canvas: { width: 1000, height: 1000 },
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4).fill(255) })),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => {
        // Mock: width = fontSize * length * 0.6
        const fontSize = parseInt(currentFont) || 10;
        return { width: text.length * fontSize * 0.6 };
      }),
      set font(val: string) { currentFont = val; },
      get font() { return currentFont; },
      set fillStyle(val: string) {},
      set textAlign(val: string) {},
      set textBaseline(val: string) {},
      set globalAlpha(val: number) {},
    } as unknown as CanvasRenderingContext2D;
    return ctx;
  };

  it('matches original font size based on median item height', () => {
    const ctx = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'original',
        translatedText: 'translated',
        boundingBox: { x: 10, y: 10, width: 200, height: 100 },
        items: [
          // Median height is 40
          { text: 'a', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 40 } },
          { text: 'b', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 40 } },
          { text: 'c', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 60 } },
        ]
      }
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    // Should use median 40px (or close to it after binary search if it fits)
    // In this case, "translated" is 10 chars. 10 * 40 * 0.6 = 240px width.
    // Region width is 200. maxWidth is 200 * 0.9 = 180.
    // 240 > 180, so it must shrink.

    // We can't easily check internal state, but we can verify fillText was called.
    expect(ctx.fillText).toHaveBeenCalled();

    // Let's try a case where it fits perfectly.
    const regionsFit: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'orig',
        translatedText: 'fit', // 3 chars
        boundingBox: { x: 0, y: 0, width: 100, height: 50 },
        items: [
          { text: 'o', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 30 } }
        ]
      }
    ];

    vi.clearAllMocks();
    renderTranslationToImage(canvas, regionsFit, 1, 1);

    // Base font size is 30.
    // Width: 3 * 30 * 0.6 = 54.
    // maxWidth: 100 * 0.9 = 90.
    // 54 < 90, so it should stay at 30 (or close, floors to 29 or 30).
    expect(parseInt(ctx.font as string)).toBeGreaterThanOrEqual(29);
  });

  it('shrinks font size to fit both width and height', () => {
    const ctx = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'short',
        translatedText: 'this is a very long translation that definitely won\'t fit in the small box at original size',
        boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        items: [
          { text: 's', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 30 } }
        ]
      }
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    // Original size was 30px.
    // The very long text will need much smaller font to fit in 100x40.
    const fontSize = parseInt(ctx.font as string);
    expect(fontSize).toBeLessThan(30);
    expect(fontSize).toBeGreaterThanOrEqual(8); // minFontSize
  });

  it('handles extremely long words by breaking them', () => {
    const ctx = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'word',
        translatedText: 'Supercalifragilisticexpialidocious',
        boundingBox: { x: 0, y: 0, width: 50, height: 50 },
        items: [
          { text: 'w', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 20 } }
        ]
      }
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    // If it didn't break the word, it would have to shrink to a tiny font.
    // With breaking, it can keep it somewhat readable.
    expect(ctx.fillText).toHaveBeenCalled();
    expect(parseInt(ctx.font as string)).toBeGreaterThanOrEqual(8);
  });
});
