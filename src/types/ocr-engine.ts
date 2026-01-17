export interface OCRItem {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCRResult {
  text: string;
  items?: OCRItem[];
}

export interface IOCREngine {
  id: string;
  isLoading: boolean;
  load(): Promise<void>;
  process(data: ImageData): Promise<OCRResult>;
  destroy(): Promise<void>;
}
