import { OCRParagraphRegion } from './paragraph-grouping';

export interface WriteBackOptions {
  fontSizeFactor?: number; // scale factor for font size relative to box height (fallback if original size cannot be detected)
  minFontSize?: number;
  maxFontSize?: number; // manual override for maximum font size
  fontFamily?: string;
  fillOpacity?: number;
  paddingFactor?: number; // padding inside the bounding box (default 0.1)
  lineSpacing?: number;
}

/**
 * Renders translated text onto a canvas containing the original image.
 * Uses a solid background fill sampled from the original pixels.
 */
export function renderTranslationToImage(
  canvas: HTMLCanvasElement,
  regions: Array<OCRParagraphRegion & { translatedText: string }>,
  scaleX: number,
  scaleY: number,
  options: WriteBackOptions = {}
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const {
    fontSizeFactor = 0.85,
    minFontSize = 8,
    fontFamily = "'Space Grotesk', system-ui, sans-serif",
    fillOpacity = 1.0,
    paddingFactor = 0.1,
    lineSpacing = 1.2,
  } = options;

  for (const region of regions) {
    const { x, y, width, height } = region.boundingBox;

    // Scale coordinates to original image size
    const sx = x * scaleX;
    const sy = y * scaleY;
    const sw = width * scaleX;
    const sh = height * scaleY;

    if (sw <= 0 || sh <= 0) continue;

    // 1. Sample background color
    const bgColor = sampleBackgroundColor(ctx, sx, sy, sw, sh);

    // 2. Clear original text with solid fill
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = bgColor;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.globalAlpha = 1.0;

    // 3. Draw translated text
    const textColor = getContrastColor(bgColor);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Estimate original font size based on median item height
    // We use this as a hard upper bound so the translation doesn't look bigger than original text
    const itemHeights = region.items.map((i) => i.boundingBox.height * scaleY);
    const medianItemHeight = itemHeights.length > 0 ? getMedian(itemHeights) : sh * fontSizeFactor;
    const baseFontSize = options.maxFontSize ?? Math.max(minFontSize, Math.round(medianItemHeight));

    // Determine the best font size that fits the box (binary search fit)
    const maxWidth = sw * (1 - paddingFactor);
    const maxHeight = sh * (1 - paddingFactor);
    const { fontSize: fittingFontSize, lines: fittingLines } = fitTextToBox(
      ctx,
      region.translatedText,
      maxWidth,
      maxHeight,
      minFontSize,
      baseFontSize,
      lineSpacing,
      fontFamily
    );

    ctx.font = `${fittingFontSize}px ${fontFamily}`;
    const totalTextHeight = fittingLines.length * fittingFontSize * lineSpacing;
    const startY = sy + sh / 2 - (totalTextHeight - fittingFontSize * lineSpacing) / 2;

    fittingLines.forEach((line, i) => {
      ctx.fillText(line, sx + sw / 2, startY + i * fittingFontSize * lineSpacing);
    });
  }
}

/**
 * Finds the largest font size (up to maxFontSize) that fits the given box using binary search.
 */
function fitTextToBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  minFontSize: number,
  maxFontSize: number,
  lineSpacing: number,
  fontFamily: string
): { fontSize: number; lines: string[] } {
  let low = minFontSize;
  let high = maxFontSize;
  let bestFontSize = minFontSize;
  let bestLines = wrapText(ctx, text, maxWidth, `${minFontSize}px ${fontFamily}`);

  // If even the min font size doesn't fit height-wise, we just return it and let it overflow or be cut
  const minLines = bestLines;
  const minHeight = minLines.length * minFontSize * lineSpacing;
  if (minHeight > maxHeight && minFontSize === low) {
    // Already set to best possible
  }

  // Binary search for the largest font size that fits
  for (let i = 0; i < 10; i++) {
    // 10 iterations is enough for sub-pixel precision in common ranges
    if (high - low < 0.5) break;

    const mid = (low + high) / 2;
    ctx.font = `${mid}px ${fontFamily}`;
    const lines = wrapText(ctx, text, maxWidth, ctx.font);
    const totalHeight = lines.length * mid * lineSpacing;

    if (totalHeight <= maxHeight) {
      bestFontSize = mid;
      bestLines = lines;
      low = mid;
    } else {
      high = mid;
    }
  }

  return { fontSize: Math.floor(bestFontSize), lines: bestLines };
}

function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid]!;
  }
  // even length: average middle two (assert non-undefined)
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sampleBackgroundColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string {
  // Sample a few points around the box to guess background
  try {
    const samples: [number, number, number][] = [];
    const points: [number, number][] = [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]
    ];

    for (const [px, py] of points) {
      const clampedX = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(px)));
      const clampedY = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(py)));
      const data = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      samples.push([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
    }

    const avgR = Math.round(samples.reduce((sum, s) => sum + s[0], 0) / samples.length);
    const avgG = Math.round(samples.reduce((sum, s) => sum + s[1], 0) / samples.length);
    const avgB = Math.round(samples.reduce((sum, s) => sum + s[2], 0) / samples.length);

    return `rgb(${avgR}, ${avgG}, ${avgB})`;
  } catch (e) {
    return 'white';
  }
}

function getContrastColor(rgbStr: string): string {
  const match = rgbStr.match(/\d+/g);
  if (!match) return 'black';
  const [r = 0, g = 0, b = 0] = match.map(Number);
  // YIQ luminance formula
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? 'black' : 'white';
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  const paragraphs = text.split('\n');
  const allLines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      allLines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width <= maxWidth || !currentLine) {
        currentLine = testLine;
      } else {
        allLines.push(currentLine);
        currentLine = word;
      }

      // Handle extremely long words that exceed maxWidth by themselves
      if (ctx.measureText(currentLine).width > maxWidth) {
        // Simple character-level break for long tokens
        let temp = '';
        for (const char of currentLine) {
          if (ctx.measureText(temp + char).width <= maxWidth) {
            temp += char;
          } else {
            if (temp) allLines.push(temp);
            temp = char;
          }
        }
        currentLine = temp;
      }
    }
    if (currentLine) allLines.push(currentLine);
  }

  return allLines;
}
