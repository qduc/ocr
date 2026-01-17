import type { IOCREngine, OCRResult } from '@/types/ocr-engine';
import { EngineFactory } from '@/engines/engine-factory';

export class OCRManager {
  private readonly factory: EngineFactory;
  private activeEngine: IOCREngine | null = null;

  constructor(factory: EngineFactory) {
    this.factory = factory;
  }

  async setEngine(id: string, options?: { language?: string }): Promise<void> {
    if (this.activeEngine) {
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }

    const engine = await this.factory.create(id, options);
    this.activeEngine = engine;
    await engine.load();
  }

  async run(image: ImageData): Promise<OCRResult> {
    if (!this.activeEngine) {
      throw new Error('Engine not initialized.');
    }

    return await this.activeEngine.process(image);
  }

  getLoadingState(): boolean {
    return this.activeEngine?.isLoading ?? false;
  }
}
