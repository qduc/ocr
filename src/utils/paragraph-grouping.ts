import { OCRItem } from '../types/ocr-engine';

/**
 * Groups OCR items into paragraphs and returns a single formatted string.
 * Lines are joined with spaces, and paragraphs are separated by double newlines.
 *
 * This implementation uses a simple heuristic based on bounding box geometry:
 * 1. Items are grouped into lines based on vertical overlap.
 * 2. Lines are sorted internally by x-coordinate.
 * 3. Lines are grouped into paragraphs based on vertical gaps.
 */
export function buildParagraphTextForTranslation(items: OCRItem[]): string {
  const filteredItems = items
    .filter((item) => item.text && item.text.trim().length > 0)
    .map((item) => ({
      ...item,
      text: item.text.trim().replace(/\s+/g, ' '),
    }));

  if (filteredItems.length === 0) {
    return '';
  }

  // 1. Group items into lines
  // Sort primarily by Y center
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aCenterY = a.boundingBox.y + a.boundingBox.height / 2;
    const bCenterY = b.boundingBox.y + b.boundingBox.height / 2;
    return aCenterY - bCenterY;
  });

  const lines: OCRItem[][] = [];
  for (const item of sortedItems) {
    let placed = false;
    for (const line of lines) {
      if (isInSameLine(item, line[0]!)) {
        line.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lines.push([item]);
    }
  }

  // 2. Sort lines by Y and sort items within lines by X
  lines.forEach((line) => line.sort((a, b) => a.boundingBox.x - b.boundingBox.x));
  lines.sort((a, b) => {
    const aY = a[0]!.boundingBox.y;
    const bY = b[0]!.boundingBox.y;
    return aY - bY;
  });

  // 3. Group lines into paragraphs
  if (lines.length === 0) return '';

  const paragraphs: string[][] = [];
  let currentParagraph: string[] = [];

  // Estimate median line height for thresholding
  const lineHeights = lines.map(line => {
    const minY = Math.min(...line.map(i => i.boundingBox.y));
    const maxY = Math.max(...line.map(i => i.boundingBox.y + i.boundingBox.height));
    return maxY - minY;
  });
  const avgLineHeight = lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!.map((item) => item.text).join(' ');

    if (i === 0) {
      currentParagraph.push(lineText);
      continue;
    }

    const prevLine = lines[i - 1]!;
    const currLine = lines[i]!;

    const prevLineBottom = Math.max(...prevLine.map(item => item.boundingBox.y + item.boundingBox.height));
    const currLineTop = Math.min(...currLine.map(item => item.boundingBox.y));
    const gap = currLineTop - prevLineBottom;

    // Threshold: if gap is more than ~1.5x average line height, start new paragraph
    // Or if the gap is negative (lines overlap horizontally but were split vertically), keep them together
    if (gap > avgLineHeight * 1.5) {
      paragraphs.push(currentParagraph);
      currentParagraph = [lineText];
    } else {
      currentParagraph.push(lineText);
    }
  }
  paragraphs.push(currentParagraph);

  return paragraphs
    .map((p) => p.join(' '))
    .join('\n\n');
}

export interface OCRLine {
  text: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  items: OCRItem[];
}

/**
 * Groups OCR items into lines and computes a union bounding box for each line.
 * Useful for region-based translation and write-back.
 */
export function groupOcrItemsIntoLines(items: OCRItem[]): OCRLine[] {
  const filteredItems = items.filter((item) => item.text && item.text.trim().length > 0);

  if (filteredItems.length === 0) {
    return [];
  }

  // 1. Group items into lines
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aCenterY = a.boundingBox.y + a.boundingBox.height / 2;
    const bCenterY = b.boundingBox.y + b.boundingBox.height / 2;
    return aCenterY - bCenterY;
  });

  const lineGroups: OCRItem[][] = [];
  for (const item of sortedItems) {
    let placed = false;
    for (const line of lineGroups) {
      if (isInSameLine(item, line[0]!)) {
        line.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lineGroups.push([item]);
    }
  }

  // 2. Sort items within lines by X and build OCRLine objects
  return lineGroups.map((line) => {
    line.sort((a, b) => a.boundingBox.x - b.boundingBox.x);
    
    const text = line.map((item) => item.text).join(' ');

    const minX = Math.min(...line.map((i) => i.boundingBox.x));
    const minY = Math.min(...line.map((i) => i.boundingBox.y));
    const maxX = Math.max(...line.map((i) => i.boundingBox.x + i.boundingBox.width));
    const maxY = Math.max(...line.map((i) => i.boundingBox.y + i.boundingBox.height));

    return {
      text,
      boundingBox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
      items: line,
    };
  }).sort((a, b) => a.boundingBox.y - b.boundingBox.y);
}

/**
 * Heuristic to check if two items are on the same line.
 * They are considered on same line if their vertical centers are close,
 * or if they have significant vertical overlap.
 */
function isInSameLine(item1: OCRItem, item2: OCRItem): boolean {
  const box1 = item1.boundingBox;
  const box2 = item2.boundingBox;

  const center1 = box1.y + box1.height / 2;
  const center2 = box2.y + box2.height / 2;

  // If centers are within 25% of the larger height, likely same line
  const maxH = Math.max(box1.height, box2.height);
  if (Math.abs(center1 - center2) < maxH * 0.4) {
    return true;
  }

  // Or if vertical overlap is > 50% of the smaller height
  const overlapTop = Math.max(box1.y, box2.y);
  const overlapBottom = Math.min(box1.y + box1.height, box2.y + box2.height);
  const overlap = Math.max(0, overlapBottom - overlapTop);
  const minH = Math.min(box1.height, box2.height);

  return overlap > minH * 0.5;
}
