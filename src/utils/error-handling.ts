import { OCRError, OCRErrorCode, type ErrorMessage } from '@/types/ocr-errors';

export const ERROR_MESSAGES: Record<OCRErrorCode, ErrorMessage> = {
  [OCRErrorCode.UNSUPPORTED_BROWSER]: {
    code: OCRErrorCode.UNSUPPORTED_BROWSER,
    message: 'Browser not supported for OCR.',
    recoverySuggestion: 'Use Chrome 90+, Firefox 88+, or Safari 15+.',
  },
  [OCRErrorCode.ENGINE_LOAD_FAILED]: {
    code: OCRErrorCode.ENGINE_LOAD_FAILED,
    message: 'Failed to load OCR engine.',
    recoverySuggestion: 'Check your network connection and try again.',
  },
  [OCRErrorCode.PROCESSING_FAILED]: {
    code: OCRErrorCode.PROCESSING_FAILED,
    message: 'Failed to process the image.',
    recoverySuggestion: 'Try a clearer image or retry the OCR request.',
  },
  [OCRErrorCode.MEMORY_EXHAUSTED]: {
    code: OCRErrorCode.MEMORY_EXHAUSTED,
    message: 'OCR ran out of memory.',
    recoverySuggestion: 'Resize the image or try a smaller file.',
  },
  [OCRErrorCode.INVALID_IMAGE]: {
    code: OCRErrorCode.INVALID_IMAGE,
    message: 'Invalid or unsupported image file.',
    recoverySuggestion: 'Use a JPEG, PNG, WebP, or BMP image.',
  },
  [OCRErrorCode.NETWORK_ERROR]: {
    code: OCRErrorCode.NETWORK_ERROR,
    message: 'Network error while loading OCR assets.',
    recoverySuggestion: 'Check your connection and retry the download.',
  },
};

export function formatErrorMessage(error: unknown): ErrorMessage {
  if (error instanceof OCRError) {
    const fallback = ERROR_MESSAGES[error.code];
    return {
      code: error.code,
      message: error.message || fallback.message,
      recoverySuggestion: fallback.recoverySuggestion,
    };
  }

  if (error instanceof Error) {
    return {
      code: OCRErrorCode.PROCESSING_FAILED,
      message: error.message || ERROR_MESSAGES[OCRErrorCode.PROCESSING_FAILED].message,
      recoverySuggestion: ERROR_MESSAGES[OCRErrorCode.PROCESSING_FAILED].recoverySuggestion,
    };
  }

  return {
    code: OCRErrorCode.PROCESSING_FAILED,
    message: ERROR_MESSAGES[OCRErrorCode.PROCESSING_FAILED].message,
    recoverySuggestion: ERROR_MESSAGES[OCRErrorCode.PROCESSING_FAILED].recoverySuggestion,
  };
}

export function logError(error: unknown): void {
  console.error('[OCR]', error);
}

export function createUnsupportedBrowserError(missing: string[]): OCRError {
  const message = `Browser not supported. Missing: ${missing.join(', ')}.`;
  return new OCRError(message, OCRErrorCode.UNSUPPORTED_BROWSER, false);
}

export function createMemoryExhaustedError(): OCRError {
  return new OCRError(
    ERROR_MESSAGES[OCRErrorCode.MEMORY_EXHAUSTED].message,
    OCRErrorCode.MEMORY_EXHAUSTED,
    true
  );
}

export function createProcessingFailedError(message?: string, recoverable: boolean = true): OCRError {
  return new OCRError(
    message ?? ERROR_MESSAGES[OCRErrorCode.PROCESSING_FAILED].message,
    OCRErrorCode.PROCESSING_FAILED,
    recoverable
  );
}

export function createInvalidImageError(message?: string): OCRError {
  return new OCRError(
    message ?? ERROR_MESSAGES[OCRErrorCode.INVALID_IMAGE].message,
    OCRErrorCode.INVALID_IMAGE,
    false
  );
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    delaysMs?: number[];
    onRetry?: (error: unknown, attempt: number) => void;
  } = {}
): Promise<T> {
  const delays = options.delaysMs ?? [1000, 2000, 4000, 8000, 16000];

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= delays.length) {
        throw error;
      }

      options.onRetry?.(error, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw new Error('Retry attempts exhausted.');
}
