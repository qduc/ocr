# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript app, OCR logic, and translation system.
  - `src/main.ts`: Entry point that initializes the application.
  - `src/app.ts`: Core orchestrator that wires together UI controllers and services.
  - `src/ocr-manager.ts`: Manages OCR engine orchestration and lifecycle.
  - `src/translation-controller.ts`: Handles translation UI logic and Bergamot integration.
  - `src/engine-ui.ts`, `src/image-sources.ts`, `src/app-elements.ts`, `src/app-template.ts`: UI components and templates.
  - `src/engines/`: Implementation of OCR strategies.
    - `tesseract-engine.ts`: Tesseract.js (WASM).
    - `transformers-engine.ts`: Transformers.js (WebGPU/ONNX).
    - `esearch-engine.ts`: eSearch-OCR (PaddleOCR models).
    - `easyocr-engine.ts`: EasyOCR models via ONNX Runtime.
  - `src/translation/`: Bergamot-based local translation engine.
  - `src/utils/`: Shared utilities including `image-processor.ts` (preprocessing), `paragraph-grouping.ts` (layout analysis), and `model-cache.ts` (IndexedDB).
  - `src/style.css`: Modern, glassmorphism-inspired UI and overlay styles.
- `public/`: Static assets, including `coi-serviceworker.js` (required for `SharedArrayBuffer` support).
- `tests/`: Vitest suites named `*.test.ts`, covering engines, UI, and translation logic.
- `dist/`: Vite build output (generated).
- Reference docs: `README.md`, `docs/SPECIFICATION.md`, and `docs/DECISION_LOG.md`.

## Build, Test, and Development Commands
- `npm run dev`: Starts the Vite dev server for local development.
- `npm run build`: Runs `tsc` then bundles with Vite into `dist/`.
- `npm run preview`: Serves the production build locally.
- `npm test`: Runs the test suite once with Vitest.
- `npm run test:watch`: Runs Vitest in watch mode.
- `npm run typecheck`: Runs `tsc --noEmit` for type checking.
- `npm run lint`: Checks TypeScript/ESLint rules.
- `npm run format`: Applies Prettier to `src/**/*.{ts,js,json,css,md}`.

## Coding Style & Naming Conventions
- TypeScript (ES modules) with strict typing via `tsconfig.json`.
- Indentation: 2 spaces; single quotes; semicolons; 100-char line width (per `.prettierrc.json`).
- Prefer explicit types for public APIs; avoid `any`.
- File naming: kebab-case (e.g., `ocr-manager.ts`).

## Testing Guidelines
- Frameworks: Vitest + JSDOM; property tests use `fast-check`.
- Keep tests focused on engine selection, OCR accuracy, UI behavior, and translation writeback.
- Always run `test`, `typecheck`, and `lint` before finalizing a task.

## Translation System
- Local translation is powered by **Bergamot** (WASM).
- Requires `crossOriginIsolated` state via `coi-serviceworker.js` to enable `SharedArrayBuffer`.
- Model registry is managed via `scripts/generate-bergamot-registry.mjs`.

## Decision Log & Specs
- Track rationale in `docs/DECISION_LOG.md`.
- Implementation details and milestones are in `docs/SPECIFICATION.md`.
