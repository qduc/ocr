import { describe, it, expect } from 'vitest';
import { buildParagraphTextForTranslation } from '../src/utils/paragraph-grouping';
import { OCRItem } from '../src/types/ocr-engine';

describe('buildParagraphTextForTranslation', () => {
  it('should return an empty string for an empty array', () => {
    expect(buildParagraphTextForTranslation([])).toBe('');
  });

  it('should join items on the same line with spaces', () => {
    const items: OCRItem[] = [
      { text: 'Hello', confidence: 1, boundingBox: { x: 10, y: 10, width: 40, height: 20 } },
      { text: 'World', confidence: 1, boundingBox: { x: 60, y: 10, width: 40, height: 20 } },
    ];
    expect(buildParagraphTextForTranslation(items)).toBe('Hello World');
  });

  it('should join lines into a single paragraph if the gap is small', () => {
    const items: OCRItem[] = [
      { text: 'Line 1', confidence: 1, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
      { text: 'Line 2', confidence: 1, boundingBox: { x: 10, y: 35, width: 100, height: 20 } },
    ];
    // Gap is 35 - (10 + 20) = 5. Average height is 20. 5 < 20 * 1.5 (30).
    expect(buildParagraphTextForTranslation(items)).toBe('Line 1 Line 2');
  });

  it('should start a new paragraph if the gap is large', () => {
    const items: OCRItem[] = [
      { text: 'Para 1', confidence: 1, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
      { text: 'Para 2', confidence: 1, boundingBox: { x: 10, y: 70, width: 100, height: 20 } },
    ];
    // Gap is 70 - (10 + 20) = 40. Average height is 20. 40 > 20 * 1.5 (30).
    expect(buildParagraphTextForTranslation(items)).toBe('Para 1\n\nPara 2');
  });

  it('should handle out-of-order items and sort them correctly', () => {
    const items: OCRItem[] = [
      { text: 'World', confidence: 1, boundingBox: { x: 60, y: 10, width: 40, height: 20 } },
      { text: 'Hello', confidence: 1, boundingBox: { x: 10, y: 10, width: 40, height: 20 } },
      { text: 'Paragraph', confidence: 1, boundingBox: { x: 10, y: 70, width: 100, height: 20 } },
    ];
    expect(buildParagraphTextForTranslation(items)).toBe('Hello World\n\nParagraph');
  });

  it('should ignore vertical overlap but different lines if centers are far apart', () => {
    // This tests the isInSameLine robustness.
    const items: OCRItem[] = [
      { text: 'Line 1', confidence: 1, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
      { text: 'Line 2', confidence: 1, boundingBox: { x: 10, y: 32, width: 100, height: 20 } },
    ];
    // Gap is 2 units. avgHeight is 20. This should be same paragraph but different lines internally.
    // In our implementation, we join lines with spaces for translation quality.
    expect(buildParagraphTextForTranslation(items)).toBe('Line 1 Line 2');
  });

  it('should filter out whitespace-only items', () => {
    const items: OCRItem[] = [
      { text: 'Hello', confidence: 1, boundingBox: { x: 10, y: 10, width: 40, height: 20 } },
      { text: '   ', confidence: 1, boundingBox: { x: 55, y: 10, width: 5, height: 20 } },
      { text: 'World', confidence: 1, boundingBox: { x: 65, y: 10, width: 40, height: 20 } },
    ];
    expect(buildParagraphTextForTranslation(items)).toBe('Hello World');
  });
});
