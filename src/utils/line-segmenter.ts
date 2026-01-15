/**
 * Line segmentation utility for detecting and extracting text lines from images.
 * Uses horizontal projection profile analysis to find line boundaries.
 *
 * TrOCR models are trained on single-line cropped text images, so multiline
 * documents need to be segmented into individual lines before processing.
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
  /** Minimum height for a line segment (filters noise). Default: 10 */
  minLineHeight?: number;
  /** Minimum gap between lines to consider them separate. Default: 5 */
  minGapHeight?: number;
  /** Luminance threshold (0-255) for considering a pixel as "ink". Default: 200 */
  inkThreshold?: number;
  /** Minimum percentage of row width that must have ink to be considered text. Default: 0.5 */
  minRowInkPercent?: number;
  /** Padding to add above and below each line segment. Default: 4 */
  linePadding?: number;
}

export class LineSegmenter {
  private readonly options: Required<LineSegmenterOptions>;

  constructor(options: LineSegmenterOptions = {}) {
    this.options = {
      minLineHeight: options.minLineHeight ?? 10,
      minGapHeight: options.minGapHeight ?? 5,
      inkThreshold: options.inkThreshold ?? 200,
      minRowInkPercent: options.minRowInkPercent ?? 0.5,
      linePadding: options.linePadding ?? 4,
    };
  }

  /**
   * Detects text line boundaries in an image using horizontal projection profile.
   * Returns array of line segments sorted from top to bottom.
   */
  detectLines(imageData: ImageData): LineSegment[] {
    const profile = this.computeHorizontalProjection(imageData);
    const binaryProfile = this.binarizeProfile(profile, imageData.width);
    const rawSegments = this.findLineSegments(binaryProfile);
    return this.mergeAndFilterSegments(rawSegments, imageData.height);
  }

  /**
   * Extracts individual line images from the source image.
   * Returns array of ImageData for each detected line.
   */
  extractLines(imageData: ImageData): ImageData[] {
    const segments = this.detectLines(imageData);

    if (segments.length === 0) {
      // No lines detected, return the original image
      return [imageData];
    }

    const firstSegment = segments[0];
    if (segments.length === 1 && firstSegment) {
      // Single line detected, check if it covers most of the image
      const coverage = firstSegment.height / imageData.height;
      if (coverage > 0.8) {
        return [imageData];
      }
    }

    return segments.map((segment) => this.cropLine(imageData, segment));
  }

  /**
   * Computes horizontal projection profile.
   * For each row, counts the number of "ink" (dark) pixels.
   */
  private computeHorizontalProjection(imageData: ImageData): number[] {
    const { width, height, data } = imageData;
    const profile: number[] = new Array<number>(height).fill(0);
    const threshold = this.options.inkThreshold;

    for (let y = 0; y < height; y++) {
      let inkCount = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Convert to grayscale luminance
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        // Count dark pixels (ink)
        if (luminance < threshold) {
          inkCount++;
        }
      }
      profile[y] = inkCount;
    }

    return profile;
  }

  /**
   * Converts projection profile to binary (text row / whitespace row).
   * A row is considered "text" if it has more than minRowInkPercent dark pixels.
   */
  private binarizeProfile(profile: number[], width: number): boolean[] {
    const minInkPixels = (width * this.options.minRowInkPercent) / 100;
    return profile.map((count) => count > minInkPixels);
  }

  /**
   * Finds contiguous segments of text rows.
   */
  private findLineSegments(binaryProfile: boolean[]): LineSegment[] {
    const segments: LineSegment[] = [];
    let inTextRegion = false;
    let segmentStart = 0;

    for (let y = 0; y < binaryProfile.length; y++) {
      const isText = binaryProfile[y];

      if (isText && !inTextRegion) {
        // Start of a new text region
        segmentStart = y;
        inTextRegion = true;
      } else if (!isText && inTextRegion) {
        // End of text region
        segments.push({
          top: segmentStart,
          bottom: y - 1,
          height: y - segmentStart,
        });
        inTextRegion = false;
      }
    }

    // Handle segment that extends to bottom of image
    if (inTextRegion) {
      segments.push({
        top: segmentStart,
        bottom: binaryProfile.length - 1,
        height: binaryProfile.length - segmentStart,
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

      if (gap < minGapHeight) {
        // Merge with current segment
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

  /**
   * Checks if an image likely contains multiple lines of text.
   * Uses a quick heuristic based on image aspect ratio and projection analysis.
   */
  isMultiline(imageData: ImageData): boolean {
    // Very wide images are likely single line
    const aspectRatio = imageData.width / imageData.height;
    if (aspectRatio > 15) {
      return false;
    }

    // Very tall images are likely multiline
    if (aspectRatio < 2 && imageData.height > 100) {
      return true;
    }

    // Check actual line count
    const segments = this.detectLines(imageData);
    return segments.length > 1;
  }
}
