import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { writeCommunicationLog, writeNotification } from '../../../lib/automation';
import { schedulePolicyRenewalLifecycle } from '../../../lib/automation';
import { sendEmail } from '../../../lib/messaging';

interface NewPolicyPayload {
  client_id?: string;
  insured_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  carrier?: string;
  line_of_business?: string;
  premium?: number | string;
  policy_number?: string;
  policyNumber?: string;
  effective_date?: string;
  renewal_date?: string;
  email_consent?: boolean;
  sms_consent?: boolean;
  status?: string;
}

interface ClientRow {
  id: string;
}

function isColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const value = message.toLowerCase();
  return value.includes('column') || value.includes('schema cache') || value.includes('does not exist');
}

function daysFromNowISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parsePremium(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function readPolicyNumber(payload: NewPolicyPayload): string {
  if (typeof payload.policy_number === 'string' && payload.policy_number.trim().length > 0) {
    return payload.policy_number.trim();
  }
  if (typeof payload.policyNumber === 'string' && payload.policyNumber.trim().length > 0) {
    return payload.policyNumber.trim();
  }
  return '';
}

function buildPolicyUpdate(payload: NewPolicyPayload): Record<string, string | number | null> {
  const updates: Record<string, string | number | null> = {};
  if (typeof payload.client_id === 'string') updates.client_id = normalizeText(payload.client_id) || null;
  if (typeof payload.insured_name === 'string') updates.insured_name = normalizeText(payload.insured_name);
  if (typeof payload.phone === 'string') updates.phone = normalizeText(payload.phone) || null;
  if (typeof payload.email === 'string') updates.email = normalizeText(payload.email).toLowerCase() || null;
  if (typeof payload.address === 'string') updates.address = normalizeText(payload.address) || null;
  if (typeof payload.carrier === 'string') updates.carrier = normalizeText(payload.carrier);
  if (typeof payload.line_of_business === 'string') updates.line_of_business = normalizeText(payload.line_of_business);
  if (typeof payload.premium === 'string' || typeof payload.premium === 'number') updates.premium = parsePremium(payload.premium);
  const normalizedPolicyNumber = readPolicyNumber(payload);
  if (normalizedPolicyNumber) updates.policy_number = normalizedPolicyNumber;
  if (typeof payload.effective_date === 'string') updates.effective_date = payload.effective_date;
  if (typeof payload.renewal_date === 'string') updates.renewal_date = payload.renewal_date;
  if (typeof payload.status === 'string') updates.status = normalizeText(payload.status);
  return updates;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const renewalWithinRaw = request.nextUrl.searchParams.get('renewal_within');

  if (!renewalWithinRaw) {
    const policyQuery = await supabase
      .from('policies')
      .select('id,client_id,insured_name,carrier,line_of_business,premium,policy_number,effective_date,renewal_date,status,created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (policyQuery.error && isColumnError(policyQuery.error.message)) {
      const fallbackPolicyQuery = await supabase
        .from('policies')
        .select('id,client_id,insured_name,carrier,line_of_business,premium,policy_number,effective_date,renewal_date,status,created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (fallbackPolicyQuery.error) {
        return NextResponse.json({ message: fallbackPolicyQuery.error.message }, { status: 500 });
      }

      return NextResponse.json(fallbackPolicyQuery.data ?? [], { status: 200 });
    }

    const { data, error } = policyQuery;
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? [], { status: 200 });
  }

  const renewalWithin = Number(renewalWithinRaw);
  const includeOverdue = request.nextUrl.searchParams.get('include_overdue') === 'true';
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from('policies')
    .select('id,insured_name,line_of_business,renewal_date,premium,status,carrier,clients(full_name)')
    .in('status', ['active', 'issued'])
    .lte('renewal_date', daysFromNowISO(renewalWithin));

  if (!includeOverdue) {
    query = query.gte('renewal_date', today);
  }

  const { data, error } = await query.order('renewal_date', { ascending: true }).limit(200);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewPolicyPayload;
  const policyNumber = readPolicyNumber(payload);

  if (!payload.insured_name || payload.insured_name.trim().length === 0) {
    return NextResponse.json({ message: 'insured_name is required.' }, { status: 400 });
  }

  // ✅ LOOSENED VALIDATION: Only require core transaction metrics to proceed
  if (
    !payload.carrier?.trim() ||
    !payload.line_of_business?.trim() ||
    !policyNumber ||
    !payload.effective_date ||
    !payload.renewal_date
  ) {
    return NextResponse.json({ message: 'Missing required policy parameters (Carrier, Line of Business, Policy Number, Effective & Renewal dates).' }, { status: 400 });
  }

  const insuredName = normalizeText(payload.insured_name);
  const email = normalizeText(payload.email).toLowerCase();
  const phone = normalizeText(payload.phone);
  const address = normalizeText(payload.address);
  const emailConsent = payload.email_consent ?? true;
  let clientId = normalizeText(payload.client_id);

  if (!clientId) {
    let matchedClient: ClientRow | null = null;

    if (email) {
      const existingByEmail = await supabase.from('clients').select('id').ilike('email', email).maybeSingle();
      if (existingByEmail.error) {
        return NextResponse.json({ message: existingByEmail.error.message }, { status: 500 });
      }
      matchedClient = existingByEmail.data;
    }

    if (!matchedClient && phone) {
      const existingByPhone = await supabase.from('clients').select('id').eq('phone', phone).maybeSingle();
      if (existingByPhone.error) {
        return NextResponse.json({ message: existingByPhone.error.message }, { status: 500 });
      }
      matchedClient = existingByPhone.data;
    }

    if (!matchedClient) {
      const existingByName = await supabase.from('clients').select('id').ilike('full_name', insuredName).maybeSingle();
      if (existingByName.error) {
        return NextResponse.json({ message: existingByName.error.message }, { status: 500 });
      }
      matchedClient = existingByName.data;
    }

    clientId = matchedClient?.id ?? '';

    if (!clientId) {
      const createdClient = await supabase
        .from('clients')
        .insert([
          {
            full_name: insuredName,
            phone: phone || null,
            email: email || null,
            address: address || null,
            source: 'Policy Issuance',
          },
        ])
        .select('id')
        .single();

      if (createdClient.error) {
        return NextResponse.json({ message: createdClient.error.message }, { status: 500 });
      }

      clientId = createdClient.data.id;
    }
  }

  // Sync core 4 fields + source attribution
  const clientUpdatePayload = {
    full_name: insuredName,
    phone: phone || null,
    email: email || null,
    address: address || null,
    source: 'Policy Issuance' 
  };

  let clientUpdate = await supabase.from('clients').update(clientUpdatePayload).eq('id', clientId);
  
  if (clientUpdate.error && isColumnError(clientUpdate.error.message)) {
    const { source: _source, ...fallbackPayload } = clientUpdatePayload;
    clientUpdate = await supabase.from('clients').update(fallbackPayload).eq('id', clientId);
  }

  if (clientUpdate.error) {
    return NextResponse.json({ message: clientUpdate.error.message }, { status: 500 });
  }

  let insertResult = await supabase
    .from('policies')
    .insert([
      {
        client_id: clientId,
        insured_name: insuredName,
        phone: phone || null,
        email: email || null,
        address: address || null,
        carrier: payload.carrier.trim(),
        line_of_business: payload.line_of_business.trim(),
        premium: parsePremium(payload.premium),
        policy_number: policyNumber,
        effective_date: payload.effective_date,
        renewal_date: payload.renewal_date,
        status: payload.status?.trim() || 'issued',
      },
    ])
    .select('*')
    .single();

  if (insertResult.error && isColumnError(insertResult.error.message)) {
    insertResult = await supabase
      .from('policies')
      .insert([
        {
          client_id: clientId,
          insured_name: insuredName,
          phone: phone || null,
          email: email || null,
          address: address || null,
          carrier: payload.carrier.trim(),
          line_of_business: payload.line_of_business.trim(),
          premium: parsePremium(payload.premium),
          policy_number: policyNumber,
          effective_date: payload.effective_date,
          renewal_date: payload.renewal_date,
          status: payload.status?.trim() || 'issued',
        },
      ])
      .select('*')
      .single();
  }

  if (insertResult.error) {
    return NextResponse.json({ message: insertResult.error.message }, { status: 500 });
  }

  await writeNotification({
    client_id: insertResult.data.client_id,
    type: 'renewal',
    message: `Policy issued for ${insertResult.data.insured_name}. Renewal automation will monitor ${insertResult.data.renewal_date}.`,
  });

  await schedulePolicyRenewalLifecycle({
    policyId: insertResult.data.id,
    clientId,
    insuredName: insertResult.data.insured_name,
    carrier: insertResult.data.carrier,
    lineOfBusiness: insertResult.data.line_of_business,
    premium: Number(insertResult.data.premium ?? 0),
    renewalDate: insertResult.data.renewal_date,
  });

  // ✅ EMAIL SAFEGUARD: Direct Vercel execution with valid address tracking checks
  if (emailConsent && email && email.trim().length > 0) {
    try {
      await sendEmail({
        to: email,
        subject: `Policy Issued: ${policyNumber}`,
        body: `Hi ${insuredName}, your ${payload.line_of_business} policy with ${payload.carrier} has been issued. Policy number: ${policyNumber}. Effective ${payload.effective_date}, renewal ${payload.renewal_date}.`,
      });
      await writeCommunicationLog({
        client_id: clientId,
        channel: 'email',
        subject: `Policy Issued: ${policyNumber}`,
        body: `Policy issuance confirmation sent for ${insuredName}.`,
        automation_type: 'renewal',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email delivery error';
      console.error('Policy email delivery failed', { clientId, email, policyNumber, error: message });
      await writeNotification({
        client_id: clientId,
        type: 'renewal',
        message: `Policy email failed: ${message}`,
      });
    }
  }

  return NextResponse.json(insertResult.data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewPolicyPayload & { id?: string };
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates = buildPolicyUpdate(payload);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  let updateResult = await supabase.from('policies').update(updates).eq('id', payload.id).select('*').single();

  if (updateResult.error && isColumnError(updateResult.error.message)) {
    const { policy_number: _policyNumber, ...fallbackUpdates } = updates;
    updateResult = await supabase.from('policies').update(fallbackUpdates).eq('id', payload.id).select('*').single();
  }

  if (updateResult.error) {
    return NextResponse.json({ message: updateResult.error.message }, { status: 500 });
  }

  if (updateResult.data && updateResult.data.client_id) {
    const syncPayload = {
      full_name: updateResult.data.insured_name,
      phone: updateResult.data.phone || null,
      email: updateResult.data.email ? updateResult.data.email.toLowerCase() : null,
      address: updateResult.data.address || null,
      source: 'Policy Issuance'
    };

    let syncUpdate = await supabase.from('clients').update(syncPayload).eq('id', updateResult.data.client_id);
    if (syncUpdate.error && isColumnError(syncUpdate.error.message)) {
      const { source: _src, ...fallbackSyncPayload } = syncPayload;
      await supabase.from('clients').update(fallbackSyncPayload).eq('id', updateResult.data.client_id);
    }
  }

  return NextResponse.json(updateResult.data, { status: 200 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('policies').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}