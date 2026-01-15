import type { IOCREngine } from '@/types/ocr-engine';

export type EngineFactoryCreator = () => IOCREngine;

export class EngineFactory {
  private readonly registry = new Map<string, EngineFactoryCreator>();

  register(id: string, creator: EngineFactoryCreator): void {
    if (this.registry.has(id)) {
      throw new Error(`Engine already registered: ${id}`);
    }

    this.registry.set(id, creator);
  }

  create(id: string): IOCREngine {
    const creator = this.registry.get(id);
    if (!creator) {
      throw new Error(`Engine not registered: ${id}`);
    }

    const engine = creator();
    if (engine.id !== id) {
      throw new Error(`Engine id mismatch for ${id}`);
    }

    return engine;
  }

  getAvailableEngines(): string[] {
    return Array.from(this.registry.keys());
  }
}
