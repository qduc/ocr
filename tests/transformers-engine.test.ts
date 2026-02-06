import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TransformersEngine } from '../src/engines/transformers-engine';
import { pipeline, env } from '@xenova/transformers';

if (typeof ImageData === 'undefined') {
  global.ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(arg1: any, arg2: any, arg3?: any) {
      if (arg3 !== undefined) {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3;
      } else {
        this.data = new Uint8ClampedArray(arg1 * arg2 * 4);
        this.width = arg1;
        this.height = arg2;
      }
    }
  } as any;
}

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
  env: { useBrowserCache: false },
  RawImage: class {
    constructor(public data: unknown, public width: number, public height: number, public channels: number) {}
    rgb(): this {
      return this;
    }
  },
}));

vi.mock('@/utils/model-cache', () => ({
  ModelCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@qduc/easyocr-web', () => ({
  fetchModel: vi.fn().mockResolvedValue(new Uint8Array()),
  getDefaultModelBaseUrl: vi.fn().mockReturnValue(''),
  loadDetectorModel: vi.fn().mockResolvedValue({
    session: {
      run: vi.fn().mockResolvedValue({
        text: { data: new Float32Array(1), shape: [1, 1, 1, 1] },
        link: { data: new Float32Array(1), shape: [1, 1, 1, 1] },
      }),
    },
    inputName: 'input',
    textOutputName: 'text',
    linkOutputName: 'link',
  }),
  loadImage: vi.fn().mockResolvedValue({}),
}));

vi.mock('@qduc/easyocr-core', () => ({
  detectorPreprocess: vi.fn().mockReturnValue({ input: {}, scaleX: 1, scaleY: 1 }),
  tensorToHeatmap: vi.fn().mockReturnValue({ data: new Float32Array(), width: 1, height: 1 }),
  detectorPostprocess: vi.fn().mockReturnValue({
    horizontalList: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
    freeList: [],
  }),
  groupBoxesByLine: vi.fn().mockReturnValue([{
    boxes: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
    centerY: 5,
    height: 10
  }]),
  resolveOcrOptions: vi.fn().mockImplementation((opt) => opt),
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

  const createTestImageData = (): ImageData => {
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
    pipelineMock.mockImplementationOnce((_task, _model, options): Promise<unknown> => {
      options?.progress_callback?.({ status: 'loading', progress: 0.3 });
      return Promise.resolve(pipelineInstance);
    });

    const progressSpy = vi.fn();
    const engine = new TransformersEngine({ onProgress: progressSpy, webgpu: false });
    await engine.load();

    expect(progressSpy).toHaveBeenCalledWith('Ready', 1);
  });

  it('processes images and returns text', async () => {
    const pipelineInstance = vi.fn().mockResolvedValue([{ generated_text: 'OCR' }]);
    pipelineMock.mockResolvedValueOnce(pipelineInstance);
    global.createImageBitmap = vi.fn().mockResolvedValue({
      width: 10,
      height: 10,
      close: vi.fn(),
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue(new ImageData(10, 10)),
    } as any);

    const engine = new TransformersEngine({ webgpu: false });
    await engine.load();

    const result = await engine.process(createTestImageData());
    expect(result.text).toBe('OCR');
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0]).toMatchObject({
      text: 'OCR',
      confidence: 0.8,
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      quad: [[0, 0], [10, 0], [10, 10], [0, 10]],
    });
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
