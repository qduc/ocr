import { BERGAMOT_LANGUAGES } from '@/utils/translation-languages';

const tesseractMap: Record<string, string> = {
  afr: 'af',
  amh: 'am',
  ara: 'ar',
  aze: 'az',
  bel: 'be',
  ben: 'bn',
  bos: 'bs',
  bul: 'bg',
  cat: 'ca',
  ces: 'cs',
  chi_sim: 'zh',
  chi_tra: 'zh',
  cym: 'cy',
  dan: 'da',
  deu: 'de',
  ell: 'el',
  eng: 'en',
  epo: 'eo',
  est: 'et',
  fas: 'fa',
  fin: 'fi',
  fra: 'fr',
  gle: 'ga',
  glg: 'gl',
  guj: 'gu',
  heb: 'he',
  hin: 'hi',
  hrv: 'hr',
  hun: 'hu',
  ind: 'id',
  isl: 'is',
  ita: 'it',
  jpn: 'ja',
  kat: 'ka',
  kor: 'ko',
  lav: 'lv',
  lit: 'lt',
  mal: 'ml',
  mar: 'mr',
  mkd: 'mk',
  mlt: 'mt',
  msa: 'ms',
  nld: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rus: 'ru',
  slk: 'sk',
  slv: 'sl',
  spa: 'es',
  sqi: 'sq',
  srp: 'sr',
  swe: 'sv',
  tam: 'ta',
  tel: 'te',
  tha: 'th',
  tgl: 'tl',
  tur: 'tr',
  ukr: 'uk',
  urd: 'ur',
  vie: 'vi',
};

const easyOcrMap: Record<string, string> = {
  ch_sim: 'zh',
  ja: 'ja',
  ko: 'ko',
  rs_latin: 'sr',
  rs_cyrillic: 'sr',
  te: 'te',
  kn: 'kn',
  la: 'la',
  en: 'en',
};

const esearchMap: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  arabic: 'ar',
  korean: 'ko',
  latin: 'la',
  tamil: 'ta',
  telugu: 'te',
  thai: 'th',
  greek: 'el',
  hindi: 'hi',
};

const normalize = (value: string): string => value.toLowerCase().trim();

const ensureSupported = (value: string | null): string | null => {
  if (!value) return null;
  return BERGAMOT_LANGUAGES[value] ? value : null;
};

export function mapOcrLanguageToBergamot(engineId: string, ocrLanguage: string): string | null {
  const normalized = normalize(ocrLanguage);

  if (engineId === 'tesseract') {
    return ensureSupported(tesseractMap[normalized] ?? null);
  }

  if (engineId === 'easyocr') {
    const mapped = easyOcrMap[normalized] ?? normalized;
    return ensureSupported(mapped);
  }

  if (engineId === 'esearch') {
    return ensureSupported(esearchMap[normalized] ?? null);
  }

  return ensureSupported(normalized);
}

export function mapBergamotToOcrLanguage(bergamotLanguage: string, engineId: string): string | null {
  if (engineId === 'tesseract') {
    // Find the first Tesseract key that maps to this Bergamot code
    const entry = Object.entries(tesseractMap).find(([, target]) => target === bergamotLanguage);
    if (entry) return entry[0];

    // Fallback: If no direct map, Tesseract uses 3-letter codes.
    // This is a rough heuristic.
    return null;
  }

  if (engineId === 'easyocr') {
    const entry = Object.entries(easyOcrMap).find(([, target]) => target === bergamotLanguage);
    if (entry) return entry[0];
    return bergamotLanguage; // EasyOCR often uses 2-letter codes anyway
  }

  if (engineId === 'esearch') {
    const entry = Object.entries(esearchMap).find(([, target]) => target === bergamotLanguage);
    return entry ? entry[0] : null;
  }

  return bergamotLanguage;
}

