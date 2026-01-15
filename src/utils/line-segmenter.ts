/**
 * Robust line segmentation utility for detecting and extracting text lines from images.
 * Uses adaptive thresholding and projection profile analysis.
 *
 * Features:
 * - Otsu's method for automatic threshold selection
 * - Handles both light-on-dark and dark-on-light text
 * - Local adaptive thresholding for varying backgrounds
 * - Morphological operations for noise reduction
 * - Connected component analysis for line grouping
 */

export interface LineSegment {
  /** Y-coordinate of the top of the line */
  top: number;
  /** Y-coordinate of the bottom of the line */
  bottom: number;
  /** Height of the line region */
  height: number;
}

export interface LineSegmenterOptions {
  /** Minimum height for a line segment (filters noise). Default: 8 */
  minLineHeight?: number;
  /** Minimum gap between lines to consider them separate. Default: 3 */
  minGapHeight?: number;
  /** Minimum percentage of row width that must have ink to be considered text. Default: 0.3 */
  minRowInkPercent?: number;
  /** Padding to add above and below each line segment. Default: 4 */
  linePadding?: number;
  /** Enable adaptive thresholding for complex backgrounds. Default: true */
  adaptiveThreshold?: boolean;
  /** Block size for local adaptive thresholding. Default: 15 */
  adaptiveBlockSize?: number;
  /** Constant subtracted from mean in adaptive thresholding. Default: 10 */
  adaptiveC?: number;
}

export class LineSegmenter {
  private readonly options: Required<LineSegmenterOptions>;

  constructor(options: LineSegmenterOptions = {}) {
    this.options = {
      minLineHeight: options.minLineHeight ?? 8,
      minGapHeight: options.minGapHeight ?? 3,
      minRowInkPercent: options.minRowInkPercent ?? 0.3,
      linePadding: options.linePadding ?? 4,
      adaptiveThreshold: options.adaptiveThreshold ?? true,
      adaptiveBlockSize: options.adaptiveBlockSize ?? 15,
      adaptiveC: options.adaptiveC ?? 10,
    };
  }

  /**
   * Detects text line boundaries in an image using adaptive thresholding
   * and horizontal projection profile analysis.
   */
  detectLines(imageData: ImageData): LineSegment[] {
    // Convert to grayscale
    const grayscale = this.toGrayscale(imageData);

    // Apply adaptive binarization
    const binary = this.options.adaptiveThreshold
      ? this.adaptiveBinarize(grayscale, imageData.width, imageData.height)
      : this.otsiBinarize(grayscale);

    // Detect text polarity (light on dark vs dark on light)
    const inverted = this.shouldInvert(binary);
    const normalized = inverted ? this.invertBinary(binary) : binary;

    // Apply morphological closing to connect broken characters
    const cleaned = this.morphologicalClose(normalized, imageData.width, imageData.height);

    // Compute horizontal projection profile
    const profile = this.computeHorizontalProjection(cleaned, imageData.width, imageData.height);

    // Find line segments
    const rawSegments = this.findLineSegments(profile, imageData.width);

    return this.mergeAndFilterSegments(rawSegments, imageData.height);
  }

  /**
   * Extracts individual line images from the source image.
   */
  extractLines(imageData: ImageData): ImageData[] {
    const segments = this.detectLines(imageData);

    if (segments.length === 0) {
      return [imageData];
    }

    const firstSegment = segments[0];
    if (segments.length === 1 && firstSegment) {
      const coverage = firstSegment.height / imageData.height;
      if (coverage > 0.8) {
        return [imageData];
      }
    }

    return segments.map((segment) => this.cropLine(imageData, segment));
  }

  /**
   * Checks if an image likely contains multiple lines of text.
   */
  isMultiline(imageData: ImageData): boolean {
    const aspectRatio = imageData.width / imageData.height;
    if (aspectRatio > 15) {
      return false;
    }

    if (aspectRatio < 2 && imageData.height > 100) {
      return true;
    }

    const segments = this.detectLines(imageData);
    return segments.length > 1;
  }

  /**
   * Converts RGBA image data to grayscale values.
   */
  private toGrayscale(imageData: ImageData): Uint8Array {
    const { width, height, data } = imageData;
    const grayscale = new Uint8Array(width * height);

    for (let i = 0; i < grayscale.length; i++) {
      const idx = i * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    return grayscale;
  }

  /**
   * Otsu's method for automatic threshold selection.
   * Finds the threshold that maximizes inter-class variance.
   */
  private computeOtsuThreshold(grayscale: Uint8Array): number {
    // Build histogram
    const histogram = new Array<number>(256).fill(0);
    for (let i = 0; i < grayscale.length; i++) {
      const value = grayscale[i] ?? 0;
      histogram[value]++;
    }

    const total = grayscale.length;
    if (total === 0) return 128;

    // Calculate total sum of pixel values
    let totalSum = 0;
    for (let i = 0; i < 256; i++) {
      totalSum += i * (histogram[i] ?? 0);
    }

    let backgroundWeight = 0;
    let backgroundSum = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      backgroundWeight += histogram[t] ?? 0;
      if (backgroundWeight === 0) continue;

      const foregroundWeight = total - backgroundWeight;
      if (foregroundWeight === 0) break;

      backgroundSum += t * (histogram[t] ?? 0);

      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;

      // Inter-class variance
      const meanDiff = backgroundMean - foregroundMean;
      const variance = backgroundWeight * foregroundWeight * meanDiff * meanDiff;

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    // For bimodal distributions at extremes (0 and 255), use midpoint
    if (threshold === 0 || threshold === 255) {
      // Find the actual min and max non-zero histogram values
      let minVal = 0;
      let maxVal = 255;
      for (let i = 0; i < 256; i++) {
        if ((histogram[i] ?? 0) > 0) {
          minVal = i;
          break;
        }
      }
      for (let i = 255; i >= 0; i--) {
        if ((histogram[i] ?? 0) > 0) {
          maxVal = i;
          break;
        }
      }
      threshold = Math.floor((minVal + maxVal) / 2);
    }

    return threshold;
  }

  /**
   * Global binarization using Otsu's threshold.
   */
  private otsiBinarize(grayscale: Uint8Array): Uint8Array {
    const threshold = this.computeOtsuThreshold(grayscale);
    const binary = new Uint8Array(grayscale.length);

    // Use <= to ensure pixels at exact threshold are included in foreground
    for (let i = 0; i < grayscale.length; i++) {
      binary[i] = (grayscale[i] ?? 0) <= threshold ? 1 : 0;
    }

    return binary;
  }

  /**
   * Local adaptive thresholding using mean of local neighborhood.
   * Better for images with varying lighting or complex backgrounds.
   */
  private adaptiveBinarize(grayscale: Uint8Array, width: number, height: number): Uint8Array {
    const blockSize = this.options.adaptiveBlockSize;
    const C = this.options.adaptiveC;
    const halfBlock = Math.floor(blockSize / 2);
    const binary = new Uint8Array(grayscale.length);

    // Compute integral image for fast mean calculation
    const integral = this.computeIntegralImage(grayscale, width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - halfBlock);
        const y1 = Math.max(0, y - halfBlock);
        const x2 = Math.min(width - 1, x + halfBlock);
        const y2 = Math.min(height - 1, y + halfBlock);

        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = this.getIntegralSum(integral, width, x1, y1, x2, y2);
        const mean = sum / count;

        const idx = y * width + x;
        const pixelValue = grayscale[idx] ?? 0;
        binary[idx] = pixelValue < mean - C ? 1 : 0;
      }
    }

    return binary;
  }

  /**
   * Computes integral image for fast region sum queries.
   */
  private computeIntegralImage(grayscale: Uint8Array, width: number, height: number): Float64Array {
    const integral = new Float64Array(width * height);

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        rowSum += grayscale[idx] ?? 0;
        const above = y > 0 ? (integral[(y - 1) * width + x] ?? 0) : 0;
        integral[idx] = rowSum + above;
      }
    }

    return integral;
  }

  /**
   * Gets sum of region using integral image.
   */
  private getIntegralSum(
    integral: Float64Array,
    width: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const d = integral[y2 * width + x2] ?? 0;
    const a = x1 > 0 && y1 > 0 ? (integral[(y1 - 1) * width + (x1 - 1)] ?? 0) : 0;
    const b = y1 > 0 ? (integral[(y1 - 1) * width + x2] ?? 0) : 0;
    const c = x1 > 0 ? (integral[y2 * width + (x1 - 1)] ?? 0) : 0;

    return d - b - c + a;
  }

  /**
   * Determines if binary image should be inverted (light text on dark background).
   * Uses the ratio of foreground to background pixels.
   */
  private shouldInvert(binary: Uint8Array): boolean {
    let foregroundCount = 0;
    for (let i = 0; i < binary.length; i++) {
      if (binary[i] === 1) foregroundCount++;
    }

    // If more than 50% is foreground, it's likely inverted
    return foregroundCount > binary.length * 0.5;
  }

  /**
   * Inverts binary image.
   */
  private invertBinary(binary: Uint8Array): Uint8Array {
    const inverted = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      inverted[i] = binary[i] === 1 ? 0 : 1;
    }
    return inverted;
  }

  /**
   * Morphological closing operation to connect broken characters.
   * Performs dilation followed by erosion.
   */
  private morphologicalClose(binary: Uint8Array, width: number, height: number): Uint8Array {
    // Simple 3x1 horizontal structuring element
    const dilated = this.dilateHorizontal(binary, width, height);
    return this.erodeHorizontal(dilated, width, height);
  }

  private dilateHorizontal(binary: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(binary.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const left = x > 0 ? (binary[idx - 1] ?? 0) : 0;
        const center = binary[idx] ?? 0;
        const right = x < width - 1 ? (binary[idx + 1] ?? 0) : 0;
        result[idx] = left === 1 || center === 1 || right === 1 ? 1 : 0;
      }
    }

    return result;
  }

  private erodeHorizontal(binary: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(binary.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const left = x > 0 ? (binary[idx - 1] ?? 0) : 0;
        const center = binary[idx] ?? 0;
        const right = x < width - 1 ? (binary[idx + 1] ?? 0) : 0;
        result[idx] = left === 1 && center === 1 && right === 1 ? 1 : 0;
      }
    }

    return result;
  }

  /**
   * Computes horizontal projection profile from binary image.
   */
  private computeHorizontalProjection(binary: Uint8Array, width: number, height: number): number[] {
    const profile: number[] = new Array<number>(height).fill(0);

    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) {
        if ((binary[y * width + x] ?? 0) === 1) {
          count++;
        }
      }
      profile[y] = count;
    }

    return profile;
  }

  /**
   * Finds line segments from projection profile using adaptive threshold.
   */
  private findLineSegments(profile: number[], width: number): LineSegment[] {
    const segments: LineSegment[] = [];

    // Compute adaptive threshold based on profile statistics
    const nonZeroValues = profile.filter((v) => v > 0);
    if (nonZeroValues.length === 0) {
      return segments;
    }

    const meanValue = nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length;
    const minInkPixels = Math.max(
      (width * this.options.minRowInkPercent) / 100,
      meanValue * 0.1 // At least 10% of mean
    );

    let inTextRegion = false;
    let segmentStart = 0;

    for (let y = 0; y < profile.length; y++) {
      const isText = (profile[y] ?? 0) > minInkPixels;

      if (isText && !inTextRegion) {
        segmentStart = y;
        inTextRegion = true;
      } else if (!isText && inTextRegion) {
        segments.push({
          top: segmentStart,
          bottom: y - 1,
          height: y - segmentStart,
        });
        inTextRegion = false;
      }
    }

    if (inTextRegion) {
      segments.push({
        top: segmentStart,
        bottom: profile.length - 1,
        height: profile.length - segmentStart,
      });
    }

    return segments;
  }

  /**
   * Merges close segments and filters out noise.
   */
  private mergeAndFilterSegments(segments: LineSegment[], imageHeight: number): LineSegment[] {
    if (segments.length === 0) {
      return [];
    }

    const { minLineHeight, minGapHeight, linePadding } = this.options;

    // Merge segments that are too close together
    const merged: LineSegment[] = [];
    const firstSegment = segments[0];
    if (!firstSegment) {
      return [];
    }

    let current: LineSegment = {
      top: firstSegment.top,
      bottom: firstSegment.bottom,
      height: firstSegment.height,
    };

    for (let i = 1; i < segments.length; i++) {
      const next = segments[i];
      if (!next) continue;

      const gap = next.top - current.bottom - 1;

      // Adaptive gap threshold based on line height
      const adaptiveGap = Math.max(minGapHeight, current.height * 0.3);

      if (gap < adaptiveGap) {
        current.bottom = next.bottom;
        current.height = current.bottom - current.top + 1;
      } else {
        merged.push(current);
        current = {
          top: next.top,
          bottom: next.bottom,
          height: next.height,
        };
      }
    }
    merged.push(current);

    // Filter out segments that are too small
    const filtered = merged.filter((s) => s.height >= minLineHeight);

    // Add padding and clamp to image bounds
    return filtered.map((segment) => {
      const top = Math.max(0, segment.top - linePadding);
      const bottom = Math.min(imageHeight - 1, segment.bottom + linePadding);
      return {
        top,
        bottom,
        height: bottom - top + 1,
      };
    });
  }

  /**
   * Crops a single line from the source image.
   */
  private cropLine(imageData: ImageData, segment: LineSegment): ImageData {
    const { width, data } = imageData;
    const { top, height } = segment;

    const lineData = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      const srcRow = top + y;
      const srcOffset = srcRow * width * 4;
      const destOffset = y * width * 4;

      for (let x = 0; x < width * 4; x++) {
        lineData[destOffset + x] = data[srcOffset + x] ?? 0;
      }
    }

    return new ImageData(lineData, width, height);
  }
}
