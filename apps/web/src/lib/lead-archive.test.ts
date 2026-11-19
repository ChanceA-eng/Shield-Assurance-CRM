import { describe, expect, it, vi } from 'vitest';
import { describeLeadArchive, parseLeadArchiveResults } from './lead-archive';
import { databaseError, friendlyErrorMessage } from './workspace-api';

describe('lead archive summaries', () => {
  it('explains what archiving changed in plain language', () => {
    const results = parseLeadArchiveResults([
      { id: 'a', outcome: 'archived', tasks_closed: 2, sequences_paused: 1, drafts_rejected: 1, requests_dismissed: 0 },
      { id: 'b', outcome: 'already_archived' },
    ]);
    expect(results).not.toBeNull();
    expect(describeLeadArchive('archive', results ?? [])).toBe(
      'Archived 1 lead. 2 open tasks closed, 1 email sequence paused, 1 unsent draft cancelled. 1 lead was already archived.',
    );
  });

  it('tells staff that restored sequences stay paused', () => {
    const results = parseLeadArchiveResults([{ id: 'a', outcome: 'restored', tasks_reopened: 1, sequences_paused: 2 }]) ?? [];
    expect(describeLeadArchive('restore', results)).toBe(
      'Restored 1 lead. 1 task was reopened. 2 email sequences are still paused — resume from Outreach when ready.',
    );
  });

  it('reports permanent deletes and skipped unarchived leads', () => {
    const results = parseLeadArchiveResults([
      { id: 'a', outcome: 'deleted', name: 'A' }, { id: 'b', outcome: 'deleted' }, { id: 'c', outcome: 'not_archived' },
    ]) ?? [];
    expect(describeLeadArchive('delete', results)).toBe(
      'Permanently deleted 2 leads and all of their tasks, reminders, notes, messages and automation. 1 lead was skipped because only archived leads can be deleted.',
    );
    expect(describeLeadArchive('delete', parseLeadArchiveResults([{ id: 'c', outcome: 'not_archived' }]) ?? [])).toBe(
      'No leads were deleted. 1 lead was skipped because only archived leads can be deleted.',
    );
  });

  it('rejects unexpected database results', () => {
    expect(parseLeadArchiveResults([{ id: 'a', outcome: 'erased' }])).toBeNull();
    expect(parseLeadArchiveResults({ id: 'a' })).toBeNull();
  });
});

describe('plain-language errors', () => {
  it('keeps messages our database functions wrote for staff', () => {
    const error = databaseError({ code: 'PT409', message: 'A selected task changed. Refresh and reselect.' });
    expect(error.status).toBe(409);
    expect(error.message).toBe('A selected task changed. Refresh and reselect.');
  });

  it('hides raw database wording from staff', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(databaseError({ code: '23505', message: 'duplicate key value violates unique constraint "leads_email_key"' }).message)
      .toBe('A matching record already exists.');
    expect(friendlyErrorMessage({ code: '42P01', message: 'relation "public.leads" does not exist' }))
      .toBe('Something went wrong. Please try again, and contact your administrator if it keeps happening.');
    expect(friendlyErrorMessage(new Error('column leads.foo does not exist')))
      .toBe('Something went wrong. Please try again, and contact your administrator if it keeps happening.');
    expect(friendlyErrorMessage(new Error('Choose a valid due date.'))).toBe('Choose a valid due date.');
    log.mockRestore();
  });
});
