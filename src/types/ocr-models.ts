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
  esearch: {
    id: 'esearch',
    name: 'eSearch-OCR (PaddleOCR)',
    description: 'High-accuracy OCR for multiple languages via PaddleOCR',
    requiresWebGPU: false,
    estimatedModelSize: 12,
    supportedLanguages: ['chi_sim', 'eng', 'ara', 'kor', 'tel', 'tam', 'tha', 'hin'],
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
