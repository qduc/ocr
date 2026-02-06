/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  groupOcrItemsIntoLines,
  groupOcrItemsIntoParagraphs,
  groupOcrItemsIntoWriteBackParagraphs,
  groupOcrItemsIntoWriteBackLines,
} from '../src/utils/paragraph-grouping';
import { OCRItem } from '../src/types/ocr-engine';

describe('groupOcrItemsIntoLines', () => {
  it('groups items into lines and computes union bounding boxes', () => {
    const items: OCRItem[] = [
      { text: 'Hello', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 50, height: 20 } },
      { text: 'World', confidence: 0.9, boundingBox: { x: 70, y: 12, width: 60, height: 18 } },
      { text: 'Next', confidence: 0.9, boundingBox: { x: 10, y: 50, width: 40, height: 20 } },
      { text: 'Line', confidence: 0.9, boundingBox: { x: 60, y: 52, width: 50, height: 16 } },
    ];

    const lines = groupOcrItemsIntoLines(items);

    expect(lines).toHaveLength(2);

    // First line
    expect(lines[0].text).toBe('Hello World');
    expect(lines[0].boundingBox.x).toBe(10);
    expect(lines[0].boundingBox.y).toBe(10);
    expect(lines[0].boundingBox.width).toBe(120); // 70 + 60 - 10
    expect(lines[0].boundingBox.height).toBe(20); // max height or union height

    // Second line
    expect(lines[1].text).toBe('Next Line');
    expect(lines[1].boundingBox.x).toBe(10);
    expect(lines[1].boundingBox.y).toBe(50);
    expect(lines[1].boundingBox.width).toBe(100); // 60 + 50 - 10
  });

  it('handles empty items', () => {
    expect(groupOcrItemsIntoLines([])).toEqual([]);
  });
});

describe('groupOcrItemsIntoParagraphs', () => {
  it('groups lines into paragraphs based on vertical gap', () => {
    const items: OCRItem[] = [
      // Paragraph 1: Two lines close together
      { text: 'Line 1', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
      { text: 'Line 2', confidence: 0.9, boundingBox: { x: 10, y: 40, width: 100, height: 20 } }, // Gap 10 ( < 20 * 1.5 )

      // Paragraph 2: Far from first
      { text: 'Para 2', confidence: 0.9, boundingBox: { x: 10, y: 100, width: 100, height: 20 } }, // Gap 40 ( > 20 * 1.5 )
    ];

    const paragraphs = groupOcrItemsIntoParagraphs(items);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].text).toBe('Line 1 Line 2');
    expect(paragraphs[0].boundingBox.height).toBe(50); // 40 + 20 - 10
    expect(paragraphs[1].text).toBe('Para 2');
  });

  it('handles empty items', () => {
    expect(groupOcrItemsIntoParagraphs([])).toEqual([]);
  });
});

describe('groupOcrItemsIntoWriteBackLines', () => {
  it('returns line regions with parent paragraph container geometry', () => {
    const items: OCRItem[] = [
      { text: 'Line 1', confidence: 0.9, boundingBox: { x: 20, y: 10, width: 100, height: 20 } },
      { text: 'Line 2', confidence: 0.9, boundingBox: { x: 30, y: 38, width: 90, height: 20 } },
      { text: 'Next', confidence: 0.9, boundingBox: { x: 10, y: 110, width: 50, height: 20 } },
    ];

    const lines = groupOcrItemsIntoWriteBackLines(items);

    expect(lines).toHaveLength(3);
    expect(lines[0].containerBox).toEqual({ x: 20, y: 10, width: 100, height: 48 });
    expect(lines[1].containerBox).toEqual({ x: 20, y: 10, width: 100, height: 48 });
    expect(lines[2].containerBox).toEqual({ x: 10, y: 110, width: 50, height: 20 });
  });

  it('handles empty items', () => {
    expect(groupOcrItemsIntoWriteBackLines([])).toEqual([]);
  });
});

describe('groupOcrItemsIntoWriteBackParagraphs', () => {
  it('keeps paragraph-level text while preserving child line geometry', () => {
    const items: OCRItem[] = [
      { text: 'Line 1', confidence: 0.9, boundingBox: { x: 20, y: 10, width: 100, height: 20 } },
      { text: 'Line 2', confidence: 0.9, boundingBox: { x: 30, y: 38, width: 90, height: 20 } },
      { text: 'Next', confidence: 0.9, boundingBox: { x: 10, y: 110, width: 50, height: 20 } },
    ];

    const paragraphs = groupOcrItemsIntoWriteBackParagraphs(items);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].text).toBe('Line 1 Line 2');
    expect(paragraphs[0].lines).toHaveLength(2);
    expect(paragraphs[0].lines[0].containerBox).toEqual({ x: 20, y: 10, width: 100, height: 48 });
    expect(paragraphs[0].lines[1].containerBox).toEqual({ x: 20, y: 10, width: 100, height: 48 });
    expect(paragraphs[1].text).toBe('Next');
    expect(paragraphs[1].lines).toHaveLength(1);
  });
});
