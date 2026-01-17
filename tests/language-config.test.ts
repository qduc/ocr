import { describe, it, expect } from 'vitest';
import { normalizeTesseractLanguage, TESSERACT_LANGUAGES } from '../src/utils/language-config';

describe('normalizeTesseractLanguage', () => {
  it('should return the code if a valid code is provided', () => {
    expect(normalizeTesseractLanguage('eng')).toBe('eng');
    expect(normalizeTesseractLanguage('fra')).toBe('fra');
    expect(normalizeTesseractLanguage('chi_sim')).toBe('chi_sim');
  });

  it('should return the code if a valid language name is provided', () => {
    expect(normalizeTesseractLanguage('English')).toBe('eng');
    expect(normalizeTesseractLanguage('French')).toBe('fra');
    expect(normalizeTesseractLanguage('Chinese - Simplified')).toBe('chi_sim');
  });

  it('should return the code for case-insensitive matches', () => {
    expect(normalizeTesseractLanguage('ENGLISH')).toBe('eng');
    expect(normalizeTesseractLanguage('french')).toBe('fra');
  });

  it('should handle common aliases', () => {
    expect(normalizeTesseractLanguage('Chinese')).toBe('chi_sim');
    expect(normalizeTesseractLanguage('German')).toBe('deu');
  });

  it('should pass through strings that look like codes', () => {
    expect(normalizeTesseractLanguage('que')).toBe('que'); // Quechua (not in our map but is a code)
    expect(normalizeTesseractLanguage('chr_inv')).toBe('chr_inv');
  });

  it('should default to eng for unknown languages', () => {
    expect(normalizeTesseractLanguage('unknown-language')).toBe('eng');
    expect(normalizeTesseractLanguage('')).toBe('eng');
  });

  it('should handle whitespace', () => {
    expect(normalizeTesseractLanguage('  English  ')).toBe('eng');
  });
});

describe('TESSERACT_LANGUAGES', () => {
  it('should contain more than 100 languages', () => {
    const count = Object.keys(TESSERACT_LANGUAGES).length;
    expect(count).toBeGreaterThan(100);
  });
});
