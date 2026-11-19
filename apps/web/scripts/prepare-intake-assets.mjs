import { createRequire } from 'node:module';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public', 'intake-engine');
await mkdir(target, { recursive: true });
const core = path.dirname(require.resolve('tesseract.js-core/package.json'));
for (const name of await readdir(core)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(name)) {
    await cp(path.join(core, name), path.join(target, name));
  }
}
await cp(require.resolve('tesseract.js/dist/worker.min.js'), path.join(target, 'ocr-worker.min.js'));
const language = require('@tesseract.js-data/eng');
await cp(path.join(language.langPath, 'eng.traineddata.gz'), path.join(target, 'eng.traineddata.gz'));
const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
await cp(path.join(pdf, 'build', 'pdf.worker.min.mjs'), path.join(target, 'pdf.worker.min.mjs'));
for (const folder of ['wasm', 'standard_fonts', 'cmaps']) {
  await cp(path.join(pdf, folder), path.join(target, folder), { recursive: true });
}
console.log('Private intake PDF/OCR assets prepared for same-origin browser processing.');
