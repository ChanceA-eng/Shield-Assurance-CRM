import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import {
  normalizeBooleanish,
  type CommercialIntakeBaseInput,
  type RiskProfileMetadata,
} from '../RiskEngine';
import { buildRiskSnapshot } from '../riskSnapshot';
import { calculateCompleteness } from '../completenessScore';
import { evaluateCarriers } from '../carrierMatrix';

export const runtime = 'nodejs';

type IntakeRequestBody = {
  base?: Partial<CommercialIntakeBaseInput>;
  risk_profile_metadata?: RiskProfileMetadata;
  legal_consent?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function toNumber(value: unknown): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeBase(input: Partial<CommercialIntakeBaseInput> | undefined): CommercialIntakeBaseInput {
  return {
    legal_name: String(input?.legal_name ?? '').trim(),
    dba_name: String(input?.dba_name ?? '').trim() || null,
    entity_type: String(input?.entity_type ?? '').trim(),
    fein: String(input?.fein ?? '').trim(),
    physical_address: String(input?.physical_address ?? '').trim(),
    gross_revenue: toNumber(input?.gross_revenue),
    years_experience: toNumber(input?.years_experience),
    has_employees: normalizeBooleanish(input?.has_employees),
    has_subcontractors: normalizeBooleanish(input?.has_subcontractors),
    has_property: normalizeBooleanish(input?.has_property),
    has_autos: normalizeBooleanish(input?.has_autos),
    industry_group: String(input?.industry_group ?? '').trim(),
    naics_code: String(input?.naics_code ?? '000000').trim() || '000000',
  };
}

function validateBase(base: CommercialIntakeBaseInput): string[] {
  const errors: string[] = [];

  if (!base.legal_name) errors.push('legal_name is required.');
  if (!base.entity_type) errors.push('entity_type is required.');
  if (!base.fein) errors.push('fein is required.');
  if (!base.physical_address) errors.push('physical_address is required.');
  if (!base.industry_group) errors.push('industry_group is required.');
  if (!base.naics_code) errors.push('naics_code is required.');
  if (base.gross_revenue <= 0) errors.push('gross_revenue must be greater than 0.');
  if (base.years_experience < 0) errors.push('years_experience must be 0 or greater.');

  return errors;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
    }

    const payload = body as IntakeRequestBody;
    if (!payload.legal_consent) {
      return NextResponse.json({ message: 'legal_consent is required.' }, { status: 400 });
    }

    const base = normalizeBase(payload.base);
    const validationErrors = validateBase(base);

    if (validationErrors.length > 0) {
      return NextResponse.json({ message: validationErrors.join(' ') }, { status: 400 });
    }

    const riskProfileMetadata: RiskProfileMetadata = payload.risk_profile_metadata ?? {
      modules: {},
      industry_specific: {},
    };

    const snapshot = buildRiskSnapshot(base, riskProfileMetadata);
    const completeness = calculateCompleteness(snapshot);
    const carrierMatrix = evaluateCarriers(snapshot);

    const account = await prisma.commercialAccount.create({
      data: {
        legalName: base.legal_name,
        dbaName: base.dba_name,
        entityType: base.entity_type,
        fein: base.fein,
        physicalAddress: base.physical_address,
        grossRevenue: base.gross_revenue,
        yearsExperience: base.years_experience,
        hasEmployees: base.has_employees,
        hasSubcontractors: base.has_subcontractors,
        hasProperty: base.has_property,
        hasAutos: base.has_autos,
        industryGroup: base.industry_group,
        naicsCode: base.naics_code,
        riskProfileMetadata: toJson(riskProfileMetadata),
        riskSnapshot: toJson(snapshot),
        riskCompletenessScore: completeness.score,
        carrierMatrix: toJson(carrierMatrix),
        consentIp: getRequestIp(request),
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, id: account.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('unique')) {
      return NextResponse.json({ message: 'An intake with this FEIN already exists.' }, { status: 409 });
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create commercial intake.' },
      { status: 500 },
    );
  }
}
