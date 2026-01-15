# Multi-Engine Browser OCR System

A browser-based OCR system supporting multiple OCR engines using the Strategy Pattern.

## Features

- **MVP Phase**: Tesseract.js OCR engine
- **Post-MVP Phase**: Transformers.js with TrOCR model
- Pluggable architecture for easy engine addition
- IndexedDB model caching
- Web Worker-based processing
- TypeScript with strict mode

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Formatting

```bash
npm run format
```

## Project Structure

```
src/
├── engines/     # OCR engine implementations
├── utils/       # Utility functions
├── types/       # TypeScript type definitions
└── main.ts      # Application entry point

tests/           # Test files
```

## Requirements

- Modern browser with WASM, Web Workers, and IndexedDB support
- Chrome 90+, Firefox 88+, or Safari 15+

## Documentation

See `.kiro/specs/multi-engine-browser-ocr/` for detailed requirements, design, and implementation plan.
