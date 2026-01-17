/**
 * Languages supported by the monkt/paddleocr-onnx model repository.
 * Each entry maps a display name to the subfolder name in HF.
 */
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  'english': 'English',
  'chinese': 'Chinese (Simplified)',
  'arabic': 'Arabic',
  'korean': 'Korean',
  'latin': 'Latin/General',
  'tamil': 'Tamil',
  'telugu': 'Telugu',
  'thai': 'Thai',
  'eslav': 'Eslav',
  'greek': 'Greek',
  'hindi': 'Hindi',
};

/**
 * Common Tesseract language packs to expose in the UI.
 * Keys align to Tesseract traineddata identifiers.
 */
export const TESSERACT_LANGUAGES: Record<string, string> = {
  'eng': 'English',
  'spa': 'Spanish',
  'fra': 'French',
  'deu': 'German',
  'ita': 'Italian',
  'por': 'Portuguese',
  'nld': 'Dutch',
  'pol': 'Polish',
  'rus': 'Russian',
  'jpn': 'Japanese',
  'kor': 'Korean',
  'chi_sim': 'Chinese (Simplified)',
};

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
