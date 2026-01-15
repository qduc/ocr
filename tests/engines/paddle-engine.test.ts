import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaddleEngine } from '@/engines/paddle-engine';
import * as ocr from '@paddlejs-models/ocr';

// Mock ImageData if not available in environment
if (typeof ImageData === 'undefined') {
  (global as any).ImageData = class {
    data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

vi.mock('@paddlejs-models/ocr', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  recognize: vi.fn(),
}));

describe('PaddleEngine', () => {
  let engine: PaddleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PaddleEngine();
  });

  it('should have correct id', () => {
    expect(engine.id).toBe('paddle');
  });

  it('should load successfully', async () => {
    await engine.load();
    expect(ocr.init).toHaveBeenCalled();
  });

  it('should throw error if processing before load', async () => {
    const imageData = new ImageData(1, 1);
    await expect(engine.process(imageData)).rejects.toThrow('PaddleOCR engine not loaded.');
  });

  it('should process image after load', async () => {
    await engine.load();
    const mockResult = {
      text: ['Hello', 'World'],
      points: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
    };
    (ocr.recognize as any).mockResolvedValue(mockResult);

    const imageData = new ImageData(10, 10);
    // Mocking document.createElement for canvas
    const mockCanvas = {
      getContext: vi.fn().mockReturnValue({
        putImageData: vi.fn(),
      }),
      width: 10,
      height: 10,
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

    const result = await engine.process(imageData);
    expect(result).toBe('Hello\nWorld');
    expect(ocr.recognize).toHaveBeenCalledWith(mockCanvas);
  });
});
