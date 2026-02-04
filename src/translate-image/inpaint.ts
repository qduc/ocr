import type { Bounds } from './mask';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const directions: Array<[number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

export const inpaintImage = (
  original: ImageData,
  mask: Uint8ClampedArray,
  bounds: Bounds
): ImageData => {
  const output = new ImageData(
    new Uint8ClampedArray(original.data),
    original.width,
    original.height
  );
  const { width, height } = original;

  const inBounds = (x: number, y: number): boolean =>
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;

  const maskIndex = (x: number, y: number): number =>
    (y - bounds.y) * bounds.width + (x - bounds.x);

  const isMasked = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    return mask[maskIndex(x, y)] > 0;
  };

  const sample = (x: number, y: number): [number, number, number] => {
    const idx = (y * width + x) * 4;
    return [original.data[idx], original.data[idx + 1], original.data[idx + 2]];
  };

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (!isMasked(x, y)) continue;
      let totalR = 0;
      let totalG = 0;
      let totalB = 0;
      let count = 0;
      for (const radius of [3, 7]) {
        for (const [dx, dy] of directions) {
          let found = false;
          for (let step = radius; step <= radius * 3; step += radius) {
            const sx = Math.round(x + dx * step);
            const sy = Math.round(y + dy * step);
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            if (!isMasked(sx, sy)) {
              const [r, g, b] = sample(sx, sy);
              totalR += r;
              totalG += g;
              totalB += b;
              count += 1;
              found = true;
              break;
            }
          }
          if (found && count >= 3) {
            break;
          }
        }
        if (count >= 3) {
          break;
        }
      }

      const idx = (y * width + x) * 4;
      if (count >= 3) {
        output.data[idx] = Math.round(totalR / count);
        output.data[idx + 1] = Math.round(totalG / count);
        output.data[idx + 2] = Math.round(totalB / count);
      } else {
        output.data[idx] = original.data[idx];
        output.data[idx + 1] = original.data[idx + 1];
        output.data[idx + 2] = original.data[idx + 2];
      }
    }
  }

  const source = new Uint8ClampedArray(output.data);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (!isMasked(x, y)) continue;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let samples = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const sx = clamp(x + ox, 0, width - 1);
          const sy = clamp(y + oy, 0, height - 1);
          const idx = (sy * width + sx) * 4;
          sumR += source[idx];
          sumG += source[idx + 1];
          sumB += source[idx + 2];
          samples += 1;
        }
      }
      const idx = (y * width + x) * 4;
      output.data[idx] = Math.round(sumR / samples);
      output.data[idx + 1] = Math.round(sumG / samples);
      output.data[idx + 2] = Math.round(sumB / samples);
    }
  }

  return output;
};
