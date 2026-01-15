import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TransformersEngine } from '../src/engines/transformers-engine';
import { pipeline, env } from '@xenova/transformers';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
  env: { useBrowserCache: false },
  RawImage: vi.fn().mockImplementation(() => ({
    rgb: vi.fn().mockReturnThis(),
  })),
}));

const pipelineMock = vi.mocked(pipeline);

if (typeof ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = width ?? 0;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = width ?? 0;
        this.height = height ?? 0;
      }
    }
  }

  // @ts-expect-error - test environment polyfill
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

/**
 * Creates a test image with horizontal text lines.
 */
function createTestImageWithLines(
  width: number,
  height: number,
  linePositions: Array<{ start: number; end: number }>
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  for (const { start, end } of linePositions) {
    for (let y = start; y <= end && y < height; y++) {
      const inkStart = Math.floor(width * 0.1);
      const inkEnd = Math.floor(width * 0.9);
      for (let x = inkStart; x < inkEnd; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      }
    }
  }

  return new ImageData(data, width, height);
}

describe('TransformersEngine property tests', () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it('selects WebGPU only when available', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (webgpuAvailable) => {
        const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'ok' }]);
        pipelineMock.mockResolvedValueOnce(pipelineInstance);

        const engine = new TransformersEngine({ webgpu: webgpuAvailable });
        await engine.load();

        expect(pipelineMock).toHaveBeenCalledWith(
          'image-to-text',
          'Xenova/trocr-base-printed',
          expect.objectContaining({
            device: webgpuAvailable ? 'webgpu' : 'cpu',
          })
        );
      }),
      { numRuns: 20 }
    );
  });
});

describe('TransformersEngine unit tests', () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  const createTestImageData = () => {
    if (typeof ImageData !== 'undefined') {
      return new ImageData(1, 1);
    }
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;
  };

  it('enables browser caching during load', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'ok' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false });
    await engine.load();

    expect(env.useBrowserCache).toBe(true);
  });

  it('invokes progress callback during load', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'ok' }]);
    pipelineMock.mockImplementationOnce(async (_task, _model, options) => {
      options?.progress_callback?.({ status: 'loading', progress: 0.3 });
      return pipelineInstance;
    });

    const progressSpy = vi.fn();
    const engine = new TransformersEngine({ onProgress: progressSpy, webgpu: false });
    await engine.load();

    expect(progressSpy).toHaveBeenCalledWith('loading', 0.3);
  });

  it('processes images and returns text', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'OCR' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false });
    await engine.load();

    const result = await engine.process(createTestImageData());
    expect(result).toBe('OCR');
  });

  it('destroys pipeline resources when available', async () => {
    const dispose = vi.fn();
    const pipelineInstance = Object.assign(vi.fn().mockResolvedValue([{ text: 'ok' }]), { dispose });
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false });
    await engine.load();
    await engine.destroy();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('TransformersEngine multiline support', () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it('processes multiline images by calling pipeline for each line', async () => {
    const pipelineInstance = vi
      .fn()
      .mockResolvedValueOnce([{ generated_text: 'Line 1' }])
      .mockResolvedValueOnce([{ generated_text: 'Line 2' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false, multiline: true });
    await engine.load();

    // Create image with two text lines
    const imageData = createTestImageWithLines(200, 150, [
      { start: 20, end: 40 },
      { start: 80, end: 100 },
    ]);

    const result = await engine.process(imageData);

    expect(result).toBe('Line 1\nLine 2');
    expect(pipelineInstance).toHaveBeenCalledTimes(2);
  });

  it('processes single-line images without segmentation', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'Single line' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false, multiline: true });
    await engine.load();

    // Create wide single-line image
    const imageData = createTestImageWithLines(400, 30, [{ start: 5, end: 25 }]);

    const result = await engine.process(imageData);

    expect(result).toBe('Single line');
    expect(pipelineInstance).toHaveBeenCalledTimes(1);
  });

  it('skips multiline processing when disabled', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'Full image' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false, multiline: false });
    await engine.load();

    // Create image with multiple lines but process as single
    const imageData = createTestImageWithLines(200, 150, [
      { start: 20, end: 40 },
      { start: 80, end: 100 },
    ]);

    const result = await engine.process(imageData);

    expect(result).toBe('Full image');
    expect(pipelineInstance).toHaveBeenCalledTimes(1);
  });

  it('handles empty lines gracefully', async () => {
    const pipelineInstance = vi
      .fn()
      .mockResolvedValueOnce([{ generated_text: 'Line 1' }])
      .mockResolvedValueOnce([{ generated_text: '' }])
      .mockResolvedValueOnce([{ generated_text: 'Line 3' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false, multiline: true });
    await engine.load();

    const imageData = createTestImageWithLines(200, 200, [
      { start: 20, end: 35 },
      { start: 70, end: 85 },
      { start: 120, end: 135 },
    ]);

    const result = await engine.process(imageData);

    // Empty lines should be filtered out
    expect(result).toBe('Line 1\nLine 3');
  });

  it('trims whitespace from each line', async () => {
    const pipelineInstance = vi
      .fn()
      .mockResolvedValueOnce([{ generated_text: '  Line with spaces  ' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    const engine = new TransformersEngine({ webgpu: false, multiline: true });
    await engine.load();

    const imageData = createTestImageWithLines(400, 30, [{ start: 5, end: 25 }]);

    const result = await engine.process(imageData);

    expect(result).toBe('Line with spaces');
  });

  it('enables multiline by default', async () => {
    const pipelineInstance = vi
      .fn()
      .mockResolvedValueOnce([{ generated_text: 'Line A' }])
      .mockResolvedValueOnce([{ generated_text: 'Line B' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);

    // No multiline option specified - should default to true
    const engine = new TransformersEngine({ webgpu: false });
    await engine.load();

    const imageData = createTestImageWithLines(200, 150, [
      { start: 20, end: 40 },
      { start: 80, end: 100 },
    ]);

    const result = await engine.process(imageData);

    expect(result).toBe('Line A\nLine B');
  });
});
