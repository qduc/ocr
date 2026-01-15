export interface IOCREngine {
  id: string;
  isLoading: boolean;
  load(): Promise<void>;
  process(data: ImageData): Promise<string>;
  destroy(): Promise<void>;
}
