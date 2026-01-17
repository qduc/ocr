# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript app and OCR logic.
  - `src/engines/` implements OCR engines (Tesseract.js, Transformers.js, eSearch OCR).
  - `src/utils/` and `src/types/` hold shared utilities and type definitions.
  - `src/main.ts` is the app entry point; `src/app.ts` wires UI/logic and handles the OCR overlay.
  - `src/ocr-manager.ts` manages engine orchestration and lifecycle.
  - `src/style.css` defines the modern, glassmorphism-inspired UI and overlay styles.
- `tests/` holds Vitest suites named `*.test.ts`.
- `dist/` is the Vite build output (generated).
- Reference docs live in `README.md`, `docs/SPECIFICATION.md`, and `docs/DECISION_LOG.md`.

## Build, Test, and Development Commands
- `npm run dev` starts the Vite dev server for local development.
- `npm run build` runs `tsc` then bundles with Vite into `dist/`.
- `npm run preview` serves the production build locally.
- `npm test` runs the test suite once with Vitest.
- `npm run lint` checks TypeScript/ESLint rules.
- `npm run format` applies Prettier to `src/**/*.{ts,tsx}`.

## Coding Style & Naming Conventions
- TypeScript (ES modules) with strict typing via `tsconfig.json`.
- Indentation: 2 spaces; single quotes; semicolons; 100-char line width.
- Prefer explicit types for public APIs; avoid `any` (linted as error).
- File naming follows kebab-case or existing module conventions (e.g., `ocr-manager.ts`).

## Testing Guidelines
- Frameworks: Vitest + JSDOM; property tests use `fast-check`.
- Test files follow `*.test.ts` under `tests/`.
- Keep tests focused on engine selection, OCR result accuracy (including bounding boxes), and UI behavior.
- Run locally with `npm test` or watch mode via `npm run test:watch`.
- IMPORTANT: Always run test and lint after finishing a task.

## Decision Log & Specs
- Track rationale in `docs/DECISION_LOG.md`.
- Implementation details and milestones are in `docs/SPECIFICATION.md`.
