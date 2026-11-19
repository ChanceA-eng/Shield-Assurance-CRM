import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker, OEM: { LSTM_ONLY: 1 } }));
import { extractPolicyInBrowser } from './browser-policy-extraction';

const worker = { recognize: mocks.recognize, terminate: mocks.terminate };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })));
  mocks.createWorker.mockResolvedValue(worker);
  mocks.terminate.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
describe('on-device OCR cancellation', () => {
  it('retains OCR line coordinates so label and value columns survive recognition', async () => {
    const line = (y: number, parts: Array<[string, number, number]>) => ({
      baseline: { y0: y }, bbox: { y0: y - 20, y1: y },
      words: parts.map(([text, x0, x1]) => ({ text, bbox: { x0, x1 } })),
    });
    mocks.recognize.mockResolvedValue({ data: {
      text: 'NAMED INSURED\nCARRIER\nSynthetic LLC\nExample Insurance Company', confidence: 95,
      blocks: [{ paragraphs: [{ lines: [
        line(100, [['NAMED INSURED', 40, 220], ['CARRIER', 600, 700]]),
        line(150, [['Synthetic LLC', 40, 240], ['Example Insurance Company', 600, 900]]),
      ] }] }],
    } });
    const document = await extractPolicyInBrowser(new File(['synthetic'], 'test.png', { type: 'image/png' }), new AbortController().signal, () => {});
    expect(document.pages[0].layout?.[0].cells).toHaveLength(2);
    expect(document.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'full_name', value: 'Synthetic LLC' }),
      expect.objectContaining({ field: 'carrier', value: 'Example Insurance Company' }),
    ]));
    expect(mocks.recognize).toHaveBeenCalledWith(expect.any(File), {}, { text: true, blocks: true });
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('settles cancellation even when terminating a worker leaves its OCR promise pending', async () => {
    mocks.recognize.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const running = extractPolicyInBrowser(new File(['synthetic'], 'test.png', { type: 'image/png' }), controller.signal, () => {});
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).rejects.toThrow('cancelled');
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('cancels immediately during initialization and terminates the worker when it becomes available', async () => {
    let finish: (value: typeof worker) => void = () => {};
    mocks.createWorker.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const running = extractPolicyInBrowser(new File(['synthetic'], 'test.png', { type: 'image/png' }), controller.signal, () => {});
    await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).rejects.toThrow('cancelled');
    finish(worker);
    await vi.waitFor(() => expect(mocks.terminate).toHaveBeenCalledOnce());
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
});
