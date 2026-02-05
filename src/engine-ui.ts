import { ENGINE_CONFIGS } from '@/types/ocr-models';
import {
  SUPPORTED_LANGUAGES,
  TESSERACT_LANGUAGES,
  EASYOCR_LANGUAGES,
} from '@/utils/language-config';

export interface EngineUiElements {
  engineSelect: HTMLSelectElement;
  engineDetails: HTMLDivElement;
  languageSelect: HTMLSelectElement;
  languageSelectContainer: HTMLDivElement;
  languageHint: HTMLDivElement;
}

export interface EngineUiController {
  populateEngines: (getPreferred: () => string | null) => void;
  updateEngineDetails: (engineId: string) => void;
  updateLanguageSelection: (engineId: string) => void;
  updateLanguageHint: (engineId: string) => void;
  supportsLanguageSelection: (engineId: string) => boolean;
  getSelectedLanguage: (engineId: string) => string;
  getLanguageLabel: (engineId: string, language: string) => string;
  getLanguageOptions: (engineId: string) => Record<string, string> | null;
}

export const createEngineUiController = (
  elements: EngineUiElements,
  options: {
    webgpuAvailable: boolean;
    selectedLanguages: Record<string, string>;
    availableEngines: () => string[];
  }
): EngineUiController => {
  const { engineSelect, engineDetails, languageSelect, languageSelectContainer, languageHint } =
    elements;
  const { webgpuAvailable, selectedLanguages, availableEngines } = options;

  const languageOptionsByEngine: Record<string, Record<string, string>> = {
    tesseract: TESSERACT_LANGUAGES,
    esearch: SUPPORTED_LANGUAGES,
    easyocr: EASYOCR_LANGUAGES,
  };
  const webgpuEngines = new Set(['transformers', 'esearch', 'easyocr']);

  const supportsLanguageSelection = (engineId: string): boolean =>
    Boolean(languageOptionsByEngine[engineId]);

  const getLanguageOptions = (engineId: string): Record<string, string> | null =>
    languageOptionsByEngine[engineId] ?? null;

  const ESEARCH_LANGUAGE_HINTS: Record<string, string> = {
    english: 'English-only model. Use this if the document is primarily English.',
    latin:
      'Latin script group (English, French, German, Spanish, Italian, Portuguese, and many more).',
    chinese: 'Chinese + Japanese model. Works for Japanese too.',
    eslav: 'Cyrillic group: Russian, Ukrainian, Bulgarian, Belarusian.',
    hindi: 'Devanagari group: Hindi, Marathi, Nepali, Sanskrit.',
    arabic: 'Arabic script group: Arabic, Urdu, Persian/Farsi.',
  };

  const updateLanguageHint = (engineId: string): void => {
    if (!supportsLanguageSelection(engineId)) {
      languageHint.textContent = '';
      languageHint.classList.add('hidden');
      return;
    }

    const selected = getSelectedLanguage(engineId);
    const message = engineId === 'esearch' ? (ESEARCH_LANGUAGE_HINTS[selected] ?? '') : '';

    languageHint.textContent = message;
    languageHint.classList.toggle('hidden', message.trim().length === 0);
  };

  const getSelectedLanguage = (engineId: string): string => {
    const options = getLanguageOptions(engineId);
    const keys = options ? Object.keys(options) : [];
    const firstOption = keys.length > 0 ? (keys[0] as string) : 'eng';
    const fallback: string = selectedLanguages[engineId] ?? firstOption;
    const selected: string = selectedLanguages[engineId] ?? fallback;

    if (options && !(selected in options)) {
      selectedLanguages[engineId] = fallback;
      return fallback;
    }

    return selected;
  };

  const getLanguageLabel = (engineId: string, language: string): string => {
    const options = getLanguageOptions(engineId);
    return options?.[language] ?? language;
  };

  const formatSupportedLanguages = (engineId: string): string => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      return '';
    }

    if (engineId === 'tesseract') {
      return '100+ languages';
    }

    const options = getLanguageOptions(engineId);
    if (!options) {
      return config.supportedLanguages.join(', ');
    }

    return config.supportedLanguages.map((language) => options[language] ?? language).join(', ');
  };

  const updateEngineDetails = (engineId: string): void => {
    const config = ENGINE_CONFIGS[engineId];
    if (!config) {
      engineDetails.textContent = 'Unknown engine configuration.';
      return;
    }

    const gpuNote = webgpuEngines.has(engineId)
      ? webgpuAvailable
        ? 'WebGPU enabled'
        : 'CPU mode (WebGPU unavailable)'
      : '';
    const languages = formatSupportedLanguages(engineId);
    engineDetails.textContent = `${config.description} • ${languages}${gpuNote ? ` • ${gpuNote}` : ''}`;
  };

  const updateLanguageSelection = (engineId: string): void => {
    const options = getLanguageOptions(engineId);
    const shouldShow = Boolean(options);
    languageSelectContainer.classList.toggle('hidden', !shouldShow);

    if (!options) {
      languageSelect.innerHTML = '';
      updateLanguageHint(engineId);
      return;
    }

    languageSelect.innerHTML = '';
    const sortedOptions = Object.entries(options).sort((a, b) => a[1].localeCompare(b[1]));
    for (const [key, name] of sortedOptions) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      languageSelect.append(option);
    }

    const selected = getSelectedLanguage(engineId);
    selectedLanguages[engineId] = selected;
    languageSelect.value = selected;
    updateLanguageHint(engineId);
  };

  const populateEngines = (getPreferred: () => string | null): void => {
    const engines = availableEngines();
    engineSelect.innerHTML = '';
    for (const engineId of engines) {
      const option = document.createElement('option');
      option.value = engineId;
      option.textContent = ENGINE_CONFIGS[engineId]?.name ?? engineId;
      engineSelect.append(option);
    }

    const preferred = getPreferred();
    const selectedEngineId = engines.includes(preferred ?? '') ? preferred : (engines[0] ?? null);
    if (selectedEngineId) {
      engineSelect.value = selectedEngineId;
      updateEngineDetails(selectedEngineId);
      updateLanguageSelection(selectedEngineId);
    }
  };

  return {
    populateEngines,
    updateEngineDetails,
    updateLanguageSelection,
    updateLanguageHint,
    supportsLanguageSelection,
    getSelectedLanguage,
    getLanguageLabel,
    getLanguageOptions,
  };
};
