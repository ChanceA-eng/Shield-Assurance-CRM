import { expect, it } from 'vitest';
import path from 'node:path';
import { readAppetiteWithAI } from './carrier-appetite-ai';
import { parseCarrierAppetite } from './carrier-appetite';
import { isRecord } from './workspace-validation';
import { appetiteCoverage } from '@crm/shared';

it.skipIf(process.env.CRM_CARRIER_AI_QA_ALLOWED !== '1')('reads a synthetic public guide through the configured OpenAI model without using customer documents', async () => {
  const root = path.resolve(__dirname, '..', '..', '..', '..');
  require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
  const pages = [{ page: 1, text: 'Carrier: Synthetic QA Insurance\nCOMMERCIAL AUTO\nStates: AZ, NV\nELIGIBLE CLASSES\nFleets with at least 11 power units are eligible.\nCONTACT US\n800-555-0100\nSUBMISSION TIPS\nInclude an application.' }];
  const raw = await readAppetiteWithAI(Buffer.from(pages[0].text), 'text/plain', pages);
  if (!isRecord(raw) || !Array.isArray(raw.rules)) throw new Error('Configured AI did not return guide criteria.');
  const values = parseCarrierAppetite({ ...raw, title: 'Synthetic public fixture', access: 'unconfirmed', effective_on: '', expires_on: '',
    rules: raw.rules.map((rule: unknown) => isRecord(rule) && rule.predicate === null ? { ...rule, predicate: undefined } : rule) }, pages);
  expect(appetiteCoverage(values.line)).toEqual(['commercial auto']);
  expect(values.rules.some((rule) => rule.predicate?.field === 'power_units' && rule.predicate.operator === 'gte' && rule.predicate.value === '11')).toBe(true);
  expect(values.rules.every((rule) => !/800-555|CONTACT US|Include an application/i.test(rule.criterion))).toBe(true);
  expect(values.unresolved_entries ?? []).toHaveLength(0);
}, 100000);
