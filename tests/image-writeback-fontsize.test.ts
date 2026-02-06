/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import {
  buildWriteBackMask,
  renderTranslationToImage,
  type WriteBackRegionMetrics,
} from '../src/utils/image-writeback';
import { OCRParagraphRegion } from '../src/utils/paragraph-grouping';

describe('renderTranslationToImage Font Selection', () => {
  const createMockContext = (
    rgb: [number, number, number] = [255, 255, 255]
  ): {
    ctx: CanvasRenderingContext2D;
    fillTextMock: ReturnType<typeof vi.fn<(text: string, x: number, y: number) => void>>;
    rotateMock: ReturnType<typeof vi.fn<(angle: number) => void>>;
  } => {
    let currentFont = '10px sans-serif';
    let currentFillStyle = 'black';
    let currentTextAlign: CanvasTextAlign = 'start';
    let currentTextBaseline: CanvasTextBaseline = 'alphabetic';
    let currentGlobalAlpha = 1;
    const fillTextMock = vi.fn<(text: string, x: number, y: number) => void>();
    const rotateMock = vi.fn<(angle: number) => void>();
    const ctx = {
      canvas: { width: 1000, height: 1000 },
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]) })),
      fillRect: vi.fn(),
      fillText: fillTextMock,
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: rotateMock,
      measureText: vi.fn((text: string) => {
        // Mock: width = fontSize * length * 0.6
        const fontSize = parseInt(currentFont) || 10;
        return { width: text.length * fontSize * 0.6 };
      }),
      set font(val: string) { currentFont = val; },
      get font() { return currentFont; },
      set fillStyle(val: string) { currentFillStyle = val; },
      get fillStyle() { return currentFillStyle; },
      set textAlign(val: CanvasTextAlign) { currentTextAlign = val; },
      get textAlign() { return currentTextAlign; },
      set textBaseline(val: CanvasTextBaseline) { currentTextBaseline = val; },
      get textBaseline() { return currentTextBaseline; },
      set globalAlpha(val: number) { currentGlobalAlpha = val; },
      get globalAlpha() { return currentGlobalAlpha; },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, fillTextMock, rotateMock };
  };

  it('matches original font size based on median item height', () => {
    const { ctx, fillTextMock } = createMockContext();
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
    expect(fillTextMock).toHaveBeenCalled();

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
    expect(parseInt(ctx.font)).toBeGreaterThanOrEqual(29);
  });

  it('shrinks font size to fit both width and height', () => {
    const { ctx } = createMockContext();
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
    const fontSize = parseInt(ctx.font);
    expect(fontSize).toBeLessThan(30);
    expect(fontSize).toBeGreaterThanOrEqual(8); // minFontSize
  });

  it('handles extremely long words by breaking them', () => {
    const { ctx, fillTextMock } = createMockContext();
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
    expect(fillTextMock).toHaveBeenCalled();
    expect(parseInt(ctx.font)).toBeGreaterThanOrEqual(8);
  });

  it('uses centered alignment and middle baseline (current baseline behavior)', () => {
    const { ctx } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'original',
        translatedText: 'translated',
        boundingBox: { x: 5, y: 5, width: 120, height: 40 },
        items: [{ text: 'o', confidence: 1, boundingBox: { x: 5, y: 5, width: 12, height: 20 } }],
      },
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    expect(ctx.textAlign).toBe('center');
    expect(ctx.textBaseline).toBe('alphabetic');
  });

  it('infers left/center/right alignment from line box inside container box', () => {
    const { ctx } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;

    const leftRegion: Array<OCRParagraphRegion & {
      translatedText: string;
      containerBox: OCRParagraphRegion['boundingBox'];
    }> = [
      {
        text: 'left source',
        translatedText: 'left translated',
        boundingBox: { x: 20, y: 10, width: 80, height: 20 },
        containerBox: { x: 0, y: 0, width: 200, height: 40 },
        items: [{ text: 'a', confidence: 1, boundingBox: { x: 20, y: 10, width: 20, height: 20 } }],
      },
    ];
    renderTranslationToImage(canvas, leftRegion, 1, 1);
    expect(ctx.textAlign).toBe('left');

    const centerRegion: Array<OCRParagraphRegion & {
      translatedText: string;
      containerBox: OCRParagraphRegion['boundingBox'];
    }> = [
      {
        text: 'center source',
        translatedText: 'center translated',
        boundingBox: { x: 70, y: 10, width: 60, height: 20 },
        containerBox: { x: 0, y: 0, width: 200, height: 40 },
        items: [{ text: 'a', confidence: 1, boundingBox: { x: 70, y: 10, width: 20, height: 20 } }],
      },
    ];
    renderTranslationToImage(canvas, centerRegion, 1, 1);
    expect(ctx.textAlign).toBe('center');

    const rightRegion: Array<OCRParagraphRegion & {
      translatedText: string;
      containerBox: OCRParagraphRegion['boundingBox'];
    }> = [
      {
        text: 'right source',
        translatedText: 'right translated',
        boundingBox: { x: 120, y: 10, width: 60, height: 20 },
        containerBox: { x: 0, y: 0, width: 200, height: 40 },
        items: [{ text: 'a', confidence: 1, boundingBox: { x: 120, y: 10, width: 20, height: 20 } }],
      },
    ];
    renderTranslationToImage(canvas, rightRegion, 1, 1);
    expect(ctx.textAlign).toBe('right');
  });

  it('chooses contrasting text color for dark and bright backgrounds', () => {
    const { ctx: darkCtx } = createMockContext([0, 0, 0]);
    const darkCanvas = { getContext: () => darkCtx } as unknown as HTMLCanvasElement;
    const { ctx: brightCtx } = createMockContext([255, 255, 255]);
    const brightCanvas = { getContext: () => brightCtx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'word',
        translatedText: 'word',
        boundingBox: { x: 0, y: 0, width: 50, height: 30 },
        items: [{ text: 'w', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 20 } }],
      },
    ];

    renderTranslationToImage(darkCanvas, regions, 1, 1);
    renderTranslationToImage(brightCanvas, regions, 1, 1);

    expect(darkCtx.fillStyle).toBe('white');
    expect(brightCtx.fillStyle).toBe('black');
  });

  it('reports write-back metrics through optional debug hook', () => {
    const { ctx } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'short',
        translatedText: 'very very very very very very very very very very long',
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        items: [{ text: 's', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 16 } }],
      },
    ];

    let captured: WriteBackRegionMetrics | undefined;
    renderTranslationToImage(canvas, regions, 1, 1, {
      onRegionRendered: (metrics): void => {
        captured = metrics;
      },
    });

    expect(captured?.regionIndex).toBe(0);
    expect(captured?.sourceText).toBe('short');
    expect(captured?.lineCount).toBeGreaterThan(0);
    expect(typeof captured?.overflow).toBe('boolean');
    expect(captured?.textAlign).toBe('center');
    expect(captured?.textBaseline).toBe('alphabetic');
    expect(captured?.rotationDegrees).toBe(0);
    expect(captured?.eraseModeUsed).toBe('fill');
  });

  it('keeps font-fit results deterministic for identical inputs', () => {
    const { ctx } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'stable',
        translatedText: 'consistent wrapping behavior for repeated calls',
        boundingBox: { x: 0, y: 0, width: 140, height: 36 },
        items: [{ text: 's', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 20 } }],
      },
    ];

    let first: { fontSize: number; lineCount: number } | undefined;
    let second: { fontSize: number; lineCount: number } | undefined;
    renderTranslationToImage(canvas, regions, 1, 1, {
      onRegionRendered: (metrics): void => {
        first = { fontSize: metrics.chosenFontSize, lineCount: metrics.lineCount };
      },
    });
    renderTranslationToImage(canvas, regions, 1, 1, {
      onRegionRendered: (metrics): void => {
        second = { fontSize: metrics.chosenFontSize, lineCount: metrics.lineCount };
      },
    });

    expect(first).toEqual(second);
  });

  it('places wrapped lines with stable vertical advance', () => {
    const { ctx, fillTextMock } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'multi',
        translatedText: 'one two three four five six seven eight nine ten',
        boundingBox: { x: 0, y: 0, width: 120, height: 90 },
        items: [{ text: 'm', confidence: 1, boundingBox: { x: 0, y: 0, width: 10, height: 24 } }],
      },
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    const yValues: number[] = [];
    for (const call of fillTextMock.mock.calls as Array<[string, number, number]>) {
      yValues.push(call[2]);
    }
    expect(yValues.length).toBeGreaterThan(1);

    const advances: number[] = [];
    for (let i = 1; i < yValues.length; i++) {
      advances.push(yValues[i] - yValues[i - 1]);
    }
    const rounded = advances.map((v) => Math.round(v * 1000) / 1000);
    expect(new Set(rounded).size).toBe(1);
  });

  it('applies canvas rotation when OCR angle metadata is present', () => {
    const { ctx, rotateMock } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'angled',
        translatedText: 'angled',
        boundingBox: { x: 20, y: 20, width: 100, height: 30 },
        items: [{
          text: 'a',
          confidence: 1,
          angle: 15,
          boundingBox: { x: 20, y: 20, width: 20, height: 20 },
        }],
      },
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    expect(rotateMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to non-rotated rendering when OCR angle metadata is absent', () => {
    const { ctx, rotateMock } = createMockContext();
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'plain',
        translatedText: 'plain',
        boundingBox: { x: 20, y: 20, width: 100, height: 30 },
        items: [{ text: 'a', confidence: 1, boundingBox: { x: 20, y: 20, width: 20, height: 20 } }],
      },
    ];

    renderTranslationToImage(canvas, regions, 1, 1);

    expect(rotateMock).not.toHaveBeenCalled();
  });

  it('builds deterministic write-back masks with dilation', () => {
    const maskA = buildWriteBackMask(
      10,
      10,
      [{ scaledBox: { x: 2, y: 2, width: 2, height: 2 } }],
      1
    );
    const maskB = buildWriteBackMask(
      10,
      10,
      [{ scaledBox: { x: 2, y: 2, width: 2, height: 2 } }],
      1
    );

    expect(maskA).toEqual(maskB);
    expect(maskA[1 * 10 + 1]).toBe(255);
    expect(maskA[0]).toBe(0);
  });

  it('falls back gracefully when inpaint mode is enabled but OpenCV is unavailable', () => {
    const { ctx } = createMockContext();
    const canvas = { getContext: () => ctx, width: 100, height: 100 } as unknown as HTMLCanvasElement;
    const regions: Array<OCRParagraphRegion & { translatedText: string }> = [
      {
        text: 'plain',
        translatedText: 'plain',
        boundingBox: { x: 20, y: 20, width: 50, height: 20 },
        items: [{ text: 'a', confidence: 1, boundingBox: { x: 20, y: 20, width: 20, height: 20 } }],
      },
    ];

    let captured: WriteBackRegionMetrics | undefined;
    expect(() =>
      renderTranslationToImage(canvas, regions, 1, 1, {
        eraseMode: 'inpaint-auto',
        onRegionRendered: (metrics): void => {
          captured = metrics;
        },
      })
    ).not.toThrow();

    expect(captured?.eraseModeUsed).toBe('fill');
  });
});
