# Translated Image Write-Back Improvement Plan

Status legend: `[ ]` not started, `[-]` in progress, `[x]` done, `[!]` blocked

## Goal
Improve translated image quality by replacing blocky erase/write behavior with layout-aware rendering, stronger background restoration, and better typography.

## Progress Snapshot
- Overall status: `completed`
- Current phase: `Phase 5 (completed)`
- Last updated: `2026-02-06`

## Phase 0: Baseline and Safety Net
Status: `[x]`

### Scope
- Capture current output behavior and define quality metrics.
- Add tests that protect existing successful behavior while enabling refactors.

### Tasks
- [x] Add a short "known artifacts" list to this document with sample screenshots references.
- [ ] Add/expand tests around:
  - [x] line wrapping and overflow handling
  - [x] alignment behavior
  - [x] color selection behavior
- [x] Add optional debug hooks for write-back metrics (font size chosen, line count, overflow flag).

### Files
- `tests/image-writeback-fontsize.test.ts`
- `tests/writeback-ui.test.ts`
- `src/utils/image-writeback.ts`
- `docs/WRITEBACK_IMPROVEMENT_PLAN.md`

### Exit Criteria
- [x] Tests pass and baseline behavior is documented.

### Known Artifacts (Baseline)
- Blocky rectangular patches over non-uniform backgrounds (texture/gradient mismatch).
  - Sample reference target: `docs/screenshots/writeback/baseline-rect-fill.png` (to capture)
- Centered paragraph placement that drifts from original line flow.
  - Sample reference target: `docs/screenshots/writeback/baseline-centered-layout.png` (to capture)
- Readability loss when auto-selected foreground color is wrong for local background variation.
  - Sample reference target: `docs/screenshots/writeback/baseline-color-contrast.png` (to capture)

---

## Phase 1: Layout-Aware Rendering (Quick Win)
Status: `[x]`

### Scope
- Stop center-block paragraph drawing.
- Render using line-level geometry and baseline alignment.

### Tasks
- [x] Introduce a line-level region model for write-back input.
- [x] Render translated text with:
  - [x] left/right alignment inferred from source geometry
  - [x] `alphabetic` baseline placement
  - [x] improved vertical spacing based on text metrics
- [x] Keep backward compatibility for existing region input shape.
- [x] Add tests for:
  - [x] preserved alignment
  - [x] deterministic font-fit decisions
  - [x] multi-line placement stability

### Files
- `src/utils/paragraph-grouping.ts`
- `src/utils/image-writeback.ts`
- `src/translation-controller.ts`
- `tests/image-writeback-fontsize.test.ts`
- `tests/writeback.test.ts`

### Exit Criteria
- [x] Translated text visually follows original reading flow better than baseline.
- [x] All tests pass (`npm test`, `npm run typecheck`, `npm run lint`).

---

## Phase 2: Geometry Preservation (Rotation/Skew)
Status: `[x]`

### Scope
- Preserve oriented OCR geometry from engines into the write-back pipeline.

### Tasks
- [x] Extend OCR types with optional oriented geometry:
  - [x] `quad?: [number, number][]` (4 points)
  - [x] `angle?: number`
- [x] Preserve geometry in engine mapping layers where available.
- [x] Update write-back renderer to rotate text using canvas transforms when angle/quad exists.
- [x] Add tests for:
  - [x] type compatibility
  - [x] transform invocation behavior
  - [x] fallback to axis-aligned rendering when geometry absent

### Files
- `src/types/ocr-engine.ts`
- `src/engines/easyocr-engine.ts`
- `src/types/esearch-types.ts`
- `src/utils/paragraph-grouping.ts`
- `src/utils/image-writeback.ts`
- `tests/*writeback*.test.ts`

### Exit Criteria
- [x] Rotated/slanted source text no longer gets flattened into horizontal overlays.
- [x] Existing engines still compile and pass tests.

---

## Phase 3: Better Erase/Restore (Mask + Inpainting)
Status: `[x]`

### Scope
- Replace hard rectangle fills with mask-based background restoration.

### Tasks
- [x] Build text masks from OCR regions (line/word-level), with configurable dilation.
- [x] Add an inpainting path:
  - [x] preferred: OpenCV.js Telea
  - [x] fallback: current fill method when inpainting unavailable
- [x] Add a feature flag to toggle inpainting mode.
- [x] Add tests for:
  - [x] mask creation determinism
  - [x] graceful fallback path
  - [x] no crash when OpenCV runtime is unavailable

### Files
- `src/utils/image-writeback.ts`
- `src/translation-controller.ts`
- `src/app-template.ts` (if exposing a toggle)
- `tests/writeback-ui.test.ts`
- `tests/image-writeback-fontsize.test.ts`

### Exit Criteria
- [x] Background seams/artifacts are substantially reduced on textured backgrounds.
- [x] Fallback behavior remains stable.

---

## Phase 4: Text Readability and Script Support
Status: `[x]`

### Scope
- Improve color and wrapping for real-world multilingual text.

### Tasks
- [x] Replace simple luminance threshold with WCAG contrast-based foreground selection.
- [x] Add optional halo/outline stroke for noisy backgrounds.
- [x] Improve wrapping/tokenization for non-space-delimited scripts.
- [x] Ensure `ctx.direction` and RTL handling paths are covered.
- [x] Add tests for:
  - [x] contrast target logic
  - [x] CJK/RTL wrapping behavior
  - [x] halo rendering toggles

### Files
- `src/utils/image-writeback.ts`
- `tests/image-writeback-fontsize.test.ts`
- `tests/translation-ui.test.ts`

### Exit Criteria
- [x] Text remains legible across bright/dark/noisy backgrounds.
- [x] Multilingual rendering regressions are covered by tests.

---

## Phase 5: UX, Tuning, and Documentation
Status: `[x]`

### Scope
- Productize improvements and document configuration/limits.

### Tasks
- [x] Add write-back quality presets (for example: `fast`, `balanced`, `high-quality`).
- [x] Expose key settings in UI (if desired): inpainting mode, text halo, aggressiveness.
- [x] Add performance notes and memory considerations.
- [x] Update docs:
  - [x] `docs/SPECIFICATION.md`
  - [x] `docs/DECISION_LOG.md`
  - [x] `README.md`

### Files
- `src/translation-controller.ts`
- `src/app-template.ts`
- `src/style.css`
- `README.md`
- `docs/SPECIFICATION.md`
- `docs/DECISION_LOG.md`

### Exit Criteria
- [x] Team can choose quality/performance profile intentionally.
- [x] Documentation matches shipped behavior.

---

## Execution Checklist Per Phase
Run these before marking a phase complete:
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`

## Notes / Decisions Log
- `2026-02-06`: Initial phased plan created.
- `2026-02-06`: Completed Phase 0 with new write-back metrics hook and baseline tests for wrapping, alignment, and color behavior.
- `2026-02-06`: Validation run completed (`npm test`, `npm run typecheck`, `npm run lint`), with only pre-existing lint warnings in `src/utils/model-cache.ts`.
- `2026-02-06`: Completed Phase 1 with line-level write-back regions, geometry-inferred horizontal alignment, and `alphabetic` baseline rendering.
- `2026-02-06`: Completed Phase 2 by preserving OCR quad/angle metadata and applying canvas rotation during write-back when orientation is available.
- `2026-02-06`: Completed Phase 3 with deterministic mask generation, OpenCV inpaint attempt (`inpaint-auto`), and safe fallback to fill-based erase.
- `2026-02-06`: Completed Phase 4 with WCAG contrast selection, RTL direction handling, no-space script wrapping, and optional halo stroke rendering.
- `2026-02-06`: Completed Phase 5 with UI write-back quality presets and documentation updates for profile behavior and tradeoffs.
