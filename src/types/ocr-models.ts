export interface EngineConfig {
  id: string;
  name: string;
  description: string;
  requiresWebGPU: boolean;
  estimatedModelSize: number;
  supportedLanguages: string[];
}

export const ENGINE_CONFIGS: Record<string, EngineConfig> = {
  tesseract: {
    id: 'tesseract',
    name: 'Tesseract.js',
    description: 'Traditional OCR engine with broad language support',
    requiresWebGPU: false,
    estimatedModelSize: 4.5,
    supportedLanguages: ['eng'],
  },
  transformers: {
    id: 'transformers',
    name: 'Transformers.js (TrOCR)',
    description: 'Transformer-based OCR with higher accuracy',
    requiresWebGPU: false,
    estimatedModelSize: 85,
    supportedLanguages: ['eng'],
  },
  paddle: {
    id: 'paddle',
    name: 'PaddleOCR JS',
    description: 'High-accuracy OCR using Paddle.js (Baidu)',
    requiresWebGPU: false,
    estimatedModelSize: 15,
    supportedLanguages: ['eng', 'ch'],
  },
};

export interface OCRResult {
  text: string;
  confidence?: number;
  processingTime: number;
  engineId: string;
}

export interface LoadingState {
  isLoading: boolean;
  progress: number;
  stage: 'idle' | 'downloading' | 'initializing' | 'processing' | 'complete' | 'error';
  message: string;
}
