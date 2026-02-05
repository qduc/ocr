import { OCRLine } from './paragraph-grouping';

export interface WriteBackOptions {
  fontSizeFactor?: number; // scale factor for font size relative to box height
  minFontSize?: number;
  fontFamily?: string;
  fillOpacity?: number;
}

/**
 * Renders translated text onto a canvas containing the original image.
 * Uses a solid background fill sampled from the original pixels.
 */
export function renderTranslationToImage(
  canvas: HTMLCanvasElement,
  regions: Array<OCRLine & { translatedText: string }>,
  scaleX: number,
  scaleY: number,
  options: WriteBackOptions = {}
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const {
    fontSizeFactor = 0.7,
    minFontSize = 8,
    fontFamily = "'Space Grotesk', system-ui, sans-serif",
    fillOpacity = 1.0,
  } = options;

  for (const region of regions) {
    const { x, y, width, height } = region.boundingBox;
    
    // Scale coordinates to original image size
    const sx = x * scaleX;
    const sy = y * scaleY;
    const sw = width * scaleX;
    const sh = height * scaleY;

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
    
    // Estimate font size based on box height or width
    const fontSize = Math.max(minFontSize, Math.round(sh * fontSizeFactor));
    ctx.font = `${fontSize}px ${fontFamily}`;

    const lines = wrapText(ctx, region.translatedText, sw * 0.9);
    const lineSpacing = 1.2;
    const totalHeight = lines.length * fontSize * lineSpacing;
    
    // If text is too tall, shrink font size
    let currentFontSize = fontSize;
    let currentLines = lines;
    if (totalHeight > sh * 0.9 && currentFontSize > minFontSize) {
      currentFontSize = Math.max(minFontSize, Math.round(currentFontSize * (sh * 0.9 / totalHeight)));
      ctx.font = `${currentFontSize}px ${fontFamily}`;
      currentLines = wrapText(ctx, region.translatedText, sw * 0.9);
    }

    const startY = sy + sh / 2 - ((currentLines.length - 1) * currentFontSize * lineSpacing) / 2;
    
    currentLines.forEach((line, i) => {
      ctx.fillText(line, sx + sw / 2, startY + i * currentFontSize * lineSpacing);
    });
  }
}

function sampleBackgroundColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string {
  // Sample a few points around the box to guess background
  // Simple approach: sample the corners and edges
  try {
    const samples: [number, number, number][] = [];
    const points: [number, number][] = [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]
    ];

    for (const [px, py] of points) {
      const clampedX = Math.max(0, Math.min(ctx.canvas.width - 1, px));
      const clampedY = Math.max(0, Math.min(ctx.canvas.height - 1, py));
      const data = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      samples.push([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
    }

    // Use median or average. Median is better against outliers (text pixels)
    const avgR = Math.round(samples.reduce((sum, s) => sum + s[0], 0) / samples.length);
    const avgG = Math.round(samples.reduce((sum, s) => sum + s[1], 0) / samples.length);
    const avgB = Math.round(samples.reduce((sum, s) => sum + s[2], 0) / samples.length);

    return `rgb(${avgR}, ${avgG}, ${avgB})`;
  } catch (e) {
    // Fallback if getImageData fails (e.g. tainted canvas)
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = words[0] || '';

  for (const word of words.slice(1)) {
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}
