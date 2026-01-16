import { pipeline, env, RawImage } from '@xenova/transformers';
import type { IOCREngine } from '@/types/ocr-engine';
import { LineSegmenter, LineSegmenterOptions } from '@/utils/line-segmenter';

export type TransformersProgressCallback = (status: string, progress: number) => void;

type ImageInput =
  | ImageData
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | Blob
  | string;

/**
 * Generation configuration options for the text decoder.
 * These parameters control how the model generates text from the image.
 */
export interface GenerationConfig {
  /**
   * Maximum number of new tokens to generate.
   * Should be set high enough to avoid truncation (100-200 for typical lines).
   * @default 150
   */
  max_new_tokens?: number;

  /**
   * Number of beams for beam search.
   * Higher values (3-5) improve quality on noisy images but are slower.
   * Set to 1 for greedy decoding.
   * @default 4
   */
  num_beams?: number;

  /**
   * Whether to use sampling instead of greedy/beam search.
   * Should typically be false for OCR to ensure deterministic output.
   * @default false
   */
  do_sample?: boolean;

  /**
   * Length penalty for beam search.
   * Values > 1.0 encourage longer sequences, < 1.0 encourage shorter.
   * @default 1.0
   */
  length_penalty?: number;

  /**
   * Penalty applied to repeated tokens.
   * Values > 1.0 discourage repetition.
   * @default 1.5
   */
  repetition_penalty?: number;

  /**
   * Size of n-grams that cannot repeat.
   * Set to 2-3 to prevent word/phrase repetition.
   * @default 3
   */
  no_repeat_ngram_size?: number;

  /**
   * Whether to stop generation early when all beams reach EOS.
   * @default true
   */
  early_stopping?: boolean;
}

/**
 * Default generation configuration optimized for OCR tasks.
 * These settings balance accuracy and performance for typical text recognition.
 */
const DEFAULT_GENERATION_CONFIG: Required<GenerationConfig> = {
  max_new_tokens: 150,
  num_beams: 4,
  do_sample: false,
  length_penalty: 1.0,
  repetition_penalty: 1.5,
  no_repeat_ngram_size: 3,
  early_stopping: true,
};

type ImageToTextPipeline = (
  image: ImageInput,
  options?: GenerationConfig
) => Promise<Array<{ generated_text?: string; text?: string }>>;

/** TrOCR's expected input dimension */
const TROCR_INPUT_SIZE = 384;

/** Minimum character height for reliable recognition */
const MIN_CHAR_HEIGHT_PX = 20;

/** Maximum upscale factor to prevent excessive blur */
const MAX_UPSCALE_FACTOR = 4;

/** Minimum text-to-canvas ratio to avoid tiny text in large padding */
const MIN_TEXT_COVERAGE_RATIO = 0.3;

export interface TransformersEngineOptions {
  onProgress?: TransformersProgressCallback;
  webgpu?: boolean;
  /** Enable multiline support via line segmentation. Default: true */
  multiline?: boolean;
  /** Options for line segmentation algorithm */
  lineSegmenterOptions?: LineSegmenterOptions;
  /** Minimum character height in pixels for upscaling decision. Default: 20 */
  minCharHeight?: number;
  /**
   * Generation/decoding configuration for the text model.
   * Controls max tokens, beam search, and repetition handling.
   * Sensible defaults are provided - override only if needed.
   */
  generationConfig?: GenerationConfig;
}

export class TransformersEngine implements IOCREngine {
  public readonly id = 'transformers';
  public isLoading = false;
  private pipelineInstance: ImageToTextPipeline | null = null;
  private readonly onProgress?: TransformersProgressCallback;
  private readonly webgpuOverride?: boolean;
  private readonly multilineEnabled: boolean;
  private readonly lineSegmenter: LineSegmenter;
  private readonly minCharHeight: number;
  private readonly generationConfig: Required<GenerationConfig>;

  constructor(options: TransformersEngineOptions = {}) {
    this.onProgress = options.onProgress;
    this.webgpuOverride = options.webgpu;
    this.multilineEnabled = options.multiline ?? true;
    this.lineSegmenter = new LineSegmenter(options.lineSegmenterOptions);
    this.minCharHeight = options.minCharHeight ?? MIN_CHAR_HEIGHT_PX;
    this.generationConfig = {
      ...DEFAULT_GENERATION_CONFIG,
      ...options.generationConfig,
    };
  }

  async load(): Promise<void> {
    if (this.pipelineInstance) {
      return;
    }

    this.isLoading = true;
    try {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.localModelPath = '/transformers-models/';
      env.useBrowserCache = true;
      const device = this.isWebGPUSupported() ? 'webgpu' : 'cpu';
      this.pipelineInstance = (await pipeline('image-to-text', 'Xenova/trocr-base-printed', {
        device,
        progress_callback: (status) => {
          if (this.onProgress) {
            this.onProgress(status.status ?? 'loading', status.progress ?? 0);
          }
        },
      })) as ImageToTextPipeline;
    } finally {
      this.isLoading = false;
    }
  }

  async process(data: ImageData): Promise<string> {
    if (!this.pipelineInstance) {
      throw new Error('Transformers engine not loaded.');
    }

    if (!data || data.width <= 0 || data.height <= 0) {
      throw new Error('Invalid image data for OCR.');
    }

    // Check if multiline processing should be used
    if (this.multilineEnabled && this.lineSegmenter.isMultiline(data)) {
      return this.processMultiline(data);
    }

    return this.processSingleLine(data);
  }

  /**
   * Processes a single line of text with intelligent resolution handling.
   * Upscales small text and applies optimal padding for TrOCR's 384x384 input.
   * Uses configured generation parameters to prevent truncation and repetition.
   */
  private async processSingleLine(data: ImageData): Promise<string> {
    // Apply intelligent upscaling and padding
    const prepared = this.prepareImageForTrOCR(data);
    const rawImage = new RawImage(prepared.data, prepared.width, prepared.height, 4).rgb();

    // Pass generation config to control decoding behavior
    const results = await this.pipelineInstance!(rawImage, this.generationConfig);
    const first = results[0];
    return (first?.generated_text ?? first?.text ?? '').trim();
  }

  /**
   * Prepares an image for TrOCR by ensuring adequate text size and proper padding.
   * Addresses resolution + resizing pitfalls:
   * 1. Upscales if text appears too small
   * 2. Uses proportional padding to maintain text prominence
   * 3. Ensures strokes remain crisp after TrOCR's internal resize
   *
   * @param imageData - Source image (typically a single line of text)
   * @returns Image optimized for TrOCR processing
   */
  private prepareImageForTrOCR(imageData: ImageData): ImageData {
    const { width, height } = imageData;

    // Calculate effective size after TrOCR's resize to 384x384
    const largerDim = Math.max(width, height);
    const effectiveScale = TROCR_INPUT_SIZE / largerDim;
    const effectiveHeight = height * effectiveScale;

    // Step 1: Upscale if text would be too small after TrOCR's internal resize
    let processed = imageData;
    if (effectiveHeight < this.minCharHeight) {
      const upscaleFactor = Math.min(
        MAX_UPSCALE_FACTOR,
        this.minCharHeight / effectiveHeight
      );
      processed = this.upscaleImage(processed, upscaleFactor);
    }

    // Step 2: Apply smart padding that avoids making text appear tiny
    return this.smartPadToSquare(processed);
  }

  /**
   * Upscales an image using high-quality interpolation.
   * Uses canvas scaling for smooth results.
   *
   * @param imageData - Image to upscale
   * @param factor - Scale factor (e.g., 2.0 for 2x)
   * @returns Upscaled image
   */
  private upscaleImage(imageData: ImageData, factor: number): ImageData {
    if (factor <= 1) {
      return imageData;
    }

    const { width, height } = imageData;
    const newWidth = Math.round(width * factor);
    const newHeight = Math.round(height * factor);

    // Create canvases for scaling
    const sourceCanvas = this.createCanvas(width, height);
    const sourceCtx = sourceCanvas.getContext('2d');
    const targetCanvas = this.createCanvas(newWidth, newHeight);
    const targetCtx = targetCanvas.getContext('2d');

    if (!sourceCtx || !targetCtx) {
      return imageData; // Fallback to original
    }

    // Draw source image
    sourceCtx.putImageData(imageData, 0, 0);

    // Apply high-quality scaling
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);

    return targetCtx.getImageData(0, 0, newWidth, newHeight);
  }

  /**
   * Pads an image to square with intelligent sizing to maintain text prominence.
   * Unlike simple square padding, this ensures text doesn't become tiny relative
   * to the canvas by limiting padding to a proportional amount.
   *
   * Key improvements over naive padding:
   * - Limits padding so text remains at least MIN_TEXT_COVERAGE_RATIO of the canvas
   * - For very wide/tall images, may not pad to full square to preserve text scale
   * - Centers text with appropriate margins for TrOCR's receptive field
   */
  private smartPadToSquare(imageData: ImageData): ImageData {
    const { width, height, data } = imageData;

    // Already square or nearly so - minimal padding needed
    if (Math.abs(width - height) <= 2) {
      return imageData;
    }

    // Calculate the minimum dimension to maintain text coverage
    const minorDim = Math.min(width, height);
    const majorDim = Math.max(width, height);

    // Calculate target size: ensure text occupies at least MIN_TEXT_COVERAGE_RATIO
    // of the final canvas to prevent "tiny text in huge padding" problem
    const minSizeForCoverage = Math.ceil(minorDim / MIN_TEXT_COVERAGE_RATIO);
    const targetSize = Math.max(majorDim, Math.min(minSizeForCoverage, majorDim * 2));

    // Cap at a reasonable maximum to prevent memory issues
    const maxTargetSize = TROCR_INPUT_SIZE * 3; // 1152px max
    const finalSize = Math.min(targetSize, maxTargetSize);

    // If the calculated size equals major dimension, do simple square padding
    // Otherwise, use the coverage-aware size
    const paddedSize = finalSize;

    // Create padded image with white background
    const paddedData = new Uint8ClampedArray(paddedSize * paddedSize * 4);

    // Fill with white (255, 255, 255, 255)
    for (let i = 0; i < paddedData.length; i += 4) {
      paddedData[i] = 255;
      paddedData[i + 1] = 255;
      paddedData[i + 2] = 255;
      paddedData[i + 3] = 255;
    }

    // Center the original image in the padded canvas
    const offsetX = Math.floor((paddedSize - width) / 2);
    const offsetY = Math.floor((paddedSize - height) / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = ((offsetY + y) * paddedSize + (offsetX + x)) * 4;
        paddedData[dstIdx] = data[srcIdx] ?? 255;
        paddedData[dstIdx + 1] = data[srcIdx + 1] ?? 255;
        paddedData[dstIdx + 2] = data[srcIdx + 2] ?? 255;
        paddedData[dstIdx + 3] = data[srcIdx + 3] ?? 255;
      }
    }

    return new ImageData(paddedData, paddedSize, paddedSize);
  }

  /**
   * Processes multiline text by segmenting into individual lines.
   */
  private async processMultiline(data: ImageData): Promise<string> {
    const lineImages = this.lineSegmenter.extractLines(data);
    const lineTexts: string[] = [];

    for (const lineImage of lineImages) {
      const text = await this.processSingleLine(lineImage);
      if (text) {
        lineTexts.push(text);
      }
    }

    return lineTexts.join('\n');
  }

  async destroy(): Promise<void> {
    const pipelineInstance = this.pipelineInstance as unknown as { dispose?: () => void };
    if (pipelineInstance?.dispose) {
      pipelineInstance.dispose();
    }
    this.pipelineInstance = null;
  }

  private isWebGPUSupported(): boolean {
    if (typeof this.webgpuOverride !== 'undefined') {
      return this.webgpuOverride;
    }
    return typeof navigator !== 'undefined' && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  }

  private async imageDataToBlob(imageData: ImageData): Promise<Blob> {
    const { width, height } = imageData;
    const canvas = this.createCanvas(width, height);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    context.putImageData(imageData, 0, 0);

    if ('convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    }

    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode image for OCR.'));
        }
      }, 'image/png');
    });
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }

    throw new Error('Canvas creation is not available in this environment.');
  }
}
