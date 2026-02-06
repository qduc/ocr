declare module '@browsermt/bergamot-translator/translator.js' {
  export interface TranslatorInitOptions {
    workerUrl?: string;
    registryUrl?: string;
    downloadTimeout?: number;
    pivotLanguage?: string;
  }

  export interface TranslateRequest {
    from: string;
    to: string;
    text: string;
    html?: boolean;
  }

  export interface TranslateResponse {
    target: {
      text: string;
    };
  }

  export class TranslatorBacking {
    constructor(options?: TranslatorInitOptions);
  }

  export class LatencyOptimisedTranslator {
    constructor(options?: TranslatorInitOptions, backing?: TranslatorBacking);
    init(): Promise<LatencyOptimisedTranslator>;
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    delete(): void;
  }
}
