import { describe, it, expect } from 'vitest';
import { mapOcrLanguageToBergamot } from '../src/utils/ocr-language-to-bergamot';

describe('mapOcrLanguageToBergamot', () => {
  it('maps common tesseract codes', () => {
    expect(mapOcrLanguageToBergamot('tesseract', 'eng')).toBe('en');
    expect(mapOcrLanguageToBergamot('tesseract', 'spa')).toBe('es');
    expect(mapOcrLanguageToBergamot('tesseract', 'chi_sim')).toBe('zh');
    expect(mapOcrLanguageToBergamot('tesseract', 'deu')).toBe('de');
  });

  it('maps easyocr codes', () => {
    expect(mapOcrLanguageToBergamot('easyocr', 'en')).toBe('en');
    expect(mapOcrLanguageToBergamot('easyocr', 'ch_sim')).toBe('zh');
  });

  it('maps esearch language labels', () => {
    expect(mapOcrLanguageToBergamot('esearch', 'english')).toBe('en');
    expect(mapOcrLanguageToBergamot('esearch', 'korean')).toBe('ko');
  });

  it('returns null for unsupported language', () => {
    expect(mapOcrLanguageToBergamot('tesseract', 'bod')).toBeNull();
  });
});
