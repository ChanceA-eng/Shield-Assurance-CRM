import { OPPORTUNITY_STAGES, type OpportunityStage } from '@crm/shared';

export interface RecordedOutcome {
  scope_key: string;
  payload: { stage: OpportunityStage; source: string; cost: number; premium: number | null; occurred_on: string; reason: string };
  created_at: string;
}
export function opportunityMetrics(rows: RecordedOutcome[], from: string, to: string) {
  const selected = rows.filter((row) => row.payload.occurred_on >= from && row.payload.occurred_on <= to);
  const sources = [...new Set(selected.map((row) => row.payload.source))].sort();
  return sources.map((source) => {
    const records = selected.filter((row) => row.payload.source === source);
    const count = (stage: OpportunityStage): number => new Set(records.filter((row) => row.payload.stage === stage).map((row) => row.scope_key)).size;
    const businesses = new Set(records.map((row) => row.scope_key)).size;
    const cost = records.reduce((sum, row) => sum + row.payload.cost, 0), qualified = count('qualified');
    const actualPremium = (stage: 'quote' | 'bound'): number => {
      const latest = new Map<string, RecordedOutcome>();
      for (const row of records.filter((row) => row.payload.stage === stage).sort((a, b) => a.payload.occurred_on.localeCompare(b.payload.occurred_on) || a.created_at.localeCompare(b.created_at))) latest.set(row.scope_key, row);
      return [...latest.values()].reduce((sum, row) => sum + (row.payload.premium ?? 0), 0);
    };
    return { source, businesses, stages: Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, count(stage)])),
      cost, cost_per_qualified: qualified ? cost / qualified : null,
      verified_rate: businesses ? count('contact_verified') / businesses : null,
      qualified_rate: businesses ? qualified / businesses : null,
      meeting_rate: businesses ? count('meeting') / businesses : null,
      submission_rate: businesses ? count('submission') / businesses : null,
      bind_rate: businesses ? count('bound') / businesses : null,
      quoted_premium: actualPremium('quote'), written_premium: actualPremium('bound'),
      decline_reasons: records.filter((row) => ['declined', 'lost'].includes(row.payload.stage)).map((row) => row.payload.reason) };
  });
}
