export enum OCRErrorCode {
  UNSUPPORTED_BROWSER = 'UNSUPPORTED_BROWSER',
  ENGINE_LOAD_FAILED = 'ENGINE_LOAD_FAILED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  MEMORY_EXHAUSTED = 'MEMORY_EXHAUSTED',
  INVALID_IMAGE = 'INVALID_IMAGE',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export interface ErrorMessage {
  code: OCRErrorCode;
  message: string;
  recoverySuggestion?: string;
}

export class OCRError extends Error {
  public readonly code: OCRErrorCode;
  public readonly recoverable: boolean;

  constructor(message: string, code: OCRErrorCode, recoverable: boolean = true) {
    super(message);
    this.name = 'OCRError';
    this.code = code;
    this.recoverable = recoverable;
  }
}
