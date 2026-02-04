export interface OCRPoint {
  x: number;
  y: number;
}

export type OCRQuad = [OCRPoint, OCRPoint, OCRPoint, OCRPoint];

export interface OCRStyle {
  bg?: [number, number, number];
  text?: [number, number, number];
}

export interface OCRItem {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  quad?: OCRQuad;
  style?: OCRStyle;
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
