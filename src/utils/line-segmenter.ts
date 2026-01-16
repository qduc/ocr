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
  /** X-coordinate of the left edge of detected text (optional, for horizontal cropping) */
  left?: number;
  /** X-coordinate of the right edge of detected text (optional, for horizontal cropping) */
  right?: number;
}

/**
 * Quality metrics for line detection confidence.
 * Higher scores indicate more reliable detection.
 */
export interface LineDetectionQuality {
  /** Overall confidence score (0-1). Higher is better. */
  confidence: number;
  /** Number of lines detected */
  lineCount: number;
  /** Average contrast ratio between text and background */
  contrastRatio: number;
  /** Whether the detection is likely reliable */
  isReliable: boolean;
  /** Specific issues detected, if any */
  warnings: string[];
}

export interface LineSegmenterOptions {
  /** Minimum height for a line segment (filters noise). Default: 8 */
  minLineHeight?: number;
  /** Minimum gap between lines to consider them separate. Default: 3 */
  minGapHeight?: number;
  /** Minimum percentage of row width that must have ink to be considered text. Default: 0.3 */
  minRowInkPercent?: number;
  /**
   * Vertical padding to add above and below each line segment.
   * Generous padding prevents cutting ascenders (b, d, f, h, k, l, t) and
   * descenders (g, j, p, q, y). Default: 6
   */
  verticalPadding?: number;
  /**
   * Horizontal padding to add to left and right of each line.
   * Prevents cutting first/last characters at edges. Default: 8
   */
  horizontalPadding?: number;
  /**
   * Additional padding as a fraction of detected line height.
   * Applied on top of fixed padding for proportional scaling.
   * Default: 0.15 (15% of line height)
   */
  proportionalPadding?: number;
  /** Enable adaptive thresholding for complex backgrounds. Default: true */
  adaptiveThreshold?: boolean;
  /** Block size for local adaptive thresholding. Default: 15 */
  adaptiveBlockSize?: number;
  /** Constant subtracted from mean in adaptive thresholding. Default: 10 */
  adaptiveC?: number;
  /**
   * Minimum aspect ratio (width/height) to consider an image as a single line.
   * Images wider than this ratio are assumed to be single lines even if
   * projection analysis suggests otherwise. Default: 12
   */
  singleLineAspectRatio?: number;
}

export class LineSegmenter {
  private readonly options: Required<LineSegmenterOptions>;

  constructor(options: LineSegmenterOptions = {}) {
    this.options = {
      minLineHeight: options.minLineHeight ?? 8,
      minGapHeight: options.minGapHeight ?? 3,
      minRowInkPercent: options.minRowInkPercent ?? 0.3,
      // Generous vertical padding for ascenders/descenders (g, y, j, p, b, d, f, h, k, l, t)
      verticalPadding: options.verticalPadding ?? 6,
      // Horizontal padding to avoid cutting first/last characters
      horizontalPadding: options.horizontalPadding ?? 8,
      // Proportional padding scales with line height
      proportionalPadding: options.proportionalPadding ?? 0.15,
      adaptiveThreshold: options.adaptiveThreshold ?? true,
      adaptiveBlockSize: options.adaptiveBlockSize ?? 15,
      adaptiveC: options.adaptiveC ?? 10,
      singleLineAspectRatio: options.singleLineAspectRatio ?? 12,
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
   * Uses multiple heuristics to avoid false positives on wide single lines.
   *
   * Heuristics applied:
   * 1. Very wide aspect ratio (> singleLineAspectRatio) → single line
   * 2. Tall + narrow aspect ratio with sufficient height → likely multiline
   * 3. Projection analysis confirms multiple distinct line regions
   * 4. Validates detected lines have reasonable spacing
   */
  isMultiline(imageData: ImageData): boolean {
    const { width, height } = imageData;
    const aspectRatio = width / height;

    // Very wide images are almost certainly single lines
    // Even with some vertical variance, treat as single line
    if (aspectRatio > this.options.singleLineAspectRatio) {
      return false;
    }

    // Moderately wide images (8-12 ratio) need careful analysis
    // Only treat as single line if projection shows single text band
    if (aspectRatio > 8) {
      const segments = this.detectLines(imageData);
      // For wide images, require strong evidence of multiple lines
      if (segments.length <= 1) {
        return false;
      }
      // Verify gaps between lines are substantial (not just noise)
      const hasSubstantialGaps = this.validateLineGaps(segments, height);
      return hasSubstantialGaps;
    }

    // Tall, narrow images are likely multiline if they have enough height
    // for at least 2 reasonable text lines (~40px each minimum)
    if (aspectRatio < 2 && height > 80) {
      return true;
    }

    // For medium aspect ratios, rely on projection analysis
    const segments = this.detectLines(imageData);

    // Single detected segment is definitively single-line
    if (segments.length <= 1) {
      return false;
    }

    // Multiple segments: validate they represent real separate lines
    return this.validateLineGaps(segments, height);
  }

  /**
   * Validates that detected line segments have meaningful gaps between them.
   * Filters out false multiline detection from noise or uneven baselines.
   *
   * @param segments - Detected line segments
   * @param imageHeight - Total image height
   * @returns True if gaps suggest real separate lines
   */
  private validateLineGaps(segments: LineSegment[], imageHeight: number): boolean {
    if (segments.length < 2) {
      return false;
    }

    // Calculate average line height
    const avgLineHeight = segments.reduce((sum, s) => sum + s.height, 0) / segments.length;

    // Check gaps between consecutive segments
    for (let i = 1; i < segments.length; i++) {
      const prevSegment = segments[i - 1];
      const currSegment = segments[i];
      if (!prevSegment || !currSegment) continue;

      const gap = currSegment.top - prevSegment.bottom;

      // Gap should be at least 20% of average line height to be meaningful
      // This filters out detection splits from uneven text baselines
      if (gap < avgLineHeight * 0.2) {
        return false;
      }
    }

    // Also verify total line content doesn't exceed image bounds unreasonably
    const totalLineHeight = segments.reduce((sum, s) => sum + s.height, 0);
    // Gap ratio could be used for additional heuristics in the future
    const _totalGaps = imageHeight - totalLineHeight;
    void _totalGaps; // Reserved for future gap-based heuristics

    // Lines + gaps should reasonably fill the image
    // If detected lines are tiny compared to image, likely noise
    if (totalLineHeight < imageHeight * 0.3) {
      return false;
    }

    return true;
  }

  /**
   * Analyzes image and returns quality metrics for line detection.
   * Use this to assess confidence in detection results.
   *
   * @param imageData - Source image to analyze
   * @returns Quality metrics including confidence score and warnings
   */
  analyzeQuality(imageData: ImageData): LineDetectionQuality {
    const warnings: string[] = [];
    let confidence = 1.0;

    const { width, height } = imageData;
    const aspectRatio = width / height;

    // Analyze grayscale for contrast
    const grayscale = this.toGrayscale(imageData);
    const { min, max, mean: _mean, stdDev } = this.computeGrayscaleStats(grayscale);
    const contrastRatio = max > min ? (max - min) / 255 : 0;
    void _mean; // Available for future mean-based analysis

    // Low contrast warning
    if (contrastRatio < 0.3) {
      warnings.push('Low contrast: text may not be clearly distinguishable from background');
      confidence *= 0.7;
    }

    // Very low standard deviation suggests uniform image
    if (stdDev < 20) {
      warnings.push('Low variance: image may be blank or have minimal text');
      confidence *= 0.6;
    }

    // Extreme aspect ratios
    if (aspectRatio > 20) {
      warnings.push('Very wide aspect ratio: may be a single word or partial line');
      confidence *= 0.8;
    } else if (aspectRatio < 0.5) {
      warnings.push('Very tall aspect ratio: may be rotated or columnar text');
      confidence *= 0.7;
    }

    // Detect lines and assess
    const segments = this.detectLines(imageData);

    // No lines detected
    if (segments.length === 0) {
      warnings.push('No text lines detected: image may be blank or text too faint');
      confidence *= 0.3;
    }

    // Very many lines in small image
    if (segments.length > 10 && height < 500) {
      warnings.push('Many lines detected in small image: possible noise or over-segmentation');
      confidence *= 0.6;
    }

    // Check for very small lines
    const smallLines = segments.filter(s => s.height < 12);
    if (smallLines.length > segments.length * 0.3) {
      warnings.push('Many small line segments: text may be too small or noisy');
      confidence *= 0.8;
    }

    return {
      confidence: Math.max(0, Math.min(1, confidence)),
      lineCount: segments.length,
      contrastRatio,
      isReliable: confidence >= 0.6 && warnings.length <= 1,
      warnings,
    };
  }

  /**
   * Computes basic statistics for grayscale image data.
   */
  private computeGrayscaleStats(grayscale: Uint8Array): {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  } {
    if (grayscale.length === 0) {
      return { min: 0, max: 0, mean: 0, stdDev: 0 };
    }

    let min = 255;
    let max = 0;
    let sum = 0;

    for (let i = 0; i < grayscale.length; i++) {
      const val = grayscale[i] ?? 0;
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }

    const mean = sum / grayscale.length;

    let varianceSum = 0;
    for (let i = 0; i < grayscale.length; i++) {
      const diff = (grayscale[i] ?? 0) - mean;
      varianceSum += diff * diff;
    }

    const stdDev = Math.sqrt(varianceSum / grayscale.length);

    return { min, max, mean, stdDev };
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
   * Applies generous padding to prevent cutting ascenders/descenders.
   */
  private mergeAndFilterSegments(segments: LineSegment[], imageHeight: number): LineSegment[] {
    if (segments.length === 0) {
      return [];
    }

    const { minLineHeight, minGapHeight, verticalPadding, proportionalPadding } = this.options;

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

    // Add generous padding to prevent cutting ascenders (b,d,f,h,k,l,t) and
    // descenders (g,j,p,q,y). Use both fixed and proportional padding.
    return filtered.map((segment) => {
      // Calculate proportional padding based on line height
      const proportionalPad = Math.ceil(segment.height * proportionalPadding);

      // Total vertical padding: fixed + proportional
      const totalVerticalPad = verticalPadding + proportionalPad;

      const top = Math.max(0, segment.top - totalVerticalPad);
      const bottom = Math.min(imageHeight - 1, segment.bottom + totalVerticalPad);

      return {
        top,
        bottom,
        height: bottom - top + 1,
        // Preserve horizontal bounds if they were set
        left: segment.left,
        right: segment.right,
      };
    });
  }

  /**
   * Crops a single line from the source image with generous padding.
   * Applies horizontal padding to prevent cutting first/last characters,
   * and fills padded areas with detected background color.
   *
   * @param imageData - Source image
   * @param segment - Line segment boundaries
   * @returns Cropped line image with padding
   */
  private cropLine(imageData: ImageData, segment: LineSegment): ImageData {
    const { width: srcWidth, height: srcHeight, data } = imageData;
    const { top, height: segHeight, left: segLeft, right: segRight } = segment;
    const { horizontalPadding, proportionalPadding } = this.options;

    // Detect background color from image corners for padding fill
    const bgColor = this.detectBackgroundColor(imageData);

    // Calculate horizontal bounds with padding
    // If segment has explicit left/right, use those; otherwise use full width
    const contentLeft = segLeft ?? 0;
    const contentRight = segRight ?? srcWidth - 1;
    const contentWidth = contentRight - contentLeft + 1;

    // Calculate proportional horizontal padding based on content width
    const proportionalHPad = Math.ceil(contentWidth * proportionalPadding * 0.5);
    const totalHPad = horizontalPadding + proportionalHPad;

    // For full-width crops, just add horizontal padding to edges
    // For partial-width crops, crop to content bounds with padding
    const cropLeft = Math.max(0, contentLeft - totalHPad);
    const cropRight = Math.min(srcWidth - 1, contentRight + totalHPad);
    const cropWidth = cropRight - cropLeft + 1;

    const lineData = new Uint8ClampedArray(cropWidth * segHeight * 4);

    // Fill with background color first
    for (let i = 0; i < lineData.length; i += 4) {
      lineData[i] = bgColor.r;
      lineData[i + 1] = bgColor.g;
      lineData[i + 2] = bgColor.b;
      lineData[i + 3] = 255;
    }

    // Copy source pixels
    for (let y = 0; y < segHeight; y++) {
      const srcRow = top + y;
      if (srcRow < 0 || srcRow >= srcHeight) continue;

      for (let x = 0; x < cropWidth; x++) {
        const srcX = cropLeft + x;
        if (srcX < 0 || srcX >= srcWidth) continue;

        const srcOffset = (srcRow * srcWidth + srcX) * 4;
        const destOffset = (y * cropWidth + x) * 4;

        lineData[destOffset] = data[srcOffset] ?? bgColor.r;
        lineData[destOffset + 1] = data[srcOffset + 1] ?? bgColor.g;
        lineData[destOffset + 2] = data[srcOffset + 2] ?? bgColor.b;
        lineData[destOffset + 3] = data[srcOffset + 3] ?? 255;
      }
    }

    return new ImageData(lineData, cropWidth, segHeight);
  }

  /**
   * Detects the predominant background color by sampling image corners.
   * Used to fill padding areas with a natural-looking background.
   *
   * @param imageData - Source image
   * @returns RGB color values for background
   */
  private detectBackgroundColor(imageData: ImageData): { r: number; g: number; b: number } {
    const { width, height, data } = imageData;

    // Sample corners and edges
    const sampleSize = Math.min(10, Math.floor(width / 4), Math.floor(height / 4));
    const samples: Array<{ r: number; g: number; b: number }> = [];

    // Sample from four corners
    const corners = [
      { x: 0, y: 0 },
      { x: width - sampleSize, y: 0 },
      { x: 0, y: height - sampleSize },
      { x: width - sampleSize, y: height - sampleSize },
    ];

    for (const corner of corners) {
      for (let dy = 0; dy < sampleSize; dy++) {
        for (let dx = 0; dx < sampleSize; dx++) {
          const x = Math.min(corner.x + dx, width - 1);
          const y = Math.min(corner.y + dy, height - 1);
          const idx = (y * width + x) * 4;
          samples.push({
            r: data[idx] ?? 255,
            g: data[idx + 1] ?? 255,
            b: data[idx + 2] ?? 255,
          });
        }
      }
    }

    // Average the samples
    if (samples.length === 0) {
      return { r: 255, g: 255, b: 255 }; // Default to white
    }

    const avg = samples.reduce(
      (acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }),
      { r: 0, g: 0, b: 0 }
    );

    return {
      r: Math.round(avg.r / samples.length),
      g: Math.round(avg.g / samples.length),
      b: Math.round(avg.b / samples.length),
    };
  }

  /**
   * Finds the horizontal text bounds within a row range.
   * Used to detect where text actually starts/ends for smarter cropping.
   *
   * @param binary - Binary image data
   * @param width - Image width
   * @param topRow - Starting row
   * @param bottomRow - Ending row
   * @returns Left and right text bounds
   */
  private findHorizontalBounds(
    binary: Uint8Array,
    width: number,
    topRow: number,
    bottomRow: number
  ): { left: number; right: number } {
    let left = width;
    let right = 0;

    for (let y = topRow; y <= bottomRow; y++) {
      for (let x = 0; x < width; x++) {
        if ((binary[y * width + x] ?? 0) === 1) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }

    // If no text found, return full width
    if (left > right) {
      return { left: 0, right: width - 1 };
    }

    return { left, right };
  }
}
