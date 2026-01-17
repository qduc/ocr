# eSearch-OCR PaddleOCR Models

This directory is used for storing PaddleOCR model files for the eSearch-OCR engine.

## Automatic Loading (Default)

The application is configured to fetch these models dynamically from [Hugging Face](https://huggingface.co/monkt/paddleocr-onnx) by default. This ensures you always have the latest optimized models without increasing the initial repository size.

## Manual Installation (Offline Support)

If you wish to host the models locally or use the application offline, you can manually place the following files in this directory:

1.  **Download models** from the [eSearch-OCR releases](https://github.com/xushengfeng/eSearch-OCR/releases/tag/4.0.0):
    - `det.onnx` (Text Detection)
    - `rec.onnx` (Text Recognition)
    - `ppocr_keys_v1.txt` (Character Dictionary - rename to `dict.txt` if needed by your config)

2.  **Verify files**:
    Ensure they are directly under `public/models/esearch/`.

For more details on how these are used, see `src/utils/language-config.ts` and `src/engines/esearch-engine.ts`.
