import { describe, expect, it } from 'vitest';
import { customSnoozeIso, defaultSnoozeInput, snoozePresetIso } from './task-snooze';
import {
  daysUntilRenewal,
  renewalDateOf,
  renewalMilestone,
  renewalMilestoneMessage,
  renewalPriority,
  renewalTaskDue,
  type RenewalPolicy,
} from './renewal-automation';
import { inboundNotificationMessage, phoneDigits, replyTaskSubject, senderHref, twilioSignature } from './message-alerts';

// Wednesday Oct 28 2026, 10:00 AM Arizona (17:00 UTC).
const NOW = new Date('2026-10-28T17:00:00.000Z');

describe('task snooze', () => {
  it('computes Arizona presets', () => {
    expect(snoozePresetIso('later', NOW)).toBe('2026-10-28T20:00:00.000Z');
    expect(snoozePresetIso('tomorrow', NOW)).toBe('2026-10-29T16:00:00.000Z');
    expect(snoozePresetIso('nextweek', NOW)).toBe('2026-11-02T16:00:00.000Z');
  });

  it('jumps a full week when today is Monday', () => {
    expect(snoozePresetIso('nextweek', new Date('2026-11-02T17:00:00.000Z'))).toBe('2026-11-09T16:00:00.000Z');
  });

  it('validates custom times', () => {
    expect(defaultSnoozeInput(NOW)).toBe('2026-10-29T09:00');
    expect(customSnoozeIso('2026-11-03T14:30', NOW)).toEqual({ iso: '2026-11-03T21:30:00.000Z' });
    expect(customSnoozeIso('2026-10-28T09:00', NOW)).toEqual({ error: 'Pick a time in the future.' });
    expect(customSnoozeIso('not-a-date', NOW)).toEqual({ error: 'Choose a valid date and time.' });
  });
});

describe('renewal radar helpers', () => {
  const policy: RenewalPolicy = {
    id: 'p1', client_id: 'c1', account_id: null, insured_name: 'Maria Lopez', carrier: 'Progressive',
    line_of_business: 'Auto', policy_number: 'A1', premium: 1200, renewal_date: '2026-11-20', expiration_date: null, status: 'issued',
  };

  it('counts Arizona days and picks milestones', () => {
    expect(daysUntilRenewal('2026-11-20', NOW)).toBe(23);
    expect(renewalMilestone(46)).toBeNull();
    expect(renewalMilestone(45)).toBe(45);
    expect(renewalMilestone(23)).toBe(30);
    expect(renewalMilestone(12)).toBe(15);
    expect(renewalMilestone(3)).toBe(7);
    expect(renewalMilestone(0)).toBe(0);
    expect(renewalMilestone(-3)).toBe(0);
    expect(renewalMilestone(-8)).toBeNull();
    expect(renewalPriority(16)).toBe('medium');
    expect(renewalPriority(15)).toBe('high');
  });

  it('falls back to expiration date and builds stable messages', () => {
    expect(renewalDateOf({ renewal_date: null, expiration_date: '2026-12-01T00:00:00Z' })).toBe('2026-12-01');
    expect(renewalMilestoneMessage(policy, '2026-11-20', 30)).toBe('Renewal is within 30 days: Maria Lopez (Progressive Auto) renews 2026-11-20.');
  });

  it('schedules the task 30 days out or the next business morning', () => {
    expect(renewalTaskDue('2026-12-31', NOW)).toBe('2026-12-01T16:00:00.000Z');
    expect(renewalTaskDue('2026-11-20', NOW)).toBe('2026-10-29T15:00:00.000Z');
  });
});

describe('inbound message alerts', () => {
  it('formats names, links and subjects', () => {
    expect(phoneDigits('+1 (602) 555-0101')).toBe('6025550101');
    expect(replyTaskSubject('Ana', 'email')).toBe("Reply to Ana's email");
    expect(replyTaskSubject('Ana', 'sms')).toBe("Reply to Ana's text message");
    expect(inboundNotificationMessage('Ana', 'email', 'Quote question', 'body')).toBe('New email from Ana: Quote question');
    expect(inboundNotificationMessage('Ana', 'sms', null, 'Can you call me?')).toBe('New text from Ana: Can you call me?');
    expect(senderHref({ clientId: null, leadId: 'l1', name: null })).toBe('/leads?lead=l1');
    expect(senderHref({ clientId: 'c1', leadId: 'l1', name: null })).toBe('/clients/c1?tab=communication');
    expect(senderHref({ clientId: null, leadId: null, name: null })).toBe('/communication');
  });

  it('matches the documented Twilio signature algorithm', () => {
    // Example from Twilio's webhook security documentation.
    const signature = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675309',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
    });
    expect(signature).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });
});
