import type { TranslateImageInput, TranslateImageOptions, TranslateImageOutput } from './types';
import { buildRegions } from './regions';
import { unionBounds, rasterizeRegionsToMask, dilateMask } from './mask';
import type { Bounds } from './mask';
import { inpaintImage } from './inpaint';
import { getFontFamily, isCjkLanguage, isRtlLanguage, renderTextMasks } from './layout';
import { blendLayer, prepareTexture } from './blend';
import { createCanvas, getContext2d } from './canvas';
import { isRectQuad, warpMaskToQuad } from './warp';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const luma = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

const chooseTextColor = (avgLuma: number): [number, number, number] =>
  avgLuma > 0.55 ? [20, 20, 20] : [245, 245, 245];

const normalizeBounds = (
  bbox: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): Bounds => {
  const x = clamp(Math.floor(bbox.x), 0, imageWidth - 1);
  const y = clamp(Math.floor(bbox.y), 0, imageHeight - 1);
  const maxX = clamp(Math.ceil(bbox.x + bbox.width), x + 1, imageWidth);
  const maxY = clamp(Math.ceil(bbox.y + bbox.height), y + 1, imageHeight);
  return { x, y, width: maxX - x, height: maxY - y };
};

const addNoise = (image: ImageData, amount: number): void => {
  for (let i = 0; i < image.data.length; i += 4) {
    const noise = (Math.random() * 2 - 1) * amount;
    image.data[i] = clamp(image.data[i] + noise, 0, 255);
    image.data[i + 1] = clamp(image.data[i + 1] + noise, 0, 255);
    image.data[i + 2] = clamp(image.data[i + 2] + noise, 0, 255);
  }
};

const hasToBlob = (
  canvas: HTMLCanvasElement | OffscreenCanvas
): canvas is HTMLCanvasElement => typeof (canvas as HTMLCanvasElement).toBlob === 'function';

const toBlob = async (canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> => {
  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type: 'image/png' });
  }
  if (!hasToBlob(canvas)) {
    throw new Error('Canvas blob export is not available.');
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to encode translated image.'));
      }
    }, 'image/png');
  });
};

export const translateImage = async (
  input: TranslateImageInput,
  options: TranslateImageOptions = {}
): Promise<TranslateImageOutput> => {
  if (!input.ocrItems || input.ocrItems.length === 0) {
    throw new Error('No OCR regions available for translation.');
  }
  if (!input.ocrSize.width || !input.ocrSize.height) {
    throw new Error('Invalid OCR dimensions.');
  }

  const scaleX = input.original.width / input.ocrSize.width;
  const scaleY = input.original.height / input.ocrSize.height;
  const regions = buildRegions(input.ocrItems, {
    sourceLang: input.from,
    scaleX,
    scaleY,
  });
  if (regions.length === 0) {
    throw new Error('No OCR regions available for translation.');
  }

  for (const region of regions) {
    const sourceText = region.sourceLines.join('\n').trim();
    if (!sourceText) {
      region.translatedText = '';
      continue;
    }
    const response = await input.translator.translate({
      from: input.from,
      to: input.to,
      text: sourceText,
    });
    region.translatedText = response.text;
  }

  const activeRegions = regions.filter(
    (region) => region.translatedText && region.translatedText.trim().length > 0
  );
  if (activeRegions.length === 0) {
    throw new Error('No translated text to render.');
  }

  const padding = 16;
  const bounds = unionBounds(activeRegions, input.original.width, input.original.height, padding);
  if (!bounds) {
    throw new Error('Unable to compute translation bounds.');
  }
  const rawMask = rasterizeRegionsToMask(activeRegions, bounds);
  const dilation = clamp(
    Math.round(
      0.03 *
        medianValue(activeRegions.map((region) => Math.min(region.bbox.width, region.bbox.height)))
    ),
    2,
    12
  );
  const mask = dilateMask(rawMask, bounds.width, bounds.height, dilation);
  const background = inpaintImage(input.original, mask, bounds);

  const output = new ImageData(
    new Uint8ClampedArray(background.data),
    background.width,
    background.height
  );
  const targetFontFamily = getFontFamily(input.to);
  const rtl = isRtlLanguage(input.to);
  const alignment = rtl ? 'right' : 'left';
  const useCjkWrap = isCjkLanguage(input.to);

  for (const region of activeRegions) {
    const regionBounds = normalizeBounds(region.bbox, output.width, output.height);
    const texture = prepareTexture(output, regionBounds);
    const avgLuma = texture.avgLuma;
    const styleText = region.style?.text;
    const textColor = styleText ?? chooseTextColor(avgLuma);
    const textIsDark = luma(textColor[0], textColor[1], textColor[2]) < 128;
    const shadowColor: [number, number, number] = textIsDark ? [255, 255, 255] : [0, 0, 0];
    const shadowBlur = 1.0;
    const shadowOffsetX = 0;
    const shadowOffsetY = 0;

    const layout = renderTextMasks({
      text: region.translatedText ?? '',
      width: regionBounds.width,
      height: regionBounds.height,
      fontFamily: targetFontFamily,
      align: alignment,
      direction: rtl ? 'rtl' : 'ltr',
      targetLineCount: region.sourceLineCount,
      isCjk: useCjkWrap,
      shadowBlur,
      shadowOffsetX,
      shadowOffsetY,
    });

    if (layout.shadowCanvas) {
      if (isRectQuad(region.quad, regionBounds)) {
        const shadowData = getContext2d(layout.shadowCanvas).getImageData(
          0,
          0,
          layout.shadowCanvas.width,
          layout.shadowCanvas.height
        );
        blendLayer(
          output,
          shadowData,
          {
            x: regionBounds.x,
            y: regionBounds.y,
            width: shadowData.width,
            height: shadowData.height,
          },
          { color: shadowColor, mode: 'shadow', textIsDark }
        );
      } else {
        const warpedShadow = warpMaskToQuad(layout.shadowCanvas, region.quad);
        blendLayer(output, warpedShadow.imageData, warpedShadow.bounds, {
          color: shadowColor,
          mode: 'shadow',
          textIsDark,
        });
      }
    }

    if (isRectQuad(region.quad, regionBounds)) {
      const textData = getContext2d(layout.textCanvas).getImageData(
        0,
        0,
        layout.textCanvas.width,
        layout.textCanvas.height
      );
      blendLayer(
        output,
        textData,
        {
          x: regionBounds.x,
          y: regionBounds.y,
          width: textData.width,
          height: textData.height,
        },
        { color: textColor, mode: 'text', textIsDark, texture }
      );
    } else {
      const warpedText = warpMaskToQuad(layout.textCanvas, region.quad);
      blendLayer(output, warpedText.imageData, warpedText.bounds, {
        color: textColor,
        mode: 'text',
        textIsDark,
        texture: prepareTexture(output, warpedText.bounds),
      });
    }
  }

  addNoise(output, 1.5);

  const canvas = createCanvas(output.width, output.height);
  const context = getContext2d(canvas);
  context.putImageData(output, 0, 0);
  const blob = await toBlob(canvas);
  return { blob, debug: options.debug ? { regions: activeRegions } : undefined };
};

const medianValue = (values: number[]): number => {
  if (values.length === 0) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};
