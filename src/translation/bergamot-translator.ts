import { LatencyOptimisedTranslator } from '@browsermt/bergamot-translator/translator.js';
import type { ITextTranslator, TranslationRequest, TranslationResponse } from '@/types/translation';

const createWorkerUrl = (): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const baseUrl = new URL(base, window.location.origin);
  return new URL('bergamot/worker/translator-worker.js', baseUrl).toString();
};

export class BergamotTextTranslator implements ITextTranslator {
  private instance: LatencyOptimisedTranslator | null = null;
  private initializing: Promise<LatencyOptimisedTranslator> | null = null;

  private async getTranslator(): Promise<LatencyOptimisedTranslator> {
    if (this.instance) {
      return this.instance;
    }

    if (!this.initializing) {
      const translator = new LatencyOptimisedTranslator({
        workerUrl: createWorkerUrl(),
        downloadTimeout: 60000,
      } as any);
      // Wait for the worker to be initialized
      this.initializing = (translator as any).worker.then(() => translator);
    }

    this.instance = await this.initializing;
    if (!this.instance) {
      throw new Error('Translator initialization failed');
    }
    return this.instance;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const translator = await this.getTranslator();
    const response = await translator.translate({
      from: request.from,
      to: request.to,
      text: request.text,
      html: request.html ?? false,
    });
    return { text: response.target.text };
  }

  destroy(): void {
    if (this.instance) {
      this.instance.delete();
      this.instance = null;
    }
    this.initializing = null;
  }
}
