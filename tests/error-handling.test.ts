import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  ERROR_MESSAGES,
  createMemoryExhaustedError,
  createProcessingFailedError,
  createInvalidImageError,
  createUnsupportedBrowserError,
  formatErrorMessage,
  logError,
  retryWithBackoff,
} from '../src/utils/error-handling';
import { OCRError, OCRErrorCode } from '../src/types/ocr-errors';

describe('Error handling property tests', () => {
  it('formats errors into user-facing messages', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          OCRErrorCode.UNSUPPORTED_BROWSER,
          OCRErrorCode.ENGINE_LOAD_FAILED,
          OCRErrorCode.PROCESSING_FAILED,
          OCRErrorCode.MEMORY_EXHAUSTED,
          OCRErrorCode.INVALID_IMAGE,
          OCRErrorCode.NETWORK_ERROR
        ),
        (code) => {
          const error = new OCRError(ERROR_MESSAGES[code].message, code);
          const formatted = formatErrorMessage(error);

          expect(formatted.code).toBe(code);
          expect(formatted.message.length).toBeGreaterThan(0);
          expect(formatted.recoverySuggestion?.length ?? 0).toBeGreaterThan(0);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('reports missing browser features', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }), (missing) => {
        const error = createUnsupportedBrowserError(missing);
        for (const feature of missing) {
          expect(error.message).toContain(feature);
        }
      }),
      { numRuns: 25 }
    );
  });

  it('retries downloads with exponential backoff', async () => {
    const delays = [1, 2, 4, 8, 16];
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: delays.length }), async (failCount) => {
        vi.useFakeTimers();
        try {
          const operation = vi.fn((): Promise<string> => {
            if (operation.mock.calls.length <= failCount) {
              return Promise.reject(new Error('fail'));
            }
            return Promise.resolve('ok');
          });

          const promise = retryWithBackoff(operation, { delaysMs: delays });

          for (let i = 0; i < failCount; i += 1) {
            await vi.advanceTimersByTimeAsync(delays[i]);
          }

          const result = await promise;
          expect(result).toBe('ok');
        } finally {
          vi.useRealTimers();
        }
      }),
      { numRuns: 10 }
    );
  });

  it('logs errors to the console', () => {
    fc.assert(
      fc.property(fc.string(), (message) => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logError(new Error(message));
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
      }),
      { numRuns: 10 }
    );
  });
});

describe('Error handling unit tests', () => {
  it('formats generic errors with processing failure code', () => {
    const formatted = formatErrorMessage(new Error('oops'));
    expect(formatted.code).toBe(OCRErrorCode.PROCESSING_FAILED);
  });

  it('creates memory exhaustion errors with recovery suggestions', () => {
    const error = createMemoryExhaustedError();
    expect(error.code).toBe(OCRErrorCode.MEMORY_EXHAUSTED);
    const formatted = formatErrorMessage(error);
    expect(formatted.recoverySuggestion).toBeDefined();
  });

  it('creates processing errors with recovery flags', () => {
    const error = createProcessingFailedError('bad image', false);
    expect(error.code).toBe(OCRErrorCode.PROCESSING_FAILED);
    expect(error.recoverable).toBe(false);
  });

  it('creates invalid image errors as non-recoverable', () => {
    const error = createInvalidImageError('bad file');
    expect(error.code).toBe(OCRErrorCode.INVALID_IMAGE);
    expect(error.recoverable).toBe(false);
  });

  it('fails after exhausting retry attempts', async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn((): Promise<void> => Promise.reject(new Error('fail')));

      const promise = retryWithBackoff(operation, { delaysMs: [1, 2] });
      const expectation = expect(promise).rejects.toThrow('fail');

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(2);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
