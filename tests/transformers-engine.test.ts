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
