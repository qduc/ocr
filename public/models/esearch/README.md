# eSearch-OCR Model Files

This directory contains the PaddleOCR model files required by the eSearch-OCR engine.

## Required Files

| File | Description | Approximate Size |
|------|-------------|------------------|
| `det.onnx` | Text detection model (DBNet) | ~2.3 MB |
| `rec.onnx` | Text recognition model (CRNN) | ~4.5 MB |
| `ppocr_keys_v1.txt` | Character dictionary (6,623 Chinese + symbols) | ~30 KB |

**Total size**: ~7 MB

## Download Instructions

### Option 1: Download from GitHub Releases (Recommended)

1. Visit the eSearch-OCR releases page:
   https://github.com/xushengfeng/eSearch-OCR/releases/tag/4.0.0

2. Download **ch.zip** (~7 MB)

3. Extract the contents:
   ```bash
   unzip ch.zip -d public/models/esearch/
   ```

4. Verify the following files exist:
   - `public/models/esearch/det.onnx`
   - `public/models/esearch/rec.onnx`
   - `public/models/esearch/ppocr_keys_v1.txt`

### Option 2: Direct Download Links

```bash
# Navigate to the models directory
cd public/models/esearch

# Download detection model
curl -LO https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/det.onnx

# Download recognition model
curl -LO https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/rec.onnx

# Download character dictionary
curl -LO https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_keys_v1.txt
```

### Option 3: One-liner Script

```bash
cd public/models/esearch && \
curl -LO https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ch.zip && \
unzip ch.zip && rm ch.zip
```

## File Checksums (SHA-256)

For verification, you can check the file integrity:

```bash
# Generate checksums
sha256sum det.onnx rec.onnx ppocr_keys_v1.txt
```

Expected checksums (may vary by release):
- `det.onnx`: Verify after download
- `rec.onnx`: Verify after download
- `ppocr_keys_v1.txt`: Verify after download

## Model Information

These models are from PaddleOCR, converted to ONNX format for browser use:

- **Detection Model**: DBNet (Differentiable Binarization Network)
  - Detects text regions in images
  - Outputs bounding boxes for text areas

- **Recognition Model**: CRNN (Convolutional Recurrent Neural Network)
  - Recognizes text within detected regions
  - Supports Chinese + English mixed text

- **Dictionary**: Character mapping file
  - Maps model output indices to characters
  - Contains 6,623 Chinese characters + symbols

## Alternative Hosting Options

For production deployments, consider these alternatives:

### CDN Hosting

1. **jsDelivr** (via GitHub releases):
   ```javascript
   const modelPaths = {
     det: 'https://cdn.jsdelivr.net/gh/xushengfeng/eSearch-OCR@4.0.0/det.onnx',
     rec: 'https://cdn.jsdelivr.net/gh/xushengfeng/eSearch-OCR@4.0.0/rec.onnx',
     dict: 'https://cdn.jsdelivr.net/gh/xushengfeng/eSearch-OCR@4.0.0/ppocr_keys_v1.txt',
   };
   ```

2. **unpkg** (if published to npm):
   ```javascript
   const modelPaths = {
     det: 'https://unpkg.com/esearch-ocr-models@4.0.0/det.onnx',
     rec: 'https://unpkg.com/esearch-ocr-models@4.0.0/rec.onnx',
     dict: 'https://unpkg.com/esearch-ocr-models@4.0.0/ppocr_keys_v1.txt',
   };
   ```

### Self-Hosted Options

1. **AWS S3 / CloudFront**:
   - Upload models to S3 bucket
   - Configure CloudFront for global CDN distribution
   - Enable CORS for browser access

2. **Google Cloud Storage**:
   - Upload to GCS bucket with public access
   - Use Cloud CDN for caching

3. **Azure Blob Storage**:
   - Configure for static website hosting
   - Enable CDN for performance

### GitHub Pages / Releases

- Host models directly from GitHub releases
- Free and reliable for open source projects
- Direct links work well for moderate traffic

## CORS Configuration

When hosting models on a different domain, ensure CORS headers are set:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
```

## Troubleshooting

### Models fail to load

1. Check browser console for network errors
2. Verify file paths are correct
3. Ensure CORS is configured if using CDN
4. Check that files are not corrupted (verify checksums)

### Slow model loading

1. Consider using a CDN closer to users
2. Enable gzip/brotli compression on server
3. Implement model caching with IndexedDB (built into this project)

## License

The PaddleOCR models are released under the Apache 2.0 license.
See: https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.6/LICENSE
