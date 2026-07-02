import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { buildRiskSnapshot } from './riskSnapshot';
import { evaluateCarriers } from './carrierMatrix';
import { calculateCompleteness } from './completenessScore';
import type { CommercialIntakeBaseInput, RiskProfileMetadata } from './RiskEngine';

interface QuoteWorkflowResult {
  status: 'incomplete' | 'created';
  snapshot: ReturnType<typeof buildRiskSnapshot>;
  completeness: ReturnType<typeof calculateCompleteness>;
  carrierMatrix: ReturnType<typeof evaluateCarriers>;
  quote?: {
    id: string;
    carrier: string;
    status: string;
    createdAt: Date;
  };
}

function parseBase(account: {
  legalName: string;
  dbaName: string | null;
  entityType: string;
  fein: string;
  physicalAddress: string;
  grossRevenue: unknown;
  yearsExperience: number;
  hasEmployees: boolean;
  hasSubcontractors: boolean;
  hasProperty: boolean;
  hasAutos: boolean;
  industryGroup: string;
  naicsCode: string;
}): CommercialIntakeBaseInput {
  return {
    legal_name: account.legalName,
    dba_name: account.dbaName,
    entity_type: account.entityType,
    fein: account.fein,
    physical_address: account.physicalAddress,
    gross_revenue: Number(account.grossRevenue ?? 0),
    years_experience: account.yearsExperience,
    has_employees: account.hasEmployees,
    has_subcontractors: account.hasSubcontractors,
    has_property: account.hasProperty,
    has_autos: account.hasAutos,
    industry_group: account.industryGroup,
    naics_code: account.naicsCode,
  };
}

export async function generateQuoteFromIntake(accountId: string): Promise<QuoteWorkflowResult> {
  const account = await prisma.commercialAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  const base = parseBase(account);
  const metadata = (account.riskProfileMetadata ?? { modules: {}, industry_specific: {} }) as RiskProfileMetadata;

  const snapshot = buildRiskSnapshot(base, metadata);
  const completeness = calculateCompleteness(snapshot);
  const carrierMatrix = evaluateCarriers(snapshot);

  if (completeness.score < 80) {
    return { status: 'incomplete', snapshot, completeness, carrierMatrix };
  }

  const eligibleCarrier = Object.entries(carrierMatrix).find(([, result]) => result.eligible)?.[0];

  const quote = await prisma.commercialQuote.create({
    data: {
      accountId,
      carrier: eligibleCarrier || 'manual_review',
      snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
      status: eligibleCarrier ? 'pending_carrier' : 'manual_review',
    },
    select: {
      id: true,
      carrier: true,
      status: true,
      createdAt: true,
    },
  });

  return { status: 'created', snapshot, completeness, carrierMatrix, quote };
}

export async function listQuotesForAccount(accountId: string) {
  return prisma.commercialQuote.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      carrier: true,
      status: true,
      createdAt: true,
    },
  });
}
