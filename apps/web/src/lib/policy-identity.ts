const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PolicyPayload = Record<string, unknown>;
const TEXT_FIELDS = ['insured_name', 'phone', 'email', 'address', 'carrier', 'line_of_business', 'sub_type',
  'policy_number', 'effective_date', 'renewal_date', 'expiration_date', 'billing_type', 'source', 'prior_policy_id', 'status'] as const;

export function policyFields(payload: PolicyPayload): PolicyPayload {
  const fields: PolicyPayload = {};
  for (const key of TEXT_FIELDS) {
    if (typeof payload[key] === 'string') fields[key] = payload[key].trim() || null;
    else if (payload[key] === null) fields[key] = null;
  }
  if (!fields.policy_number && typeof payload.policyNumber === 'string') fields.policy_number = payload.policyNumber.trim();
  if ('premium' in payload) {
    const premium = Number(payload.premium);
    if (!Number.isFinite(premium) || premium < 0) throw new Error('Premium must be a non-negative number.');
    fields.premium = premium;
  }
  if ('renewal_date' in fields && !('expiration_date' in fields)) fields.expiration_date = fields.renewal_date;
  if ('expiration_date' in fields && !('renewal_date' in fields)) fields.renewal_date = fields.expiration_date;
  if (typeof fields.email === 'string') fields.email = fields.email.toLowerCase();
  return fields;
}

export function policyIdentity(payload: { account_id?: unknown; client_id?: unknown; lead_id?: unknown }): {
  accountId: string; leadId: string | null;
} {
  const accountId = payload.account_id ?? payload.client_id;
  if (typeof accountId !== 'string' || !UUID.test(accountId)) throw new Error('Select an existing account.');
  if (payload.client_id && payload.account_id && payload.client_id !== payload.account_id) {
    throw new Error('Account and client IDs must identify the same account.');
  }
  const leadId = payload.lead_id || null;
  if (leadId !== null && (typeof leadId !== 'string' || !UUID.test(leadId))) throw new Error('Select a valid lead.');
  return { accountId, leadId };
}

export function operationErrorStatus(code?: string): number {
  if (code === 'P0002') return 404;
  if (code === '23514' || code === '23505' || code === '40001') return 409;
  if (code === '22023' || code === '22P02' || code === '22007' || code === '22008') return 400;
  if (code === 'PGRST202' || code === '42883') return 503;
  return 500;
}
