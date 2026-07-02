import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';

type NewPersonalRequest = {
  form?: Record<string, string>;
  modules?: Record<string, boolean>;
};

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as NewPersonalRequest;
    const form = payload.form ?? {};

    const requiredFields = ['first_name', 'last_name', 'dob', 'primary_phone', 'primary_email', 'street_address', 'city', 'state', 'zip_code'];
    const missing = requiredFields.filter((key) => !String(form[key] ?? '').trim());
    if (missing.length > 0) {
      return NextResponse.json({ message: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
    }

    if (String(form.legal_consent ?? 'no') !== 'yes') {
      return NextResponse.json({ message: 'Consent is required.' }, { status: 400 });
    }

    const dob = parseDate(form.dob);
    if (!dob) {
      return NextResponse.json({ message: 'Invalid date of birth.' }, { status: 400 });
    }

    const expiration = parseDate(form.current_policy_expiration);

    const record = await prisma.personalAccount.create({
      data: {
        firstName: form.first_name.trim(),
        lastName: form.last_name.trim(),
        dob,
        primaryPhone: form.primary_phone.trim(),
        primaryEmail: form.primary_email.trim().toLowerCase(),
        streetAddress: form.street_address.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zipCode: form.zip_code.trim(),
        currentCarrier: form.current_carrier?.trim() || null,
        currentPolicyExpiration: expiration,
        creditScoreTier: form.credit_score_tier?.trim() || null,
        rawCarrierData: toJson({}),
        autoSnapshot: toJson({}),
        propertySnapshot: toJson({}),
        quoteModules: toJson(payload.modules ?? {}),
        consentIp: getRequestIp(request),
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, id: record.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to create personal submission.' }, { status: 500 });
  }
}
