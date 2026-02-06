import type { OCRParagraphRegion, OCRWriteBackLineRegion } from './paragraph-grouping';
import { getMedian } from './math-utils';

export interface WriteBackOptions {
  fontSizeFactor?: number; // scale factor for font size relative to box height (fallback if original size cannot be detected)
  minFontSize?: number;
  maxFontSize?: number; // manual override for maximum font size
  fontFamily?: string;
  fillOpacity?: number;
  paddingFactor?: number; // padding inside the bounding box (default 0.1)
  lineSpacing?: number;
  eraseMode?: 'fill' | 'inpaint-auto';
  maskDilationPx?: number;
  textHalo?: boolean;
  haloColor?: string;
  onRegionRendered?: (metrics: WriteBackRegionMetrics) => void;
}

export interface WriteBackRegionMetrics {
  regionIndex: number;
  sourceText: string;
  translatedText: string;
  sampledBackgroundColor: string;
  chosenTextColor: string;
  chosenFontSize: number;
  lineCount: number;
  overflow: boolean;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  rotationDegrees: number;
  eraseModeUsed: 'fill' | 'inpaint';
  textDirection: CanvasDirection;
}

type WriteBackRegion = (OCRParagraphRegion | OCRWriteBackLineRegion) & { translatedText: string };
type ScaledRegion = WriteBackRegion & {
  scaledBox: { x: number; y: number; width: number; height: number };
  scaledContainerBox: { x: number; width: number };
};

/**
 * Renders translated text onto a canvas containing the original image.
 * Uses a solid background fill sampled from the original pixels.
 */
export function renderTranslationToImage(
  canvas: HTMLCanvasElement,
  regions: WriteBackRegion[],
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
    eraseMode = 'fill',
    maskDilationPx = 2,
    textHalo = false,
  } = options;

  const scaledRegions: ScaledRegion[] = regions.map((region) => {
    const { x, y, width, height } = region.boundingBox;
    const containerBox = 'containerBox' in region ? region.containerBox : region.boundingBox;
    return {
      ...region,
      scaledBox: {
        x: x * scaleX,
        y: y * scaleY,
        width: width * scaleX,
        height: height * scaleY,
      },
      scaledContainerBox: {
        x: containerBox.x * scaleX,
        width: containerBox.width * scaleX,
      },
    };
  });

  const usingInpaint =
    eraseMode === 'inpaint-auto' &&
    tryInpaintWithOpenCv(canvas, buildWriteBackMask(canvas.width, canvas.height, scaledRegions, maskDilationPx));

  for (const [regionIndex, region] of scaledRegions.entries()) {
    const sx = region.scaledBox.x;
    const sy = region.scaledBox.y;
    const sw = region.scaledBox.width;
    const sh = region.scaledBox.height;

    if (sw <= 0 || sh <= 0) continue;

    // Sample BEFORE filling so we read original pixels
    const bgColor = sampleBackgroundColor(ctx, sx, sy, sw, sh);

    if (!usingInpaint) {
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = bgColor;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1.0;
    }

    // 3. Draw translated text
    const textAlign = inferTextAlign(
      {
        x: sx,
        y: sy,
        width: sw,
        height: sh,
      },
      {
        x: region.scaledContainerBox.x,
        y: sy,
        width: region.scaledContainerBox.width,
        height: sh,
      }
    );
    const cx = region.scaledContainerBox.x;
    const cw = region.scaledContainerBox.width;
    const textColor = getContrastColor(bgColor);
    const textDirection = inferTextDirection(region.translatedText);
    ctx.fillStyle = textColor;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'alphabetic';
    ctx.direction = textDirection;

    // Estimate original font size based on median item height
    // We use this as a hard upper bound so the translation doesn't look bigger than original text
    const itemHeights = region.items.map((i) => i.boundingBox.height * scaleY);
    const medianItemHeight = itemHeights.length > 0 ? getMedian(itemHeights) : sh * fontSizeFactor;
    const baseFontSize = options.maxFontSize ?? Math.max(minFontSize, Math.round(medianItemHeight));

    // Determine the best font size that fits the box (binary search fit)
    const maxWidth = cw * (1 - paddingFactor);
    const maxHeight = sh * (1 - paddingFactor);
    const {
      fontSize: fittingFontSize,
      lines: fittingLines,
      overflow,
    } = fitTextToBox(
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
    const fittedLineMetrics = getLineMetrics(ctx, fittingFontSize, lineSpacing);
    const totalTextHeight = getTextBlockHeight(fittingLines.length, fittedLineMetrics);
    const topInset = (sh - totalTextHeight) / 2;
    const firstBaselineY = sy + topInset + fittedLineMetrics.ascent;
    const horizontalPadding = cw * paddingFactor * 0.5;
    const drawX = getAlignedX(textAlign, cx, cw, horizontalPadding);
    const rotationDegrees = inferRegionRotationDegrees(region.items);
    if (Math.abs(rotationDegrees) > 0.01) {
      const pivotX = sx + sw / 2;
      const pivotY = sy + sh / 2;
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate((rotationDegrees * Math.PI) / 180);
      fittingLines.forEach((line, i) => {
        const lineY = firstBaselineY + i * fittedLineMetrics.advance;
        if (textHalo) {
          ctx.strokeStyle = options.haloColor ?? getHaloColor(textColor);
          ctx.lineWidth = Math.max(1, fittingFontSize * 0.08);
          ctx.lineJoin = 'round';
          ctx.strokeText(line, drawX - pivotX, lineY - pivotY);
        }
        ctx.fillText(line, drawX - pivotX, lineY - pivotY);
      });
      ctx.restore();
    } else {
      fittingLines.forEach((line, i) => {
        const lineY = firstBaselineY + i * fittedLineMetrics.advance;
        if (textHalo) {
          ctx.strokeStyle = options.haloColor ?? getHaloColor(textColor);
          ctx.lineWidth = Math.max(1, fittingFontSize * 0.08);
          ctx.lineJoin = 'round';
          ctx.strokeText(line, drawX, lineY);
        }
        ctx.fillText(line, drawX, lineY);
      });
    }

    options.onRegionRendered?.({
      regionIndex,
      sourceText: region.text,
      translatedText: region.translatedText,
      sampledBackgroundColor: bgColor,
      chosenTextColor: textColor,
      chosenFontSize: fittingFontSize,
      lineCount: fittingLines.length,
      overflow,
      textAlign,
      textBaseline: 'alphabetic',
      rotationDegrees,
      eraseModeUsed: usingInpaint ? 'inpaint' : 'fill',
      textDirection,
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
): { fontSize: number; lines: string[]; overflow: boolean } {
  let low = minFontSize;
  let high = maxFontSize;
  let bestFontSize = minFontSize;
  let bestLines = wrapText(ctx, text, maxWidth, `${minFontSize}px ${fontFamily}`);

  // If even the min font size doesn't fit height-wise, we just return it and let it overflow or be cut
  const minLines = bestLines;
  const minMetrics = getLineMetrics(ctx, minFontSize, lineSpacing);
  const minHeight = getTextBlockHeight(minLines.length, minMetrics);
  let overflow = minHeight > maxHeight;

  // Binary search for the largest font size that fits
  for (let i = 0; i < 10; i++) {
    // 10 iterations is enough for sub-pixel precision in common ranges
    if (high - low < 0.5) break;

    const mid = (low + high) / 2;
    ctx.font = `${mid}px ${fontFamily}`;
    const lines = wrapText(ctx, text, maxWidth, ctx.font);
    const lineMetrics = getLineMetrics(ctx, mid, lineSpacing);
    const totalHeight = getTextBlockHeight(lines.length, lineMetrics);
    const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);

    if (totalHeight <= maxHeight && maxLineWidth <= maxWidth) {
      bestFontSize = mid;
      bestLines = lines;
      low = mid;
    } else {
      high = mid;
    }
  }

  const fittedFontSize = Math.floor(bestFontSize);
  ctx.font = `${fittedFontSize}px ${fontFamily}`;
  const fittedLines = wrapText(ctx, text, maxWidth, ctx.font);
  const fittedMetrics = getLineMetrics(ctx, fittedFontSize, lineSpacing);
  const totalHeight = getTextBlockHeight(fittedLines.length, fittedMetrics);
  const maxLineWidth = fittedLines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  overflow = overflow || maxLineWidth > maxWidth || totalHeight > maxHeight;

  return { fontSize: fittedFontSize, lines: fittedLines, overflow };
}

function inferTextAlign(
  lineBox: OCRParagraphRegion['boundingBox'],
  containerBox: OCRParagraphRegion['boundingBox']
): CanvasTextAlign {
  const leftMargin = lineBox.x - containerBox.x;
  const rightMargin =
    containerBox.x + containerBox.width - (lineBox.x + lineBox.width);
  const diff = Math.abs(leftMargin - rightMargin);
  const tolerance = containerBox.width * 0.12;

  if (diff <= tolerance) {
    return 'center';
  }
  if (rightMargin < leftMargin) {
    return 'right';
  }
  return 'left';
}

function getAlignedX(
  textAlign: CanvasTextAlign,
  x: number,
  width: number,
  horizontalPadding: number
): number {
  if (textAlign === 'right' || textAlign === 'end') {
    return x + width - horizontalPadding;
  }
  if (textAlign === 'center') {
    return x + width / 2;
  }
  return x + horizontalPadding;
}

function getLineMetrics(
  ctx: CanvasRenderingContext2D,
  fontSize: number,
  lineSpacing: number
): { ascent: number; descent: number; advance: number } {
  const sample = ctx.measureText('Hg');
  const ascent = sample.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = sample.actualBoundingBoxDescent || fontSize * 0.2;
  const rawLineHeight = Math.max(1, ascent + descent);
  return {
    ascent,
    descent,
    advance: rawLineHeight * lineSpacing,
  };
}

function getTextBlockHeight(
  lineCount: number,
  lineMetrics: { ascent: number; descent: number; advance: number }
): number {
  if (lineCount <= 0) {
    return 0;
  }
  return lineMetrics.ascent + lineMetrics.descent + (lineCount - 1) * lineMetrics.advance;
}

function inferRegionRotationDegrees(items: OCRParagraphRegion['items']): number {
  const angles: number[] = [];
  for (const item of items) {
    if (typeof item.angle === 'number' && Number.isFinite(item.angle)) {
      angles.push(normalizeAngle(item.angle));
      continue;
    }

    if (item.quad && item.quad.length === 4) {
      const [p0, p1] = item.quad;
      const radians = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      angles.push(normalizeAngle((radians * 180) / Math.PI));
    }
  }

  if (angles.length === 0) {
    return 0;
  }
  return getMedian(angles);
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > 90) {
    normalized -= 180;
  }
  while (normalized < -90) {
    normalized += 180;
  }
  return normalized;
}

export function buildWriteBackMask(
  width: number,
  height: number,
  regions: Array<{ scaledBox: { x: number; y: number; width: number; height: number } }>,
  dilationPx: number
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  const dilation = Math.max(0, Math.floor(dilationPx));

  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.scaledBox.x) - dilation);
    const y0 = Math.max(0, Math.floor(region.scaledBox.y) - dilation);
    const x1 = Math.min(width - 1, Math.ceil(region.scaledBox.x + region.scaledBox.width) + dilation);
    const y1 = Math.min(height - 1, Math.ceil(region.scaledBox.y + region.scaledBox.height) + dilation);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        mask[y * width + x] = 255;
      }
    }
  }

  return mask;
}

function tryInpaintWithOpenCv(
  canvas: HTMLCanvasElement,
  mask: Uint8ClampedArray
): boolean {
  const cvMaybe = (globalThis as { cv?: unknown }).cv;
  if (!cvMaybe || typeof cvMaybe !== 'object') {
    return false;
  }

  const cv = cvMaybe as {
    imread?: (source: HTMLCanvasElement, mode?: number) => unknown;
    imshow?: (target: HTMLCanvasElement, mat: unknown) => void;
    inpaint?: (src: unknown, mask: unknown, dst: unknown, radius: number, method: number) => void;
    Mat?: new () => { delete?: () => void };
    INPAINT_TELEA?: number;
    IMREAD_GRAYSCALE?: number;
  };

  if (
    typeof cv.imread !== 'function' ||
    typeof cv.imshow !== 'function' ||
    typeof cv.inpaint !== 'function' ||
    typeof cv.Mat !== 'function'
  ) {
    return false;
  }

  let src: { delete?: () => void } | undefined;
  let maskMat: { delete?: () => void } | undefined;
  let dst: { delete?: () => void } | undefined;
  let maskCanvas: HTMLCanvasElement | undefined;

  try {
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return false;

    const rgba = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    for (let i = 0; i < mask.length; i++) {
      const value = mask[i] ?? 0;
      const offset = i * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
    maskCtx.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);

    src = cv.imread(canvas) as { delete?: () => void };
    maskMat = cv.imread(maskCanvas, cv.IMREAD_GRAYSCALE ?? 0) as { delete?: () => void };
    dst = new cv.Mat();
    cv.inpaint(src, maskMat, dst, 3, cv.INPAINT_TELEA ?? 1);
    cv.imshow(canvas, dst);
    return true;
  } catch {
    return false;
  } finally {
    src?.delete?.();
    maskMat?.delete?.();
    dst?.delete?.();
  }
}

function sampleBackgroundColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string {
  try {
    const margin = Math.max(2, Math.min(w, h) * 0.05);
    const samples: [number, number, number][] = [];
    const points: [number, number][] = [
      [x - margin, y - margin],
      [x + w + margin, y - margin],
      [x - margin, y + h + margin],
      [x + w + margin, y + h + margin],
      [x + w / 2, y - margin],
      [x + w / 2, y + h + margin],
      [x - margin, y + h / 2],
      [x + w + margin, y + h / 2],
    ];

    for (const [px, py] of points) {
      const clampedX = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(px)));
      const clampedY = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(py)));
      const data = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      samples.push([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
    }

    const medianR = Math.round(getMedian(samples.map(s => s[0])));
    const medianG = Math.round(getMedian(samples.map(s => s[1])));
    const medianB = Math.round(getMedian(samples.map(s => s[2])));

    return `rgb(${medianR}, ${medianG}, ${medianB})`;
  } catch (e) {
    return 'white';
  }
}

function getContrastColor(rgbStr: string): string {
  const match = rgbStr.match(/\d+/g);
  if (!match) return 'black';
  const [r = 0, g = 0, b = 0] = match.map(Number);
  const contrastWhite = getContrastRatio(r, g, b, 255, 255, 255);
  const contrastBlack = getContrastRatio(r, g, b, 0, 0, 0);
  return contrastWhite >= contrastBlack ? 'white' : 'black';
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

    const tokens = tokenizeParagraph(paragraph);
    let currentLine = '';

    for (const token of tokens) {
      const separator = currentLine && token.joinWithSpace ? ' ' : '';
      const testLine = currentLine ? currentLine + separator + token.value : token.value;
      const metrics = ctx.measureText(testLine);

      if (metrics.width <= maxWidth || !currentLine) {
        currentLine = testLine;
      } else {
        allLines.push(currentLine);
        currentLine = token.value;
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

function tokenizeParagraph(paragraph: string): Array<{ value: string; joinWithSpace: boolean }> {
  if (/\s/.test(paragraph)) {
    return paragraph
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => ({ value: token, joinWithSpace: true }));
  }

  return Array.from(paragraph).map((value) => ({ value, joinWithSpace: false }));
}

function inferTextDirection(text: string): CanvasDirection {
  // Basic RTL detection for Arabic/Hebrew ranges.
  if (/[\u0590-\u08FF]/.test(text)) {
    return 'rtl';
  }
  return 'ltr';
}

function getHaloColor(textColor: string): string {
  return textColor === 'black' ? 'white' : 'black';
}

function getContrastRatio(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const l1 = getRelativeLuminance(r1, g1, b1);
  const l2 = getRelativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const rs = toLinearChannel(r);
  const gs = toLinearChannel(g);
  const bs = toLinearChannel(b);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}
