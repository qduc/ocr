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
    supportedLanguages: [
      'eng',
      'spa',
      'fra',
      'deu',
      'ita',
      'por',
      'nld',
      'pol',
      'rus',
      'jpn',
      'kor',
      'chi_sim',
    ],
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
    supportedLanguages: [
      'english',
      'chinese',
      'arabic',
      'korean',
      'latin',
      'tamil',
      'telugu',
      'thai',
      'eslav',
      'greek',
      'hindi',
    ],
  },
  easyocr: {
    id: 'easyocr',
    name: 'EasyOCR.js',
    description: 'EasyOCR models in-browser via ONNX Runtime',
    requiresWebGPU: false,
    estimatedModelSize: 110,
    supportedLanguages: ['en', 'latin', 'ch_sim', 'ja', 'ko', 'cyrillic', 'telugu', 'kannada'],
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
