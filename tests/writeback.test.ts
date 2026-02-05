/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { groupOcrItemsIntoLines } from '../src/utils/paragraph-grouping';
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
