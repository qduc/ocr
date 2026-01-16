# Multi-Engine Browser OCR System

A browser-based OCR system supporting multiple OCR engines using the Strategy Pattern.

## Features

- **MVP Phase**: Tesseract.js OCR engine
- **Post-MVP Phase**: Transformers.js with TrOCR model
- **eSearch-OCR**: PaddleOCR-based engine for Chinese/English text
- Pluggable architecture for easy engine addition
- IndexedDB model caching
- Web Worker-based processing
- TypeScript with strict mode

## Getting Started

### Installation

```bash
npm install
```

### Setting Up eSearch-OCR Models (Optional)

The eSearch-OCR engine requires PaddleOCR model files. To enable this engine:

1. **Download models** from [eSearch-OCR releases](https://github.com/xushengfeng/eSearch-OCR/releases/tag/4.0.0):

   ```bash
   # Quick setup (downloads ~7 MB)
   cd public/models/esearch
   curl -LO https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ch.zip
   unzip ch.zip && rm ch.zip
   ```

2. **Verify files exist**:
   - `public/models/esearch/det.onnx` (text detection)
   - `public/models/esearch/rec.onnx` (text recognition)
   - `public/models/esearch/ppocr_keys_v1.txt` (character dictionary)

See [public/models/esearch/README.md](public/models/esearch/README.md) for detailed instructions and alternative hosting options.

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

public/
└── models/
    └── esearch/ # eSearch-OCR model files (see README inside)

tests/           # Test files
```

## OCR Engines

| Engine | Description | Models Required |
|--------|-------------|-----------------|
| Tesseract.js | Default engine, auto-downloads models | None (auto) |
| Transformers.js | TrOCR-based, auto-downloads models | None (auto) |
| eSearch-OCR | PaddleOCR via ONNX, Chinese/English | Manual download (~7 MB) |

## Requirements

- Modern browser with WASM, Web Workers, and IndexedDB support
- Chrome 90+, Firefox 88+, or Safari 15+

## Documentation

See `.kiro/specs/multi-engine-browser-ocr/` for detailed requirements, design, and implementation plan.
