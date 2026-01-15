import type { IOCREngine } from '@/types/ocr-engine';
import { EngineFactory } from '@/engines/engine-factory';

export class OCRManager {
  private readonly factory: EngineFactory;
  private activeEngine: IOCREngine | null = null;

  constructor(factory: EngineFactory) {
    this.factory = factory;
  }

  async setEngine(id: string): Promise<void> {
    if (this.activeEngine) {
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }

    const engine = this.factory.create(id);
    this.activeEngine = engine;
    await engine.load();
  }

  async run(image: ImageData): Promise<string> {
    if (!this.activeEngine) {
      throw new Error('Engine not initialized.');
    }

    return await this.activeEngine.process(image);
  }

  getLoadingState(): boolean {
    return this.activeEngine?.isLoading ?? false;
  }
}
