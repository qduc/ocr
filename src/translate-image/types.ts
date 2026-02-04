import type { OCRItem, OCRStyle, OCRQuad } from '@/types/ocr-engine';
import type { ITextTranslator } from '@/types/translation';

export type RGB = [number, number, number];

export interface Region {
  id: string;
  items: OCRItem[];
  bbox: { x: number; y: number; width: number; height: number };
  quad: OCRQuad;
  sourceLines: string[];
  sourceLineCount: number;
  translatedText?: string;
  style?: OCRStyle;
}

export interface TranslateImageInput {
  original: ImageData;
  ocrItems: OCRItem[];
  engineId: string;
  from: string;
  to: string;
  translator: ITextTranslator;
  ocrSize: { width: number; height: number };
}

export interface TranslateImageOptions {
  debug?: boolean;
}

export interface TranslateImageOutput {
  blob: Blob;
  debug?: { regions: Region[] };
}
