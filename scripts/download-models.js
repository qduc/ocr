import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_DIR = path.resolve(__dirname, '../public/models/esearch');
const CH_ZIP_URL = 'https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ch.zip';
const ZIP_PATH = path.join(MODELS_DIR, 'ch.zip');

const REQUIRED_FILES = [
  'det.onnx',
  'rec.onnx',
  'ppocr_keys_v1.txt'
];

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  const allFilesExist = REQUIRED_FILES.every(file =>
    fs.existsSync(path.join(MODELS_DIR, file))
  );

  if (allFilesExist) {
    console.log('eSearch-OCR model files already exist, skipping download.');
    return;
  }

  console.log('Downloading eSearch-OCR model files (~13MB)...');

  try {
    await downloadFile(CH_ZIP_URL, ZIP_PATH);
    console.log('Download complete. Extracting...');

    const zip = new AdmZip(ZIP_PATH);
    const zipEntries = zip.getEntries();

    zipEntries.forEach((entry) => {
      let targetName = entry.entryName;
      if (entry.entryName === 'ppocr_det.onnx') targetName = 'det.onnx';
      if (entry.entryName === 'ppocr_rec.onnx') targetName = 'rec.onnx';

      if (REQUIRED_FILES.includes(targetName)) {
        console.log(`- Extracting ${entry.entryName} as ${targetName}`);
        const content = entry.getData();
        fs.writeFileSync(path.join(MODELS_DIR, targetName), content);
      }
    });

    console.log('Extraction complete. Cleaning up...');
    fs.unlinkSync(ZIP_PATH);
    console.log('All model files are ready.');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
