import { validateIntakeFile, suggestPolicyFields, reconstructPolicyText, type IntakePage, type LocalIntakeDocument } from './policy-document-intake';
import type { Worker } from 'tesseract.js';

export async function extractPolicyInBrowser(file: File, signal: AbortSignal, progress: (message: string) => void, options: { forceOcr?: boolean; preserveColumns?: boolean } = {}): Promise<LocalIntakeDocument> {
  validateIntakeFile(file);
  let ocr: Worker | null = null;
  const check = (): void => { if (signal.aborted) throw new Error('Document processing cancelled. Nothing was saved.'); };
  const untilCancelled = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const cancel = (): void => reject(new Error('Document processing cancelled. Nothing was saved.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    void operation.then((value) => { signal.removeEventListener('abort', cancel); resolve(value); },
      (failure: unknown) => { signal.removeEventListener('abort', cancel); reject(failure); });
  });
  const recognize = async (image: HTMLCanvasElement | File): Promise<Pick<IntakePage, 'text' | 'confidence' | 'layout'>> => {
    check();
    if (!ocr) {
      const { createWorker, OEM } = await import('tesseract.js');
      check();
      ocr = await untilCancelled(createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/intake-engine/ocr-worker.min.js', corePath: '/intake-engine',
        langPath: '/intake-engine', workerBlobURL: false, cacheMethod: 'none',
        logger: (event) => { if (!signal.aborted) progress(`On-device OCR: ${event.status} ${Math.round(event.progress * 100)}%`); },
        errorHandler: () => { if (!signal.aborted) progress('On-device OCR failed. Retry or enter fields manually.'); },
      }).then(async (worker) => {
        if (signal.aborted) await worker.terminate();
        return worker;
      }));
    }
    check();
    const active = ocr;
    if (!active) throw new Error('Document processing cancelled. Nothing was saved.');
    const result = await untilCancelled(active.recognize(image, {}, { text: true, blocks: true }));
    check();
    const items = result.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words.map((word) => ({
      text: word.text, x: word.bbox.x0, y: -line.baseline.y0,
      width: word.bbox.x1 - word.bbox.x0, height: line.bbox.y1 - line.bbox.y0,
    })))));
    const reconstructed = items?.length ? reconstructPolicyText(items) : undefined;
    return { text: reconstructed?.text ?? result.data.text.trim(), confidence: result.data.confidence,
      ...(reconstructed ? { layout: options.preserveColumns && items ? reconstructPolicyText(items, 8).layout : reconstructed.layout } : {}) };
  };
  const terminateOcr = async (): Promise<void> => {
    const active = ocr;
    ocr = null;
    if (active) await active.terminate();
  };
  const abort = (): void => { void terminateOcr(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    const pages: IntakePage[] = [];
    if (file.type === 'application/pdf') {
      const pdf = await import('pdfjs-dist');
      check();
      pdf.GlobalWorkerOptions.workerSrc = '/intake-engine/pdf.worker.min.mjs';
      const loading = pdf.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        wasmUrl: '/intake-engine/wasm/', standardFontDataUrl: '/intake-engine/standard_fonts/',
        cMapUrl: '/intake-engine/cmaps/', cMapPacked: true,
      });
      const cancelPdf = (): void => { void loading.destroy(); };
      signal.addEventListener('abort', cancelPdf, { once: true });
      try {
        check();
        const document = await loading.promise;
        for (let index = 1; index <= document.numPages; index += 1) {
          check(); progress(`Reading page ${index} of ${document.numPages} on this device...`);
          const page = await document.getPage(index);
          try {
            const content = await page.getTextContent();
            const items = content.items.flatMap((item) => 'str' in item ? [{
              text: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
              height: Math.max(1, item.height),
            }] : []);
            const { text, layout } = reconstructPolicyText(items);
            const nativePage: IntakePage = { page: index, text, layout: options.preserveColumns ? reconstructPolicyText(items, 4).layout : layout, method: 'text', confidence: null };
            let needsOcr = options.forceOcr || text.replace(/\s/g, '').length < 40;
            if (!needsOcr) {
              const operations = await page.getOperatorList();
              const viewport = page.getViewport({ scale: 1 });
              const savedAreas: number[] = [];
              let area = 1;
              for (const [operationIndex, operation] of operations.fnArray.entries()) {
                if (operation === pdf.OPS.save) savedAreas.push(area);
                else if (operation === pdf.OPS.restore) area = savedAreas.pop() ?? 1;
                else if (operation === pdf.OPS.transform) {
                  const args: unknown[] = operations.argsArray[operationIndex];
                  const [a, b, c, d] = args;
                  if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number' && typeof d === 'number') {
                    area *= Math.abs(a * d - b * c);
                  }
                } else if ([pdf.OPS.paintImageXObject, pdf.OPS.paintInlineImageXObject].includes(operation)
                  && area >= viewport.width * viewport.height * 0.2) {
                  // A scanned block can coexist with a searchable header; a small logo is not a scan.
                  needsOcr = true;
                  break;
                }
              }
            }
            if (needsOcr) {
              const viewport = page.getViewport({ scale: 2 });
              if (viewport.width * viewport.height > 16000000) throw new Error('This PDF page is too large to process safely. Resize it or enter its fields manually.');
              const canvas = window.document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              try {
                await page.render({ canvas, viewport }).promise;
                const result = await recognize(canvas);
                pages.push({ ...result, page: index, method: 'ocr' });
              } finally { canvas.width = 0; canvas.height = 0; }
            } else pages.push(nativePage);
          } finally { page.cleanup(); }
        }
      } finally {
        signal.removeEventListener('abort', cancelPdf);
        await loading.destroy();
      }
    } else {
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 16000000) throw new Error('This photo exceeds 16 megapixels. Resize it before processing.');
      } finally { bitmap.close(); }
      const result = await recognize(file);
      pages.push({ ...result, page: 1, method: 'ocr' });
    }
    check();
    if (!pages.some((page) => page.text.trim())) throw new Error('No readable text was found. Use a clearer document or enter the fields manually.');
    return { id: crypto.randomUUID(), file, pages, ...suggestPolicyFields(pages) };
  } finally {
    signal.removeEventListener('abort', abort);
    await terminateOcr();
  }
}
