import { test, expect } from './workspace-fixtures';

type PdfText = string | { text: string; x: number; y: number };
function textPdf(lines: PdfText[], additionalPages: PdfText[][] = []): Buffer {
  const pages = [lines, ...additionalPages];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, page] of pages.entries()) {
    const stream = page.map((line, lineIndex) => {
      const { text, x, y } = typeof line === 'string' ? { text: line, x: 50, y: 750 - lineIndex * 25 } : line;
      return `BT /F1 11 Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
    }).join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

function scannedPdf(image: Buffer, searchableHeader = ''): Buffer {
  const contents = `q 600 0 0 200 6 480 cm /Image1 Do Q${searchableHeader
    ? `\nBT /F1 11 Tf 1 0 0 1 30 740 Tm (${searchableHeader}) Tj ET` : ''}`;
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Image1 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(part); length += part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
  return Buffer.concat(parts);
}

test('real PDF text extraction stays on-device and requires review before prefilling the account', async ({ page, data }) => {
  test.setTimeout(90000);
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'synthetic-policy.pdf', mimeType: 'application/pdf',
    buffer: textPdf(['DECLARATIONS', 'Named Insured: Synthetic Review LLC', 'Carrier: Synthetic Carrier', 'Policy Number: QA-123']),
  });
  await expect(dialog.getByLabel('Review Insured / account name', { exact: true })).toHaveValue('Synthetic Review LLC', { timeout: 60000 });
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I checked these fields/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await dialog.getByRole('button', { name: 'Use reviewed fields', exact: true }).click();
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('Synthetic Review LLC');
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

const structuredRows: Array<Array<{ text: string; x: number }>> = [
  [{ text: 'BUSINESS AUTO COVERAGE FORM', x: 40 }],
  [{ text: 'Business Name:', x: 40 }],
  [{ text: 'Synthetic Fleet LLC', x: 40 }],
  [{ text: 'Insurance Company: Example Mutual Insurance Company', x: 40 }],
  [{ text: 'Policy #: BA-991177', x: 40 }],
  [{ text: 'Full Term Premium: $2,450.00', x: 40 }],
  [{ text: 'COVERAGES', x: 40 }, { text: 'LIMITS', x: 250 }, { text: 'DEDUCTIBLES', x: 440 }, { text: 'PREMIUM', x: 530 }],
  [{ text: 'Bodily Injury Liability', x: 40 }, { text: '$1,000,000', x: 250 }, { text: '$0', x: 440 }, { text: '$400', x: 530 }],
  [{ text: 'Comprehensive', x: 40 }, { text: 'Actual Cash Value', x: 250 }, { text: '$500', x: 440 }, { text: '$100', x: 530 }],
  [{ text: 'VEHICLE SCHEDULE', x: 40 }],
  [{ text: 'YEAR', x: 40 }, { text: 'MAKE', x: 100 }, { text: 'MODEL', x: 180 }, { text: 'VIN', x: 330 }],
  [{ text: '2023', x: 40 }, { text: 'Ford', x: 100 }, { text: 'Transit', x: 180 }, { text: '1FTBW2CM5PKA00001', x: 330 }],
  [{ text: '2022', x: 40 }, { text: 'Toyota', x: 100 }, { text: 'Camry', x: 180 }, { text: '4T1G11AK2NU000001', x: 330 }],
  [{ text: 'DRIVER SCHEDULE', x: 40 }],
  [{ text: 'NAME', x: 40 }, { text: 'DATE OF BIRTH', x: 300 }, { text: 'LICENSE NUMBER', x: 440 }],
  [{ text: 'Synthetic Driver One', x: 40 }, { text: '01/01/1980', x: 300 }, { text: 'A12345678', x: 440 }],
  [{ text: 'Synthetic Driver Two', x: 40 }, { text: '02/02/1981', x: 300 }, { text: 'A99999999', x: 440 }],
  [{ text: 'PROPERTY SCHEDULE', x: 40 }],
  [{ text: 'Location 1: 123 Example Road, Tucson, AZ 85701', x: 40 }],
  [{ text: 'Construction: Masonry', x: 40 }],
  [{ text: 'FORMS AND ENDORSEMENTS', x: 40 }],
  [{ text: 'Form: CA 00 01 11 20', x: 40 }],
  [{ text: 'NAICS: 484110', x: 40 }],
];

test('expanded reviewed details survive account save and a retry without duplicate uploads, and reopen on the private source', async ({ page, data }) => {
  let accountWrites = 0;
  let uploads = 0;
  let patches = 0;
  let review: Record<string, string> = {};
  const fileId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
  const stored = () => ({ id: fileId, client_id: data.account.id, file_name: 'structured-policy.pdf', file_type: 'PDF',
    source_kind: 'stored', status: 'stored', download_url: `/api/clients/${data.account.id}/files/${fileId}/download`, intake_review: review });
  await page.route('**/api/clients', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    accountWrites++;
    await route.fulfill({ json: { ...data.account, ...route.request().postDataJSON() } });
  });
  await page.route('**/qa-intake-upload', async (route) => { uploads++; await route.fulfill({ json: {} }); });
  await page.route(`**/api/clients/${data.account.id}/files**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/upload')) {
      await route.fulfill({ json: { upload: { signed_url: `${url.origin}/qa-intake-upload`, storage_path: 'synthetic-path', content_type: 'application/pdf' },
        file: { file_name: 'structured-policy.pdf', content_type: 'application/pdf', file_size: 4 } } });
    } else if (url.pathname.endsWith('/complete')) {
      review = route.request().postDataJSON().intake_review as Record<string, string>;
      await route.fulfill({ json: stored() });
    } else if (route.request().method() === 'PATCH') {
      patches++;
      if (patches === 1) { await route.fulfill({ status: 503, json: { message: 'Synthetic review update unavailable.' } }); return; }
      review = route.request().postDataJSON().intake_review as Record<string, string>;
      await route.fulfill({ json: stored() });
    } else await route.fulfill({ json: uploads ? [stored()] : [] });
  });
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'structured-policy.pdf', mimeType: 'application/pdf',
    buffer: textPdf(structuredRows.flatMap((row, index) => row.map((cell) => ({ ...cell, y: 750 - index * 24 })))),
  });
  await expect(dialog.getByLabel('Review Drivers', { exact: true })).toHaveValue('Synthetic Driver One\nSynthetic Driver Two', { timeout: 60000 });
  await dialog.getByLabel('Review Deductibles', { exact: true }).fill('Comprehensive: $750\nCollision: $1,000');
  await dialog.getByRole('checkbox', { name: /I checked these fields/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await dialog.getByRole('button', { name: 'Use reviewed fields', exact: true }).click();
  expect(accountWrites).toBe(0);
  expect(uploads).toBe(0);
  await dialog.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Account saved. Document review needs retry');
  await dialog.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(accountWrites).toBe(1);
  expect(uploads).toBe(1);
  expect(patches).toBe(2);
  expect(review).toMatchObject({ full_name: 'Synthetic Fleet LLC', carrier: 'Example Mutual Insurance Company',
    policy_number: 'BA-991177', premium: '2450.00', deductibles: 'Comprehensive: $750\nCollision: $1,000',
    drivers: 'Synthetic Driver One\nSynthetic Driver Two' });
  expect(review.vehicles).toContain('Transit');
  expect(review.vehicles).toContain('Camry');
  await page.goto(`/clients/${data.account.id}?tab=files`);
  await page.getByText('Reviewed policy details', { exact: true }).click();
  await expect(page.getByText('Comprehensive: $750\nCollision: $1,000', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Driver One\nSynthetic Driver Two', { exact: true })).toBeVisible();
});

for (const mode of ['PDF text', 'photo OCR'] as const) {
  test(`structured ${mode} fills expanded review fields without source text under boxes`, async ({ page, data }) => {
    test.setTimeout(120000);
    await page.goto('/policies');
    await page.getByRole('button', { name: /New Policy/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New Policy', exact: true });
    await dialog.getByText('Import policy documents on this device', { exact: true }).click();
    const external: string[] = [];
    page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
    const buffer = mode === 'PDF text' ? textPdf(structuredRows.flatMap((row, index) => row.map((cell) => ({ ...cell, y: 750 - index * 24 }))))
      : Buffer.from(await page.evaluate((rows) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1836; canvas.height = 2376;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'black'; context.font = '33px Arial';
        rows.forEach((row, index) => row.forEach((cell) => context.fillText(cell.text, cell.x * 3, (42 + index * 24) * 3)));
        return canvas.toDataURL('image/png').split(',')[1];
      }, structuredRows), 'base64');
    await dialog.getByLabel('Policy intake documents').setInputFiles({
      name: mode === 'PDF text' ? 'structured-policy.pdf' : 'structured-policy.png',
      mimeType: mode === 'PDF text' ? 'application/pdf' : 'image/png', buffer,
    });
    await expect(dialog.getByLabel('Review Insured / account name', { exact: true })).toHaveValue('Synthetic Fleet LLC', { timeout: 90000 });
    await expect(dialog.getByLabel('Review Carrier', { exact: true })).toHaveValue('Example Mutual Insurance Company');
    await expect(dialog.getByLabel('Review Policy number', { exact: true })).toHaveValue('BA-991177');
    await expect(dialog.getByLabel('Review Policy premium', { exact: true })).toHaveValue('2450.00');
    await expect(dialog.getByLabel('Review Line of business', { exact: true })).toHaveValue('Business auto');
    await expect(dialog.getByLabel('Review Coverage limits', { exact: true })).toHaveValue(/Bodily Injury Liability.*1,000,000[\s\S]*Comprehensive.*Actual Cash Value/);
    await expect(dialog.getByLabel('Review Deductibles', { exact: true })).toHaveValue(/Comprehensive.*500/);
    await expect(dialog.getByLabel('Review Vehicles', { exact: true })).toHaveValue(/2023.*Ford.*Transit[\s\S]*2022.*Toyota.*Camry/);
    await expect(dialog.getByLabel('Review Drivers', { exact: true })).toHaveValue('Synthetic Driver One\nSynthetic Driver Two');
    await expect(dialog.getByLabel('Review Properties / locations', { exact: true })).toHaveValue(/123 Example Road/);
    await expect(dialog.getByLabel('Review Additional policy details', { exact: true })).toHaveValue(/CA 00 01 11 20/);
    await expect(dialog.locator('label span')).toHaveCount(0);
    await expect(dialog.getByText('Not identified. Leave blank or verify and enter manually.', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('pre').first()).not.toBeVisible();
    await dialog.getByRole('checkbox', { name: /I checked these fields/ }).check();
    page.once('dialog', (prompt) => void prompt.accept());
    await dialog.getByRole('button', { name: 'Use reviewed fields', exact: true }).click();
    await expect(dialog.getByLabel('Insured name', { exact: true })).toHaveValue('Synthetic Fleet LLC');
    await expect(dialog.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('BA-991177');
    await expect(dialog.getByPlaceholder('Premium', { exact: true })).toHaveValue('2450.00');
    expect(external).toEqual([]);
    expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
  });
}

test('long policies process every page without splitting or truncating the document', async ({ page, data }) => {
  test.setTimeout(90000);
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  await expect(dialog).toContainText('No PDF page-count limit');
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  const remaining = Array.from({ length: 124 }, (_, index) => [
    `Synthetic policy terms page ${index + 2}. These provisions are for private document intake verification only.`,
    ...(index === 123 ? ['Policy Number: LONG-125'] : []),
  ]);
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'long-policy.pdf', mimeType: 'application/pdf',
    buffer: textPdf(['DECLARATIONS', 'Named Insured: Synthetic Long Policy LLC'], remaining),
  });
  await expect(dialog.getByLabel('Review Policy number', { exact: true })).toHaveValue('LONG-125', { timeout: 60000 });
  await expect(dialog).toContainText('125 page(s)');
  await expect(dialog.getByText('long-policy.pdf, page 125: Policy Number: LONG-125', { exact: true })).toHaveCount(0);
  await dialog.getByText('Extraction details', { exact: true }).click();
  await dialog.locator('summary').filter({ hasText: /^long-policy\.pdf$/ }).click();
  await dialog.getByText('Page 125 · PDF text', { exact: true }).click();
  await expect(dialog.locator('pre').last()).toContainText('Policy Number: LONG-125');
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

test('real declarations preserve positioned columns and multiline insured details without using agent contacts', async ({ page, data }) => {
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  const positioned = [
    { text: 'EXAMPLE PROPERTY AND CASUALTY INSURANCE COMPANY', x: 40, y: 755 },
    { text: 'COMMERCIAL GENERAL LIABILITY DECLARATIONS', x: 40, y: 735 },
    { text: 'AGENCY', x: 40, y: 660 },
    { text: '1. NAMED INSURED AND MAILING ADDRESS', x: 330, y: 660 },
    { text: 'Example Agency', x: 40, y: 640 },
    { text: 'Synthetic Workshop LLC', x: 330, y: 640 },
    { text: '987 Agency Street', x: 40, y: 620 },
    { text: '123 Example Road', x: 330, y: 620 },
    { text: 'Phoenix, AZ 85001', x: 40, y: 600 },
    { text: 'Tucson, AZ 85701', x: 330, y: 600 },
    { text: 'Phone: (520) 555-0999', x: 40, y: 580 },
    { text: 'Phone: (520) 555-0123', x: 330, y: 580 },
    { text: 'Email: broker@example.invalid', x: 40, y: 565 },
    { text: 'Email: insured@example.invalid', x: 330, y: 565 },
    { text: 'POLICY NUMBER', x: 40, y: 550 },
    { text: 'EFFECTIVE DATE', x: 240, y: 550 },
    { text: 'EXPIRATION DATE', x: 400, y: 550 },
    { text: 'GL-987654', x: 40, y: 530 },
    { text: '11/06/2026', x: 240, y: 530 },
    { text: '11/06/2027', x: 400, y: 530 },
    { text: 'TOTAL POLICY PREMIUM', x: 40, y: 490 },
    { text: '$2,345.67', x: 40, y: 470 },
  ];
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'positioned-declarations.pdf', mimeType: 'application/pdf', buffer: textPdf(positioned),
  });
  for (const [label, value] of [
    ['Insured / account name', 'Synthetic Workshop LLC'], ['Mailing address', '123 Example Road, Tucson, AZ 85701'],
    ['Carrier', 'EXAMPLE PROPERTY AND CASUALTY INSURANCE COMPANY'], ['Policy number', 'GL-987654'],
    ['Effective date', '2026-11-06'], ['Expiration date', '2027-11-06'], ['Policy premium', '2345.67'],
    ['Line of business', 'Commercial general liability'],
    ['Phone', '(520) 555-0123'], ['Email', 'insured@example.invalid'],
  ]) await expect(dialog.getByLabel(`Review ${label}`, { exact: true })).toHaveValue(value, { timeout: 60000 });
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

test('unrecognized readable text is diagnosed and OCR retry replaces the review without saving', async ({ page, data }) => {
  test.setTimeout(120000);
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  const sentence = 'Synthetic reference document with no account or coverage fields for extraction.';
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'unrecognized.pdf', mimeType: 'application/pdf', buffer: textPdf([sentence]),
  });
  await expect(dialog.getByRole('status')).toContainText('no account or policy fields were identified', { timeout: 60000 });
  await expect(dialog.getByRole('alert')).toContainText('No fields identified');
  await dialog.getByText('Extraction details', { exact: true }).click();
  await dialog.locator('summary').filter({ hasText: /^unrecognized\.pdf$/ }).click();
  await dialog.getByText('Page 1 · PDF text', { exact: true }).click();
  await expect(dialog.locator('pre')).toContainText(sentence);
  await dialog.getByLabel('Review Insured / account name', { exact: true }).fill('Discarded review edit');
  await dialog.getByRole('checkbox', { name: /I checked these fields/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await dialog.getByRole('button', { name: 'Retry with OCR', exact: true }).click();
  await expect(dialog).toContainText('1 OCR page(s)', { timeout: 90000 });
  await expect(dialog.getByRole('status')).toContainText('no account or policy fields were identified');
  await expect(dialog.getByLabel('Review Insured / account name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('checkbox', { name: /I checked these fields/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

test('one unreadable policy does not discard declarations or prevent later files from being extracted', async ({ page, data }) => {
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  await dialog.getByLabel('Policy intake documents').setInputFiles([
    { name: 'readable-declarations.pdf', mimeType: 'application/pdf', buffer: textPdf(['DECLARATIONS', 'Named Insured: Synthetic Batch LLC']) },
    { name: 'unreadable-policy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ninvalid synthetic PDF fixture') },
    { name: 'readable-policy.pdf', mimeType: 'application/pdf', buffer: textPdf(['Synthetic insurance policy terms and conditions for private review.', 'Policy Number: BATCH-333']) },
  ]);
  await expect(dialog.getByLabel('Review Insured / account name', { exact: true })).toHaveValue('Synthetic Batch LLC', { timeout: 60000 });
  await expect(dialog.getByLabel('Review Policy number', { exact: true })).toHaveValue('BATCH-333');
  await expect(dialog.getByRole('alert')).toContainText('unreadable-policy.pdf');
  await expect(dialog.getByRole('alert')).toContainText('not included in the review');
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

test('real photo OCR uses only same-origin assets and preserves fields for agent review', async ({ page, data }) => {
  test.setTimeout(120000);
  await page.goto('/policies');
  await page.getByRole('button', { name: /New Policy/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New Policy', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black'; context.font = '32px Arial';
    ['DECLARATIONS', 'Named Insured: Synthetic Example LLC', 'Policy Number: QA-456', 'Carrier: Example Carrier'].forEach((line, index) => context.fillText(line, 40, 70 + index * 70));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'synthetic-declarations.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64'),
  });
  await expect.poll(async () => {
    const failure = await dialog.getByRole('alert').allTextContents();
    if (failure.length) throw new Error(failure.join(' '));
    return dialog.getByLabel('Review Policy number', { exact: true }).inputValue({ timeout: 1000 }).catch(() => '');
  }, { timeout: 90000 }).toBe('QA-456');
  await expect(dialog.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('');
  await dialog.getByRole('checkbox', { name: /I checked these fields/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await dialog.getByRole('button', { name: 'Use reviewed fields', exact: true }).click();
  await expect(dialog.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('QA-456');
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

for (const searchableHeader of ['', 'Synthetic searchable header for a scanned declarations page with no policy fields']) {
test(`real scanned PDF ${searchableHeader ? 'with a searchable header ' : ''}rasterizes and OCRs locally before agent review`, async ({ page, data }) => {
  test.setTimeout(120000);
  await page.goto('/policies');
  await page.getByRole('button', { name: /New Policy/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New Policy', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black'; context.font = '32px Arial';
    ['DECLARATIONS', 'Named Insured: Synthetic Scan LLC', 'Policy Number: SCAN-789', 'Carrier: Example Carrier'].forEach((line, index) => context.fillText(line, 40, 70 + index * 70));
    return canvas.toDataURL('image/jpeg', 0.98).split(',')[1];
  });
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(new URL(request.url()).origin); });
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'synthetic-scan.pdf', mimeType: 'application/pdf', buffer: scannedPdf(Buffer.from(encoded, 'base64'), searchableHeader),
  });
  await expect(dialog.getByLabel('Review Policy number', { exact: true })).toHaveValue('SCAN-789', { timeout: 90000 });
  await expect(dialog.getByLabel('Review Insured / account name', { exact: true })).toHaveValue('Synthetic Scan LLC');
  await expect(dialog.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toBeDisabled();
  expect(external).toEqual([]);
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});
}

test('cancelling private extraction restores manual intake without applying or saving fields', async ({ page, data }) => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/intake-engine/pdf.worker.min.mjs', async (route) => { await waiting; await route.continue(); });
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account', exact: true });
  await dialog.getByText('Import policy documents on this device', { exact: true }).click();
  await dialog.getByLabel('Policy intake documents').setInputFiles({
    name: 'cancelled.pdf', mimeType: 'application/pdf',
    buffer: textPdf(['DECLARATIONS', 'Named Insured: Should Not Apply', 'Policy Number: CANCELLED-123']),
  });
  try {
    await expect(dialog.getByRole('button', { name: 'Save Account', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel processing', exact: true }).click();
  } finally { release(); }
  await expect(dialog.getByRole('button', { name: 'Save Account', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Use reviewed fields', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('cancelled');
  expect(data.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});
