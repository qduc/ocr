export interface ImageProcessorEnv {
  createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  getContext2d?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
  Image?: typeof Image;
  URL?: typeof URL;
  document?: Document;
}

/**
 * Preprocessing intensity mode for TrOCR input.
 * TrOCR often works better with less preprocessing, so 'light' is recommended.
 *
 * - 'none': No preprocessing, pass image as-is (best for clean, high-quality scans)
 * - 'light': Gentle normalization only (recommended default for most cases)
 * - 'aggressive': Full contrast enhancement (use only for very faded/low-contrast images)
 */
export type PreprocessingMode = 'none' | 'light' | 'aggressive';

/**
 * Result of polarity detection for text images.
 */
export interface PolarityAnalysis {
  /** Whether the image appears to be inverted (light text on dark background) */
  isInverted: boolean;
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** Mean luminance of the image (0-255) */
  meanLuminance: number;
  /** Percentage of dark pixels (< 128) */
  darkPixelRatio: number;
}

/**
 * Result of resolution analysis for OCR suitability.
 */
export interface ResolutionAnalysis {
  /** Whether the resolution is suitable for OCR */
  isSuitable: boolean;
  /** Estimated average stroke width in pixels */
  estimatedStrokeWidth: number;
  /** Recommended scale factor to improve recognition (1.0 if no upscaling needed) */
  recommendedScale: number;
  /** Warning message if resolution may cause issues */
  warning?: string;
}

/**
 * Configuration for TrOCR-optimized preprocessing.
 */
export interface TrOCRPreprocessOptions {
  /** Target size for TrOCR input. Default: 384 */
  targetSize?: number;
  /** Minimum character height in pixels for good recognition. Default: 20 */
  minCharHeight?: number;
  /** Maximum upscale factor to avoid excessive blur. Default: 4 */
  maxUpscale?: number;
  /**
   * Preprocessing mode controlling intensity of image processing.
   * TrOCR often works better with minimal preprocessing.
   * - 'none': No preprocessing (best for clean scans)
   * - 'light': Gentle normalization only (recommended default)
   * - 'aggressive': Full contrast enhancement (for very faded images)
   * Default: 'light'
   */
  preprocessingMode?: PreprocessingMode;
  /**
   * Whether to normalize polarity (ensure dark text on light background).
   * Helps with inverted images (white text on black). Default: true
   */
  normalizePolarity?: boolean;
  /**
   * @deprecated Use preprocessingMode instead. This option is ignored when preprocessingMode is set.
   * Whether to apply contrast enhancement. Default: true
   */
  enhanceContrast?: boolean;
}

/** TrOCR's expected input dimension */
const TROCR_TARGET_SIZE = 384;

/** Minimum recommended character height for reliable recognition */
const MIN_CHAR_HEIGHT_PX = 20;

/** Maximum safe upscale factor before quality degrades */
const MAX_UPSCALE_FACTOR = 4;

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

export class ImageProcessor {
  private readonly env: ImageProcessorEnv;

  constructor(env: ImageProcessorEnv = {}) {
    this.env = env;
  }

  async fileToImageData(file: File): Promise<ImageData> {
    if (!SUPPORTED_TYPES.has(file.type)) {
      throw new Error(`Unsupported image format: ${file.type || 'unknown'}`);
    }

    const bitmap = await this.loadImageBitmap(file);
    const canvas = this.createCanvas(bitmap.width, bitmap.height);
    const context = this.getContext(canvas);

    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  preprocess(imageData: ImageData, contrast: number = 0.2): ImageData {
    const grayscale = this.toGrayscale(imageData);
    return this.enhanceContrast(grayscale, contrast);
  }

  toGrayscale(imageData: ImageData): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
    return new ImageData(data, imageData.width, imageData.height);
  }

  enhanceContrast(imageData: ImageData, contrast: number): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    const clampedContrast = Math.max(-1, Math.min(1, contrast));
    const factor = (259 * (clampedContrast * 255 + 255)) / (255 * (259 - clampedContrast * 255));

    for (let i = 0; i < data.length; i += 4) {
      data[i] = this.clamp(factor * ((data[i] ?? 0) - 128) + 128);
      data[i + 1] = this.clamp(factor * ((data[i + 1] ?? 0) - 128) + 128);
      data[i + 2] = this.clamp(factor * ((data[i + 2] ?? 0) - 128) + 128);
    }

    return new ImageData(data, imageData.width, imageData.height);
  }

  /**
   * Gentle contrast enhancement that preserves thin strokes and subtle details.
   * Uses CLAHE-inspired local contrast with soft limiting to avoid halos.
   * This is safer for TrOCR than aggressive global contrast enhancement.
   *
   * @param imageData - The image to enhance
   * @param strength - Enhancement strength from 0 to 1. Default: 0.3
   * @returns Gently enhanced image preserving fine details
   */
  gentleContrastEnhance(imageData: ImageData, strength: number = 0.3): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    const { width, height } = imageData;

    // Clamp strength to safe range
    const safeStrength = Math.max(0, Math.min(1, strength));

    // Calculate histogram for adaptive enhancement
    const histogram = new Array<number>(256).fill(0);
    let totalPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(
        0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
      );
      histogram[luminance] = (histogram[luminance] ?? 0) + 1;
      totalPixels++;
    }

    // Find actual min/max with percentile clipping to ignore outliers
    // This prevents a few bright/dark pixels from skewing the enhancement
    const clipPercent = 0.01; // Clip 1% from each end
    const clipCount = Math.floor(totalPixels * clipPercent);

    let minVal = 0;
    let maxVal = 255;
    let cumulative = 0;

    for (let i = 0; i < 256; i++) {
      cumulative += histogram[i] ?? 0;
      if (cumulative >= clipCount) {
        minVal = i;
        break;
      }
    }

    cumulative = 0;
    for (let i = 255; i >= 0; i--) {
      cumulative += histogram[i] ?? 0;
      if (cumulative >= clipCount) {
        maxVal = i;
        break;
      }
    }

    // Avoid division by zero and don't enhance already-good contrast
    const range = maxVal - minVal;
    if (range < 10 || range > 240) {
      return imageData; // Already good contrast or nearly uniform
    }

    // Create lookup table for fast processing
    // Uses a soft S-curve blended with linear stretch for natural results
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      // Linear stretch component
      const stretched = ((i - minVal) / range) * 255;
      const clampedStretched = Math.max(0, Math.min(255, stretched));

      // Soft S-curve component (subtle, not aggressive)
      const normalized = clampedStretched / 255;
      const curved = normalized * normalized * (3 - 2 * normalized); // Smoothstep
      const curvedValue = curved * 255;

      // Blend based on strength: higher strength = more S-curve
      const blended = clampedStretched * (1 - safeStrength * 0.5) + curvedValue * (safeStrength * 0.5);
      lut[i] = Math.round(Math.max(0, Math.min(255, blended)));
    }

    // Apply LUT to image
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(
        0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
      );
      const enhanced = lut[luminance] ?? luminance;
      const ratio = luminance > 0 ? enhanced / luminance : 1;

      // Apply enhancement while preserving color ratios
      data[i] = this.clamp((data[i] ?? 0) * ratio);
      data[i + 1] = this.clamp((data[i + 1] ?? 0) * ratio);
      data[i + 2] = this.clamp((data[i + 2] ?? 0) * ratio);
    }

    return new ImageData(data, width, height);
  }

  /**
   * Analyzes image polarity to detect inverted text (light on dark background).
   * Uses edge-based analysis to determine if text is darker or lighter than background.
   *
   * @param imageData - The image to analyze
   * @returns Polarity analysis with confidence score
   */
  analyzePolarity(imageData: ImageData): PolarityAnalysis {
    const { width, height, data } = imageData;
    const totalPixels = width * height;

    // Calculate luminance statistics
    let totalLuminance = 0;
    let darkPixels = 0;
    const luminances = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const luminance = Math.round(
        0.299 * (data[idx] ?? 0) + 0.587 * (data[idx + 1] ?? 0) + 0.114 * (data[idx + 2] ?? 0)
      );
      luminances[i] = luminance;
      totalLuminance += luminance;
      if (luminance < 128) {
        darkPixels++;
      }
    }

    const meanLuminance = totalLuminance / totalPixels;
    const darkPixelRatio = darkPixels / totalPixels;

    // For text images, we expect:
    // - Dark text on light background: high mean luminance, low dark pixel ratio
    // - Light text on dark background: low mean luminance, high dark pixel ratio

    // Use edge detection to find text regions and compare with background
    let edgeLuminanceSum = 0;
    let backgroundLuminanceSum = 0;
    let edgeCount = 0;
    let backgroundCount = 0;

    // Simple edge detection using horizontal gradients
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const current = luminances[idx] ?? 0;
        const left = luminances[idx - 1] ?? 0;
        const right = luminances[idx + 1] ?? 0;
        const gradient = Math.abs(current - left) + Math.abs(current - right);

        if (gradient > 30) {
          // This is an edge pixel (likely text boundary)
          edgeLuminanceSum += current;
          edgeCount++;
        } else if (gradient < 5) {
          // This is a uniform area (likely background or text interior)
          backgroundLuminanceSum += current;
          backgroundCount++;
        }
      }
    }

    // Determine inversion based on edge vs background luminance
    let isInverted = false;
    let confidence = 0.5;

    if (edgeCount > 0 && backgroundCount > 0) {
      const avgEdgeLuminance = edgeLuminanceSum / edgeCount;
      const avgBackgroundLuminance = backgroundLuminanceSum / backgroundCount;

      // If background is darker than edges, image is inverted
      if (avgBackgroundLuminance < avgEdgeLuminance - 20) {
        isInverted = true;
        confidence = Math.min(1, (avgEdgeLuminance - avgBackgroundLuminance) / 100);
      } else if (avgBackgroundLuminance > avgEdgeLuminance + 20) {
        isInverted = false;
        confidence = Math.min(1, (avgBackgroundLuminance - avgEdgeLuminance) / 100);
      }
    } else {
      // Fallback: use overall luminance
      isInverted = meanLuminance < 128;
      confidence = Math.abs(meanLuminance - 128) / 128;
    }

    return {
      isInverted,
      confidence,
      meanLuminance,
      darkPixelRatio,
    };
  }

  /**
   * Normalizes image polarity to ensure dark text on light background.
   * TrOCR expects this standard polarity for best results.
   *
   * @param imageData - The image to normalize
   * @param forceInvert - If provided, forces inversion regardless of detection
   * @returns Image with normalized polarity (dark text on light background)
   */
  normalizePolarity(imageData: ImageData, forceInvert?: boolean): ImageData {
    const shouldInvert = forceInvert ?? this.analyzePolarity(imageData).isInverted;

    if (!shouldInvert) {
      return imageData; // Already correct polarity
    }

    const data = new Uint8ClampedArray(imageData.data);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - (data[i] ?? 0);
      data[i + 1] = 255 - (data[i + 1] ?? 0);
      data[i + 2] = 255 - (data[i + 2] ?? 0);
      // Alpha channel unchanged
    }

    return new ImageData(data, imageData.width, imageData.height);
  }

  /**
   * Converts image to grayscale while preserving 3-channel RGB format.
   * TrOCR expects 3-channel input, so this maintains compatibility
   * while removing color information that might confuse the model.
   *
   * @param imageData - The image to convert
   * @returns Grayscale image in 3-channel RGB format
   */
  toGrayscaleRGB(imageData: ImageData): ImageData {
    const data = new Uint8ClampedArray(imageData.data);

    for (let i = 0; i < data.length; i += 4) {
      // Use ITU-R BT.601 weights for perceptual grayscale
      const gray = Math.round(
        0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
      );
      // Set all three channels to same value (maintains RGB format)
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      // Alpha unchanged
    }

    return new ImageData(data, imageData.width, imageData.height);
  }

  /**
   * Applies preprocessing based on the specified mode.
   * This is the main entry point for TrOCR-optimized preprocessing.
   *
   * @param imageData - The image to preprocess
   * @param mode - Preprocessing intensity: 'none', 'light', or 'aggressive'
   * @param normalizePolarity - Whether to normalize polarity. Default: true
   * @returns Preprocessed image optimized for TrOCR
   */
  preprocessForTrOCR(
    imageData: ImageData,
    mode: PreprocessingMode = 'light',
    normalizePolarity: boolean = true
  ): ImageData {
    let processed = imageData;

    // Step 1: Normalize polarity if requested (ensures dark text on light bg)
    if (normalizePolarity) {
      processed = this.normalizePolarity(processed);
    }

    // Step 2: Apply mode-specific preprocessing
    switch (mode) {
      case 'none':
        // No additional processing - best for clean, high-quality scans
        break;

      case 'light':
        // Gentle processing that preserves fine details
        // Convert to grayscale RGB (removes color noise but keeps 3-channel format)
        processed = this.toGrayscaleRGB(processed);
        // Apply very gentle contrast enhancement
        processed = this.gentleContrastEnhance(processed, 0.2);
        break;

      case 'aggressive':
        // Full processing for difficult images (faded, low contrast)
        // Convert to grayscale RGB
        processed = this.toGrayscaleRGB(processed);
        // Apply stronger contrast enhancement
        processed = this.gentleContrastEnhance(processed, 0.5);
        // Additional global contrast boost for very faded images
        processed = this.enhanceContrast(processed, 0.1);
        break;
    }

    return processed;
  }

  resize(imageData: ImageData, maxDimension: number): ImageData {
    const { width, height } = imageData;
    const largestDimension = Math.max(width, height);
    if (largestDimension <= maxDimension) {
      return imageData;
    }

    const scale = maxDimension / largestDimension;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = this.createCanvas(targetWidth, targetHeight);
    const context = this.getContext(canvas);
    const sourceCanvas = this.createCanvas(width, height);
    const sourceContext = this.getContext(sourceCanvas);

    sourceContext.putImageData(imageData, 0, 0);
    context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

    return context.getImageData(0, 0, targetWidth, targetHeight);
  }

  /**
   * Analyzes image resolution to determine if text is likely too small for reliable OCR.
   * Uses edge detection heuristics to estimate stroke width.
   *
   * @param imageData - The image to analyze
   * @param expectedCharHeight - Expected character height (if known). Default: image height
   * @returns Resolution analysis with recommendations
   */
  analyzeResolution(
    imageData: ImageData,
    expectedCharHeight?: number
  ): ResolutionAnalysis {
    const { width, height } = imageData;
    const charHeight = expectedCharHeight ?? height;

    // Estimate stroke width using edge density analysis
    const strokeWidth = this.estimateStrokeWidth(imageData);

    // Calculate how many pixels the text would occupy after TrOCR's resize
    const effectiveScale = TROCR_TARGET_SIZE / Math.max(width, height);
    const scaledCharHeight = charHeight * effectiveScale;
    const scaledStrokeWidth = strokeWidth * effectiveScale;

    // Determine if upscaling is needed
    let recommendedScale = 1.0;
    let isSuitable = true;
    let warning: string | undefined;

    if (scaledCharHeight < MIN_CHAR_HEIGHT_PX) {
      // Characters will be too small after resize
      recommendedScale = Math.min(
        MAX_UPSCALE_FACTOR,
        MIN_CHAR_HEIGHT_PX / scaledCharHeight
      );
      isSuitable = false;
      warning = `Text appears too small (${Math.round(scaledCharHeight)}px after resize). ` +
        `Recommend ${recommendedScale.toFixed(1)}x upscaling.`;
    } else if (scaledStrokeWidth < 2) {
      // Strokes may become too thin
      recommendedScale = Math.min(MAX_UPSCALE_FACTOR, 3 / scaledStrokeWidth);
      isSuitable = scaledStrokeWidth >= 1.5;
      warning = `Thin strokes detected (${scaledStrokeWidth.toFixed(1)}px). ` +
        `May cause recognition issues.`;
    }

    return {
      isSuitable,
      estimatedStrokeWidth: strokeWidth,
      recommendedScale,
      warning,
    };
  }

  /**
   * Estimates the average stroke width using Sobel edge detection.
   * Thin strokes (< 2px) often cause recognition problems.
   */
  private estimateStrokeWidth(imageData: ImageData): number {
    const { width, height, data } = imageData;

    if (width < 3 || height < 3) {
      return 1; // Too small to analyze
    }

    // Convert to grayscale intensity array
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * (data[idx] ?? 0) + 0.587 * (data[idx + 1] ?? 0) + 0.114 * (data[idx + 2] ?? 0);
    }

    // Apply Sobel operator for edge magnitude
    let edgeCount = 0;
    let totalMagnitude = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;

        // Sobel kernels
        const gx =
          -1 * (gray[idx - width - 1] ?? 0) + 1 * (gray[idx - width + 1] ?? 0) +
          -2 * (gray[idx - 1] ?? 0) + 2 * (gray[idx + 1] ?? 0) +
          -1 * (gray[idx + width - 1] ?? 0) + 1 * (gray[idx + width + 1] ?? 0);

        const gy =
          -1 * (gray[idx - width - 1] ?? 0) - 2 * (gray[idx - width] ?? 0) - 1 * (gray[idx - width + 1] ?? 0) +
          1 * (gray[idx + width - 1] ?? 0) + 2 * (gray[idx + width] ?? 0) + 1 * (gray[idx + width + 1] ?? 0);

        const magnitude = Math.sqrt(gx * gx + gy * gy);

        if (magnitude > 30) { // Edge threshold
          edgeCount++;
          totalMagnitude += magnitude;
        }
      }
    }

    if (edgeCount === 0) {
      return Math.min(width, height) / 10; // No edges found, estimate based on size
    }

    // Estimate stroke width from edge density
    // Higher edge density with low magnitude suggests thin strokes
    const edgeDensity = edgeCount / (width * height);
    const avgMagnitude = totalMagnitude / edgeCount;

    // Empirical formula: thicker strokes have lower edge density and higher magnitude
    const estimatedWidth = Math.max(1, Math.min(20, avgMagnitude / 50 / Math.max(0.01, edgeDensity)));

    return estimatedWidth;
  }

  /**
   * Upscales an image by the given factor using high-quality interpolation.
   * Useful for improving OCR on low-resolution images.
   *
   * @param imageData - The image to upscale
   * @param scale - Scale factor (e.g., 2.0 for 2x upscaling)
   * @returns Upscaled image data
   */
  upscale(imageData: ImageData, scale: number): ImageData {
    if (scale <= 1) {
      return imageData;
    }

    const { width, height } = imageData;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = this.createCanvas(targetWidth, targetHeight);
    const context = this.getContext(canvas);

    // Use high-quality scaling
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const sourceCanvas = this.createCanvas(width, height);
    const sourceContext = this.getContext(sourceCanvas);
    sourceContext.putImageData(imageData, 0, 0);

    context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

    return context.getImageData(0, 0, targetWidth, targetHeight);
  }

  /**
   * Prepares an image for TrOCR processing with intelligent resolution handling.
   * Ensures text remains crisp and properly sized for the 384x384 input.
   * Uses the new preprocessing mode system for TrOCR-optimized image enhancement.
   *
   * @param imageData - The source image
   * @param options - Preprocessing configuration
   * @returns Preprocessed image optimized for TrOCR
   */
  prepareForTrOCR(
    imageData: ImageData,
    options: TrOCRPreprocessOptions = {}
  ): { imageData: ImageData; analysis: ResolutionAnalysis } {
    const {
      targetSize = TROCR_TARGET_SIZE,
      // minCharHeight reserved for future per-call override
      maxUpscale = MAX_UPSCALE_FACTOR,
      preprocessingMode = 'light',
      normalizePolarity = true,
      enhanceContrast, // Deprecated, but still supported for backwards compatibility
    } = options;

    // Analyze current resolution
    const analysis = this.analyzeResolution(imageData);

    let processed = imageData;

    // Apply intelligent upscaling if needed (before preprocessing to preserve quality)
    if (analysis.recommendedScale > 1) {
      const safeScale = Math.min(analysis.recommendedScale, maxUpscale);
      processed = this.upscale(processed, safeScale);

      // Update analysis after upscaling
      analysis.recommendedScale = 1.0;
      analysis.isSuitable = true;
      if (analysis.warning) {
        analysis.warning = `Applied ${safeScale.toFixed(1)}x upscaling. ` + analysis.warning;
      }
    }

    // Apply TrOCR-optimized preprocessing based on mode
    // If deprecated enhanceContrast is explicitly set, map to preprocessing mode for compatibility
    let effectiveMode = preprocessingMode;
    if (typeof enhanceContrast !== 'undefined' && typeof options.preprocessingMode === 'undefined') {
      // Backwards compatibility: map old enhanceContrast to new mode
      effectiveMode = enhanceContrast ? 'light' : 'none';
    }

    processed = this.preprocessForTrOCR(processed, effectiveMode, normalizePolarity);

    // Ensure image doesn't exceed reasonable size (prevents memory issues)
    const maxProcessingSize = targetSize * 3; // Allow 3x target for quality
    if (Math.max(processed.width, processed.height) > maxProcessingSize) {
      processed = this.resize(processed, maxProcessingSize);
    }

    return { imageData: processed, analysis };
  }

  private async loadImageBitmap(file: File): Promise<ImageBitmap> {
    if (this.env.createImageBitmap) {
      return await this.env.createImageBitmap(file);
    }

    const ImageConstructor = this.env.Image ?? globalThis.Image;
    const urlApi = this.env.URL ?? globalThis.URL;
    const doc = this.env.document ?? globalThis.document;

    if (!ImageConstructor || !urlApi || !doc) {
      throw new Error('Image decoding is not available in this environment.');
    }

    return await new Promise<ImageBitmap>((resolve, reject) => {
      const image = new ImageConstructor();
      const objectUrl = urlApi.createObjectURL(file);

      image.onload = () => {
        urlApi.revokeObjectURL(objectUrl);
        resolve(image as unknown as ImageBitmap);
      };

      image.onerror = () => {
        urlApi.revokeObjectURL(objectUrl);
        reject(new Error('Failed to decode image.'));
      };

      image.src = objectUrl;
    });
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement {
    if (this.env.createCanvas) {
      return this.env.createCanvas(width, height);
    }

    const doc = this.env.document ?? globalThis.document;
    if (!doc) {
      throw new Error('Canvas creation is not available in this environment.');
    }

    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = this.env.getContext2d ? this.env.getContext2d(canvas) : canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    return context;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
}
