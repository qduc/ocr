import type { Bounds } from '../mask';
import { inpaintImageFallback } from './ts-fallback';

export type InpaintStrategy = 'auto' | 'ts-fallback';
export type InpaintMethod = 'telea' | 'navier-stokes';

export interface InpaintOptions {
  strategy?: InpaintStrategy;
  method?: InpaintMethod;
  radius?: number;
  debug?: boolean;
  maxRegionSizePx?: number;
  maxUnionAreaRatio?: number;
  groupDistance?: number;
}

export const inpaintImage = async (
  original: ImageData,
  mask: Uint8ClampedArray,
  bounds: Bounds,
  _options: InpaintOptions = {}
): Promise<ImageData> => {
  // We keep the signature similar for now but always use the fallback
  return inpaintImageFallback(original, mask, bounds);
};