import { getSupportedLanguages } from '@qduc/easyocr-core';

/**
 * Languages supported by the monkt/paddleocr-onnx model repository.
 * Each entry maps a display name to the subfolder name in HF.
 */
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  english: 'English (English-only)',
  latin: 'Latin script (many languages)',
  chinese: 'Chinese/Japanese (CJK)',
  eslav: 'Cyrillic (ru/uk/bg/be)',
  korean: 'Korean',
  greek: 'Greek',
  thai: 'Thai',
  hindi: 'Devanagari (hi/mr/ne/sa)',
  arabic: 'Arabic script (ar/ur/fa)',
  tamil: 'Tamil',
  telugu: 'Telugu',
};

/**
 * Common Tesseract language packs to expose in the UI.
 * Keys align to Tesseract traineddata identifiers (ISO 639-2/T codes).
 */
export const TESSERACT_LANGUAGES: Record<string, string> = {
  afr: 'Afrikaans',
  amh: 'Amharic',
  ara: 'Arabic',
  asm: 'Assamese',
  aze: 'Azerbaijani',
  aze_cyrl: 'Azerbaijani - Cyrillic',
  bel: 'Belarusian',
  ben: 'Bengali',
  bod: 'Tibetan',
  bos: 'Bosnian',
  bul: 'Bulgarian',
  cat: 'Catalan; Valencian',
  ceb: 'Cebuano',
  ces: 'Czech',
  chi_sim: 'Chinese - Simplified',
  chi_tra: 'Chinese - Traditional',
  chr: 'Cherokee',
  cym: 'Welsh',
  dan: 'Danish',
  deu: 'German',
  dzo: 'Dzongkha',
  ell: 'Greek',
  eng: 'English',
  enm: 'English, Middle (1100-1500)',
  epo: 'Esperanto',
  est: 'Estonian',
  eus: 'Basque',
  fas: 'Persian',
  fin: 'Finnish',
  fra: 'French',
  frk: 'Frankish',
  frm: 'French, Middle (ca. 1400-1600)',
  gle: 'Irish',
  glg: 'Galician',
  grc: 'Greek, Ancient (to 1453)',
  guj: 'Gujarati',
  hat: 'Haitian; Haitian Creole',
  heb: 'Hebrew',
  hin: 'Hindi',
  hrv: 'Croatian',
  hun: 'Hungarian',
  iku: 'Inuktitut',
  ind: 'Indonesian',
  isl: 'Icelandic',
  ita: 'Italian',
  ita_old: 'Italian - Old',
  jav: 'Javanese',
  jpn: 'Japanese',
  kan: 'Kannada',
  kat: 'Georgian',
  kat_old: 'Georgian - Old',
  kaz: 'Kazakh',
  khm: 'Central Khmer',
  kir: 'Kirghiz; Kyrgyz',
  kor: 'Korean',
  kur: 'Kurdish',
  lao: 'Lao',
  lat: 'Latin',
  lav: 'Latvian',
  lit: 'Lithuanian',
  mal: 'Malayalam',
  mar: 'Marathi',
  mkd: 'Macedonian',
  mlt: 'Maltese',
  msa: 'Malay',
  mya: 'Burmese',
  nep: 'Nepali',
  nld: 'Dutch; Flemish',
  nor: 'Norwegian',
  ori: 'Oriya',
  pan: 'Panjabi; Punjabi',
  pol: 'Polish',
  por: 'Portuguese',
  pus: 'Pushto; Pashto',
  ron: 'Romanian; Moldavian; Moldovan',
  rus: 'Russian',
  san: 'Sanskrit',
  sin: 'Sinhala; Sinhalese',
  slk: 'Slovak',
  slv: 'Slovenian',
  spa: 'Spanish',
  spa_old: 'Spanish - Old',
  sqi: 'Albanian',
  srp: 'Serbian',
  srp_latn: 'Serbian - Latin',
  swa: 'Swahili',
  swe: 'Swedish',
  syr: 'Syriac',
  tam: 'Tamil',
  tel: 'Telugu',
  tgk: 'Tajik',
  tgl: 'Tagalog',
  tha: 'Thai',
  tir: 'Tigrinya',
  tur: 'Turkish',
  uig: 'Uighur; Uyghur',
  ukr: 'Ukrainian',
  urd: 'Urdu',
  uzb: 'Uzbek',
  uzb_cyrl: 'Uzbek - Cyrillic',
  vie: 'Vietnamese',
  yid: 'Yiddish',
};

/**
 * Normalizes a language name or code to a valid Tesseract ISO code.
 * @param input The language name (e.g., 'English') or code (e.g., 'eng')
 * @returns The normalized Tesseract code (e.g., 'eng')
 */
export function normalizeTesseractLanguage(input: string): string {
  const normalized = input.toLowerCase().trim();

  // If it's already a valid key in our map, return it
  if (TESSERACT_LANGUAGES[normalized]) {
    return normalized;
  }

  // Try to find by display name
  for (const [code, name] of Object.entries(TESSERACT_LANGUAGES)) {
    if (name.toLowerCase() === normalized) {
      return code;
    }
  }

  // Handle some common aliases/variants
  const aliases: Record<string, string> = {
    chinese: 'chi_sim',
    'chinese-simplified': 'chi_sim',
    'chinese-traditional': 'chi_tra',
    'simplified-chinese': 'chi_sim',
    'traditional-chinese': 'chi_tra',
    german: 'deu',
    french: 'fra',
    spanish: 'spa',
    japanese: 'jpn',
    korean: 'kor',
    russian: 'rus',
    vietnamese: 'vie',
    dutch: 'nld',
    greek: 'ell',
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  // If it looks like a Tesseract code (3 letters, or 3 letters + suffix), return as-is
  if (/^[a-z]{3}(_[a-z]+)*$/.test(normalized)) {
    return normalized;
  }

  // Default to English if no match found
  return 'eng';
}

/**
 * Languages supported by EasyOCR.js.
 */
const EASYOCR_LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  la: 'Latin',
  ch_sim: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  te: 'Telugu',
  kn: 'Kannada',
  rs_latin: 'Serbian (Latin)',
  rs_cyrillic: 'Serbian (Cyrillic)',
};

const easyOcrDisplayNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

const formatEasyOcrLabel = (code: string): string => {
  if (EASYOCR_LANGUAGE_LABELS[code]) {
    return EASYOCR_LANGUAGE_LABELS[code];
  }
  const normalized = code.replace('_', '-');
  let name: string | undefined;
  try {
    name = easyOcrDisplayNames?.of(normalized);
  } catch {
    name = undefined;
  }
  return name ?? code;
};

export const EASYOCR_LANGUAGES: Record<string, string> = Object.fromEntries(
  getSupportedLanguages().map(({ code, label }) => [code, label ?? formatEasyOcrLabel(code)])
);

const HF_BASE_URL = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main';

export interface ModelUrls {
  det: string;
  rec: string;
  dict: string;
}

/**
 * Generates Hugging Face URLs for the given language.
 * Uses v3 detection model for better performance/size.
 * @param language The language key from SUPPORTED_LANGUAGES (e.g., 'english')
 */
export function getHuggingFaceModelUrls(language: string = 'english'): ModelUrls {
  const langKey = language.toLowerCase();

  // Detection model is used for all languages as it's the general text detector.
  const detUrl = `${HF_BASE_URL}/detection/v5/det.onnx`;

  // Recognition model and dictionary are language-specific.
  const recUrl = `${HF_BASE_URL}/languages/${langKey}/rec.onnx`;
  const dictUrl = `${HF_BASE_URL}/languages/${langKey}/dict.txt`;

  return {
    det: detUrl,
    rec: recUrl,
    dict: dictUrl,
  };
}
