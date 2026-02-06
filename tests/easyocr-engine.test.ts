import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EasyOCREngine } from '../src/engines/easyocr-engine';
import { loadDetectorModel, loadImage, loadRecognizerModel, recognize } from '@qduc/easyocr-web';
import type { DetectorModel, RecognizerModel, OcrResult } from '@qduc/easyocr-core';
import type { RasterImage } from '@qduc/easyocr-web';

// Mock easyocr-web
vi.mock('@qduc/easyocr-web', () => ({
  fetchModel: vi.fn().mockResolvedValue(new Uint8Array(10)),
  getDefaultModelBaseUrl: vi.fn().mockReturnValue('https://example.com/models'),
  loadDetectorModel: vi.fn(),
  loadImage: vi.fn(),
  loadRecognizerModel: vi.fn(),
  recognize: vi.fn(),
}));

// Mock model-cache
vi.mock('../src/utils/model-cache', () => ({
  ModelCache: vi.fn().mockImplementation(() => ({
    loadOrFetch: vi
      .fn()
      .mockImplementation((_url: string, fetcher: () => Promise<ArrayBuffer>) => fetcher()),
  })),
}));

// Mock onnxruntime-web
vi.mock('onnxruntime-web', () => ({
  env: {
    wasm: {
      wasmPaths: undefined,
    },
  },
}));

const loadDetectorMock = vi.mocked(loadDetectorModel);
const loadRecognizerMock = vi.mocked(loadRecognizerModel);
const loadImageMock = vi.mocked(loadImage);
const recognizeMock = vi.mocked(recognize);

describe('EasyOCREngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global fetch mock if needed, but we used ModelCache mock which calls fetcher
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      text: () => Promise.resolve('abc'),
    } as Response);
  });

  const createTestImageData = (): ImageData => {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;
  };

  it('loads models and reports progress', async () => {
    const progressSpy = vi.fn();
    const engine = new EasyOCREngine({ onProgress: progressSpy });

    loadDetectorMock.mockResolvedValue({} as DetectorModel);
    loadRecognizerMock.mockResolvedValue({} as RecognizerModel);

    await engine.load();

    expect(loadDetectorMock).toHaveBeenCalled();
    expect(loadRecognizerMock).toHaveBeenCalled();
    expect(progressSpy).toHaveBeenCalledWith('Ready', 1);
  });

  it('processes image and returns OCR result', async () => {
    const engine = new EasyOCREngine();

    const mockDetector = { id: 'detector' };
    const mockRecognizer = { id: 'recognizer' };
    loadDetectorMock.mockResolvedValue(mockDetector as unknown as DetectorModel);
    loadRecognizerMock.mockResolvedValue(mockRecognizer as unknown as RecognizerModel);

    await engine.load();

    const mockImage = { width: 1, height: 1 };
    loadImageMock.mockResolvedValue(mockImage as unknown as RasterImage);

    recognizeMock.mockResolvedValue([
      {
        text: 'Hello',
        confidence: 0.95,
        box: [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
      },
    ] as OcrResult[]);

    const result = await engine.process(createTestImageData());

    expect(result.text).toBe('Hello');
    expect(result.items).toHaveLength(1);
    expect(result.items![0].text).toBe('Hello');
    expect(result.items![0].confidence).toBe(0.95);
    expect(result.items![0].quad).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ]);
    expect(result.items![0].angle).toBe(0);
    expect(result.items![0].boundingBox).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 5,
    });
  });

  it('throws error if processing fails', async () => {
    const engine = new EasyOCREngine();
    loadDetectorMock.mockResolvedValue({} as DetectorModel);
    loadRecognizerMock.mockResolvedValue({} as RecognizerModel);
    await engine.load();

    recognizeMock.mockRejectedValue(new Error('Recognition failed'));

    await expect(engine.process(createTestImageData())).rejects.toThrow(
      'EasyOCR processing failed: Recognition failed'
    );
  });

  it('throws error if engine not loaded', async () => {
    const engine = new EasyOCREngine();
    await expect(engine.process(createTestImageData())).rejects.toThrow(
      'EasyOCR engine not loaded.'
    );
  });
});
