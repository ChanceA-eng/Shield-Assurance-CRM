import { it, expect, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { readCarrierAppetite } from './browser-carrier-appetite';
import { extractPolicyInBrowser } from './browser-policy-extraction';
vi.mock('./browser-policy-extraction', () => ({ extractPolicyInBrowser: vi.fn() }));
it('reads real text and spreadsheet formats locally with explicit class/status columns', async () => {
  const signal = new AbortController().signal;
  const text = await readCarrierAppetite(new File(['PREFERRED CLASSES\nRestaurants'], 'guide.txt', { type: 'text/plain' }), signal, () => undefined);
  expect(text.rules[0].decision).toBe('preferred');
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Class', 'Eligible', 'State'], ['Restaurants', 'Yes', 'AZ'], ['Roofing', 'No', 'AZ']]), 'Appetite');
  const bytes: ArrayBuffer = write(workbook, { type: 'array', bookType: 'xlsx' });
  const sheet = await readCarrierAppetite(new File([bytes], 'guide.xlsx'), signal, () => undefined);
  expect(sheet.rules.map((rule) => rule.decision)).toEqual(['eligible', 'excluded']);
  expect(sheet.pages[0].text).toContain('Restaurants');
  expect(extractPolicyInBrowser).not.toHaveBeenCalled();
});
it('normalizes missing PDF MIME without changing original bytes and uses the existing local OCR engine', async () => {
  const file = new File(['%PDF synthetic'], 'guide.pdf');
  vi.mocked(extractPolicyInBrowser).mockResolvedValueOnce({ id: 'local', file, kind: 'unknown', pages: [{ page: 1, method: 'text', confidence: null,
    text: 'Carrier: Synthetic PDF\nELIGIBLE CLASSES\nRestaurants' }], suggestions: [] });
  const result = await readCarrierAppetite(file, new AbortController().signal, () => undefined, true);
  expect(vi.mocked(extractPolicyInBrowser).mock.calls.at(-1)?.[0].type).toBe('application/pdf');
  expect(vi.mocked(extractPolicyInBrowser).mock.calls.at(-1)?.[3]).toEqual({ forceOcr: true, preserveColumns: true });
  expect(result.metadata.carrier).toBe('Synthetic PDF');
});
it('explicitly rejects empty, unreadable and canceled documents', async () => {
  const signal = new AbortController().signal;
  await expect(readCarrierAppetite(new File([], 'empty.txt'), signal, () => undefined)).rejects.toThrow('nonempty');
  await expect(readCarrierAppetite(new File(['   '], 'blank.txt'), signal, () => undefined)).rejects.toThrow('No readable');
  const cancelled = new AbortController(); cancelled.abort();
  await expect(readCarrierAppetite(new File(['ELIGIBLE CLASSES\nRestaurants'], 'guide.txt'), cancelled.signal, () => undefined)).rejects.toThrow('cancelled');
});
