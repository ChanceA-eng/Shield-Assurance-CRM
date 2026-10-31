import { describe, expect, it } from 'vitest';
import { directoryRows, type DirectoryAccount, type DirectoryPolicy, type DirectoryTask } from './client-directory';

const now = new Date('2026-10-31T17:00:00Z');
const accounts: DirectoryAccount[] = [
  { id: 'a', full_name: 'Alice', email: 'alice@example.invalid', phone: '+15205550100', address: null, assigned_producer: null, account_type: null, created_at: '' },
  { id: 'b', full_name: 'Bob', email: null, phone: null, address: null, assigned_producer: null, account_type: null, created_at: '' },
];
const policies: DirectoryPolicy[] = [{ id: 'p', client_id: 'a', account_id: null, policy_number: 'AUTO-123',
  status: 'active', effective_date: '2026-01-01', expiration_date: '2026-11-15' }];
const tasks: DirectoryTask[] = [
  { id: 't', account_id: 'a', related_id: 'lead', related_type: 'lead', subject: 'Alice: call', due_date: '2026-10-31T16:59:00Z' },
  { id: 'later', account_id: 'a', related_id: 'a', related_type: 'client', subject: 'Later', due_date: null },
];
describe('Client directory', () => {
  it.each(['Alice', 'alice@example.invalid', 'AUTO-123', '(520) 555-0100', 'Workshop'])('searches %s', (search) => {
    expect(directoryRows(accounts, policies, tasks, new Map([['a', ['Workshop']]]), search, 'all', now).map((row) => row.id)).toEqual(['a']);
  });
  it('uses placed policies, not an account row, to identify clients', () => {
    expect(directoryRows(accounts, policies, tasks, new Map(), '', 'active', now).map((row) => row.id)).toEqual(['a']);
    expect(directoryRows(accounts, policies, tasks, new Map(), '', 'prospect', now).map((row) => row.id)).toEqual(['b']);
  });
  it('compares actual due instants and retains undated work after dated actions', () => {
    const row = directoryRows(accounts, policies, tasks, new Map(), '', 'overdue', now)[0];
    expect(row?.overdue_count).toBe(1);
    expect(row?.next_task?.id).toBe('t');
    expect(directoryRows(accounts, policies, tasks, new Map(), '', 'overdue', new Date('2026-10-31T16:58:00Z'))).toHaveLength(0);
  });
  it('uses Arizona renewal boundaries and excludes cancelled policies', () => {
    expect(directoryRows(accounts, policies, [], new Map(), '', 'renewals', now)).toHaveLength(1);
    expect(directoryRows(accounts, [{ ...policies[0]!, status: 'cancelled' }], [], new Map(), '', 'renewals', now)).toHaveLength(0);
  });
  it('has no one-hundred-account cutoff', () => {
    const many = Array.from({ length: 130 }, (_, index) => ({ ...accounts[0]!, id: String(index), full_name: `Account ${index}` }));
    expect(directoryRows(many, [], [], new Map(), '', 'all', now)).toHaveLength(130);
  });
});
