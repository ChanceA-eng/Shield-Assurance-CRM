import { extractPolicyInBrowser } from './browser-policy-extraction';
import { INTAKE_MAX_FILE_BYTES, type IntakePage } from './policy-document-intake';
import { extractCarrierAppetite, extractCarrierAppetiteMetadata } from './carrier-appetite';

export async function readCarrierAppetite(file: File, signal: AbortSignal, progress: (message: string) => void, forceOcr = false) {
  if (!file.size || file.size > INTAKE_MAX_FILE_BYTES) throw new Error('Choose a nonempty carrier document of 25 MB or less.');
  let pages: IntakePage[];
  if (/\.(txt|csv|xlsx)$/i.test(file.name)) {
    let text: string;
    if (/\.xlsx$/i.test(file.name)) {
      const xlsx = await import('xlsx');
      const book = xlsx.read(await file.arrayBuffer(), { type: 'array' });
      pages = book.SheetNames.map((name, index) => ({ page: index + 1,
        text: `${name}\n${xlsx.utils.sheet_to_csv(book.Sheets[name], { FS: '  ' })}`, method: 'text', confidence: null }));
    } else {
      text = await file.text();
      pages = [{ page: 1, text, method: 'text', confidence: null }];
    }
  } else {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mime: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const type = mime[extension];
    if (!type) throw new Error('Use PDF, PNG, JPEG, WebP, TXT, CSV or XLSX.');
    const source = file.type === type ? file : new File([file], file.name, { type });
    const document = await extractPolicyInBrowser(source, signal, progress, { forceOcr, preserveColumns: true });
    pages = document.pages;
  }
  if (signal.aborted) throw new Error('Carrier document reading cancelled. Nothing was saved.');
  if (!pages.some((page) => page.text.trim())) throw new Error('No readable carrier guidance was found. Try OCR or a clearer source.');
  return { pages: pages.map(({ page, text }) => ({ page, text })), rules: extractCarrierAppetite(pages), metadata: extractCarrierAppetiteMetadata(pages) };
}
