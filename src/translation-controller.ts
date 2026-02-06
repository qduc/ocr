import type { OCRResult } from '@/types/ocr-engine';
import type { ITextTranslator } from '@/types/translation';
import type { ImageProcessor } from '@/utils/image-processor';
import { logError } from '@/utils/error-handling';
import {
  groupOcrItemsIntoWriteBackParagraphs,
  type OCRWriteBackLineRegion,
} from '@/utils/paragraph-grouping';
import { renderTranslationToImage, type WriteBackOptions } from '@/utils/image-writeback';
import { BERGAMOT_LANGUAGES, DEFAULT_TRANSLATION_TO } from '@/utils/translation-languages';
import { mapOcrLanguageToBergamot } from '@/utils/ocr-language-to-bergamot';

export interface TranslationElements {
  translateResult: HTMLTextAreaElement;
  translateFrom: HTMLSelectElement;
  translateTo: HTMLSelectElement;
  writebackQuality: HTMLSelectElement;
  translateRunButton: HTMLButtonElement;
  translateWritebackButton: HTMLButtonElement;
  translateCopyButton: HTMLButtonElement;
  translateSwapButton: HTMLButtonElement;
  translateStatus: HTMLDivElement;
  translateError: HTMLDivElement;
  translatedImageContainer: HTMLDivElement;
  translatedImagePreview: HTMLImageElement;
  downloadTranslatedButton: HTMLButtonElement;
}

export interface TranslationContext {
  imageProcessor: ImageProcessor;
  createTranslator?: () => Promise<ITextTranslator>;
  getOcrText: () => string;
  getWritebackContext: () => {
    items: OCRResult['items'] | null;
    selectedSource: Blob | string | null;
    lastProcessedWidth: number;
    lastProcessedHeight: number;
  };
}

export interface TranslationController {
  init: (getDefaultLanguage?: () => { engineId: string | null; ocrLanguage: string | null }) => void;
  updateTranslateFromDefault: (engineId: string | null, ocrLanguage: string | null) => void;
  resetForNewSource: () => void;
  hideTranslatedImage: () => void;
  onOcrUpdated: () => void;
}

type WritebackQualityPreset = 'fast' | 'balanced' | 'high-quality';
const DEFAULT_WRITEBACK_QUALITY: WritebackQualityPreset = 'balanced';

export const createTranslationController = (
  elements: TranslationElements,
  context: TranslationContext
): TranslationController => {
  const {
    translateResult,
    translateFrom,
    translateTo,
    writebackQuality,
    translateRunButton,
    translateWritebackButton,
    translateCopyButton,
    translateSwapButton,
    translateStatus,
    translateError,
    translatedImageContainer,
    translatedImagePreview,
    downloadTranslatedButton,
  } = elements;

  const createTranslator =
    context.createTranslator ??
    (async (): Promise<ITextTranslator> => {
      const { BergamotTextTranslator } = await import('@/translation/bergamot-translator');
      return new BergamotTextTranslator();
    });

  let translatorInstance: ITextTranslator | null = null;
  let translatorLoading: Promise<ITextTranslator> | null = null;
  let translationBusy = false;
  let currentTranslatedPreviewUrl: string | null = null;

  const getTranslator = async (): Promise<ITextTranslator> => {
    if (translatorInstance) return translatorInstance;
    if (!translatorLoading) {
      translatorLoading = createTranslator();
    }
    translatorInstance = await translatorLoading;
    return translatorInstance;
  };

  const setTranslateStatus = (message: string): void => {
    translateStatus.textContent = message;
  };

  const setTranslateError = (message?: string): void => {
    if (message) {
      translateError.textContent = message;
      translateError.classList.remove('hidden');
    } else {
      translateError.textContent = '';
      translateError.classList.add('hidden');
    }
  };

  const setTranslateBusy = (busy: boolean): void => {
    translationBusy = busy;
    translateRunButton.disabled = busy;
    translateWritebackButton.disabled = busy;
    translateCopyButton.disabled = busy;
    translateSwapButton.disabled = busy;
    translateFrom.disabled = busy;
    translateTo.disabled = busy;
  };

  const clearTranslatedPreview = (): void => {
    if (currentTranslatedPreviewUrl) {
      URL.revokeObjectURL(currentTranslatedPreviewUrl);
      currentTranslatedPreviewUrl = null;
    }
  };

  const hideTranslatedImage = (): void => {
    translatedImageContainer.classList.add('hidden');
  };

  const getStoredTranslationLanguage = (key: 'from' | 'to'): string | null => {
    try {
      return localStorage.getItem(`translate.${key}`);
    } catch {
      return null;
    }
  };

  const setStoredTranslationLanguage = (key: 'from' | 'to', value: string): void => {
    try {
      localStorage.setItem(`translate.${key}`, value);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  };

  const getStoredWritebackQuality = (): WritebackQualityPreset => {
    try {
      const stored = localStorage.getItem('translate.writebackQuality');
      if (stored === 'fast' || stored === 'balanced' || stored === 'high-quality') {
        return stored;
      }
    } catch {
      return DEFAULT_WRITEBACK_QUALITY;
    }
    return DEFAULT_WRITEBACK_QUALITY;
  };

  const setStoredWritebackQuality = (value: WritebackQualityPreset): void => {
    try {
      localStorage.setItem('translate.writebackQuality', value);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  };

  const populateTranslateLanguages = (): void => {
    const sorted = Object.entries(BERGAMOT_LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]));
    translateFrom.innerHTML = '';
    translateTo.innerHTML = '';
    for (const [code, label] of sorted) {
      const fromOption = document.createElement('option');
      fromOption.value = code;
      fromOption.textContent = label;
      translateFrom.append(fromOption);

      const toOption = document.createElement('option');
      toOption.value = code;
      toOption.textContent = label;
      translateTo.append(toOption);
    }
  };

  const updateTranslateFromDefault = (engineId: string | null, ocrLanguage: string | null): void => {
    const mapped =
      engineId && ocrLanguage ? mapOcrLanguageToBergamot(engineId, ocrLanguage) : null;
    const next = mapped ?? DEFAULT_TRANSLATION_TO;
    if (translateFrom.value !== next && BERGAMOT_LANGUAGES[next]) {
      translateFrom.value = next;
      setStoredTranslationLanguage('from', translateFrom.value);
    }
  };

  const init = (
    getDefaultLanguage?: () => { engineId: string | null; ocrLanguage: string | null }
  ): void => {
    populateTranslateLanguages();
    const storedFrom = getStoredTranslationLanguage('from');
    if (storedFrom && BERGAMOT_LANGUAGES[storedFrom]) {
      translateFrom.value = storedFrom;
    } else if (getDefaultLanguage) {
      const { engineId, ocrLanguage } = getDefaultLanguage();
      updateTranslateFromDefault(engineId, ocrLanguage);
    } else {
      translateFrom.value = DEFAULT_TRANSLATION_TO;
      setStoredTranslationLanguage('from', translateFrom.value);
    }

    const storedTo = getStoredTranslationLanguage('to');
    if (storedTo && BERGAMOT_LANGUAGES[storedTo]) {
      translateTo.value = storedTo;
    } else {
      translateTo.value = DEFAULT_TRANSLATION_TO;
      setStoredTranslationLanguage('to', translateTo.value);
    }
    writebackQuality.value = getStoredWritebackQuality();

    setTranslateStatus('Ready to translate.');
    setTranslateError();
  };

  const resetForNewSource = (): void => {
    hideTranslatedImage();
    clearTranslatedPreview();
    translateResult.value = '';
    setTranslateError();
    setTranslateStatus('Ready to translate OCR output.');
  };

  const onOcrUpdated = (): void => {
    hideTranslatedImage();
    translateResult.value = '';
    setTranslateError();
    setTranslateStatus('OCR updated. Click Translate to translate it.');
  };

  const runTranslation = async (): Promise<void> => {
    if (translationBusy) return;
    const sourceText = context.getOcrText().trim();
    if (!sourceText) {
      setTranslateStatus('Run OCR to translate.');
      return;
    }

    setTranslateBusy(true);
    setTranslateError();
    try {
      setTranslateStatus('Loading translator...');
      const translator = await getTranslator();
      setTranslateStatus('Translating...');
      const response = await translator.translate({
        from: translateFrom.value,
        to: translateTo.value,
        text: sourceText,
      });
      translateResult.value = response.text;
      setTranslateStatus('Done.');
    } catch (error) {
      logError(error);
      const fallbackMessage = 'Translation failed.';
      let message = fallbackMessage;
      if (error instanceof Error && error.message) {
        if (error.message.includes('No model available to translate')) {
          const fromLabel =
            translateFrom.selectedOptions[0]?.textContent?.trim() ?? translateFrom.value;
          const toLabel = translateTo.selectedOptions[0]?.textContent?.trim() ?? translateTo.value;
          message = `No translation model available for ${fromLabel} → ${toLabel}.`;
        } else {
          message = error.message;
        }
      }
      setTranslateError(message);
      setTranslateStatus('Failed.');
    } finally {
      setTranslateBusy(false);
    }
  };

  const runTranslationWriteback = async (): Promise<void> => {
    if (translationBusy) return;
    const { items, selectedSource, lastProcessedWidth, lastProcessedHeight } =
      context.getWritebackContext();
    if (!items || items.length === 0 || !selectedSource) {
      setTranslateStatus('Run OCR with a compatible engine (Tesseract/EasyOCR/eSearch) first.');
      return;
    }

    setTranslateBusy(true);
    setTranslateError();
    try {
      setTranslateStatus('Preparing regions...');
      const paragraphs = groupOcrItemsIntoWriteBackParagraphs(items);
      const translator = await getTranslator();

      const translatedRegions: Array<OCRWriteBackLineRegion & { translatedText: string }> = [];
      for (let i = 0; i < paragraphs.length; i++) {
        setTranslateStatus(`Translating paragraph ${i + 1}/${paragraphs.length}...`);
        const paragraph = paragraphs[i]!;
        const response = await translator.translate({
          from: translateFrom.value,
          to: translateTo.value,
          text: paragraph.text,
        });

        const lineTexts = distributeParagraphTextToLines(response.text, paragraph.lines);
        for (let lineIndex = 0; lineIndex < paragraph.lines.length; lineIndex++) {
          const line = paragraph.lines[lineIndex]!;
          translatedRegions.push({
            ...line,
            translatedText: lineTexts[lineIndex] ?? '',
          });
        }
      }

      setTranslateStatus('Rendering translated image...');
      const originalImageData = await context.imageProcessor.sourceToImageData(selectedSource);
      const canvas = document.createElement('canvas');
      canvas.width = originalImageData.width;
      canvas.height = originalImageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context failed');
      ctx.putImageData(originalImageData, 0, 0);

      const scaleX = originalImageData.width / lastProcessedWidth;
      const scaleY = originalImageData.height / lastProcessedHeight;

      const preset = (writebackQuality.value as WritebackQualityPreset) || DEFAULT_WRITEBACK_QUALITY;
      const writebackOptions: Record<WritebackQualityPreset, WriteBackOptions> = {
        fast: {
          eraseMode: 'fill',
          textHalo: false,
          maskDilationPx: 0,
        },
        balanced: {
          eraseMode: 'inpaint-auto',
          textHalo: false,
          maskDilationPx: 2,
        },
        'high-quality': {
          eraseMode: 'inpaint-auto',
          textHalo: true,
          maskDilationPx: 3,
        },
      };
      renderTranslationToImage(canvas, translatedRegions, scaleX, scaleY, writebackOptions[preset]);

      setTranslateStatus('Exporting...');
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Export failed')), 'image/png');
      });

      clearTranslatedPreview();
      currentTranslatedPreviewUrl = URL.createObjectURL(blob);
      translatedImagePreview.src = currentTranslatedPreviewUrl;
      translatedImageContainer.classList.remove('hidden');

      setTranslateStatus('Done. Translated image ready.');
    } catch (error) {
      logError(error);
      setTranslateError(error instanceof Error ? error.message : 'Write-back failed.');
      setTranslateStatus('Failed.');
    } finally {
      setTranslateBusy(false);
    }
  };

  translateFrom.addEventListener('change', (): void => {
    setStoredTranslationLanguage('from', translateFrom.value);
  });

  translateTo.addEventListener('change', (): void => {
    setStoredTranslationLanguage('to', translateTo.value);
  });

  writebackQuality.addEventListener('change', (): void => {
    setStoredWritebackQuality(writebackQuality.value as WritebackQualityPreset);
  });

  translateSwapButton.addEventListener('click', (): void => {
    const fromValue = translateFrom.value;
    const toValue = translateTo.value;
    translateFrom.value = toValue;
    translateTo.value = fromValue;
    setStoredTranslationLanguage('from', translateFrom.value);
    setStoredTranslationLanguage('to', translateTo.value);
  });

  translateRunButton.addEventListener('click', (): void => {
    void runTranslation();
  });

  translateWritebackButton.addEventListener('click', (): void => {
    void runTranslationWriteback();
  });

  downloadTranslatedButton.addEventListener('click', (): void => {
    if (!currentTranslatedPreviewUrl) return;
    const a = document.createElement('a');
    a.href = currentTranslatedPreviewUrl;
    a.download = `translated_${Date.now()}.png`;
    a.click();
  });

  translateCopyButton.addEventListener('click', (): void => {
    const text = translateResult.value.trim();
    if (!text) {
      setTranslateStatus('No translation to copy.');
      return;
    }

    void navigator.clipboard.writeText(text).then(() => {
      const originalHtml = translateCopyButton.innerHTML;
      translateCopyButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-strong)"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        translateCopyButton.innerHTML = originalHtml;
      }, 2000);
    });
  });

  return {
    init,
    updateTranslateFromDefault,
    resetForNewSource,
    hideTranslatedImage,
    onOcrUpdated,
  };
};

function distributeParagraphTextToLines(
  text: string,
  lines: OCRWriteBackLineRegion[]
): string[] {
  if (lines.length === 0) {
    return [];
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return lines.map(() => '');
  }

  const hasWhitespace = /\s/.test(trimmed);
  const units = hasWhitespace
    ? trimmed.split(/\s+/).filter((token) => token.length > 0)
    : Array.from(trimmed);

  if (units.length === 0) {
    return lines.map(() => '');
  }

  const totalWidth = lines.reduce((sum, line) => sum + Math.max(1, line.boundingBox.width), 0);
  const targetUnitCounts = lines.map((line, index) => {
    if (index === lines.length - 1) {
      return Number.POSITIVE_INFINITY;
    }
    const proportion = Math.max(1, line.boundingBox.width) / totalWidth;
    return Math.max(1, Math.round(proportion * units.length));
  });

  const result = lines.map(() => '');
  let cursor = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const remainingLines = lines.length - lineIndex;
    const remainingUnits = units.length - cursor;
    if (remainingUnits <= 0) {
      result[lineIndex] = '';
      continue;
    }

    const maxForLine = remainingUnits - (remainingLines - 1);
    const target = targetUnitCounts[lineIndex] ?? maxForLine;
    const take = lineIndex === lines.length - 1
      ? remainingUnits
      : Math.max(1, Math.min(maxForLine, target));

    const segment = units.slice(cursor, cursor + take);
    result[lineIndex] = hasWhitespace ? segment.join(' ') : segment.join('');
    cursor += take;
  }

  return result;
}
