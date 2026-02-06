export interface TranslationRequest {
  from: string;
  to: string;
  text: string;
  html?: boolean;
}

export interface TranslationResponse {
  text: string;
}

export interface ITextTranslator {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  destroy(): void;
}
