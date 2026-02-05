import { OCRItem } from '../types/ocr-engine';

/**
 * Thresholds for grouping OCR items into lines and paragraphs.
 * 
 * LINE_CENTER_THRESHOLD: Max vertical distance between centers as a fraction of line height.
 * LINE_OVERLAP_THRESHOLD: Min vertical overlap as a fraction of item height.
 * PARAGRAPH_GAP_THRESHOLD: Max vertical gap between lines as a fraction of average line height.
 */
const LINE_CENTER_THRESHOLD = 0.4;
const LINE_OVERLAP_THRESHOLD = 0.5;
const PARAGRAPH_GAP_THRESHOLD = 1.5;

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

    // Threshold: if gap is more than threshold * average line height, start new paragraph
    // Or if the gap is negative (lines overlap horizontally but were split vertically), keep them together
    if (gap > avgLineHeight * PARAGRAPH_GAP_THRESHOLD) {
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

export type OCRParagraphRegion = OCRLine;

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
  return lineGroups
    .map((line) => {
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
    })
    .sort((a, b) => a.boundingBox.y - b.boundingBox.y);
}

/**
 * Groups OCR items into paragraph regions.
 * Reuses the line grouping logic and merges lines into paragraphs based on vertical gaps.
 */
export function groupOcrItemsIntoParagraphs(items: OCRItem[]): OCRParagraphRegion[] {
  const lines = groupOcrItemsIntoLines(items);
  if (lines.length === 0) return [];

  // Estimate average line height for thresholding
  const lineHeights = lines.map((l) => l.boundingBox.height);
  const avgLineHeight = lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length;

  const paragraphs: OCRParagraphRegion[] = [];
  // Start with the first line to avoid index-undefined checks inside loop
  let currentLines: OCRLine[] = [lines[0]!];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const prevLine = lines[i - 1]!;
    const gap = line.boundingBox.y - (prevLine.boundingBox.y + prevLine.boundingBox.height);

    // If gap is more than threshold * average line height, start new paragraph
    if (gap > avgLineHeight * PARAGRAPH_GAP_THRESHOLD) {
      paragraphs.push(mergeLinesToRegion(currentLines));
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  paragraphs.push(mergeLinesToRegion(currentLines));

  return paragraphs;
}

/**
 * Merges multiple OCR lines into a single region.
 */
function mergeLinesToRegion(lines: OCRLine[]): OCRParagraphRegion {
  const text = lines.map((l) => l.text).join(' ');
  const items = lines.flatMap((l) => l.items);

  const minX = Math.min(...lines.map((l) => l.boundingBox.x));
  const minY = Math.min(...lines.map((l) => l.boundingBox.y));
  const maxX = Math.max(...lines.map((l) => l.boundingBox.x + l.boundingBox.width));
  const maxY = Math.max(...lines.map((l) => l.boundingBox.y + l.boundingBox.height));

  return {
    text,
    boundingBox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    items,
  };
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

  // If centers are within threshold of the larger height, likely same line
  const maxH = Math.max(box1.height, box2.height);
  if (Math.abs(center1 - center2) < maxH * LINE_CENTER_THRESHOLD) {
    return true;
  }

  // Or if vertical overlap is > threshold of the smaller height
  const overlapTop = Math.max(box1.y, box2.y);
  const overlapBottom = Math.min(box1.y + box1.height, box2.y + box2.height);
  const overlap = Math.max(0, overlapBottom - overlapTop);
  const minH = Math.min(box1.height, box2.height);

  return overlap > minH * LINE_OVERLAP_THRESHOLD;
}

