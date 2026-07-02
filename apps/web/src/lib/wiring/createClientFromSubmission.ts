import { prisma } from '../prisma';
import { getSupabaseServerClient } from '../supabase-server';
import { writeNotification } from '../automation';

type SubmissionType = 'commercial' | 'personal';

type ConversionResult = {
  status: 'converted' | 'already_converted';
  clientId: string;
  submissionId: string;
  type: SubmissionType;
};

type ClientIdRow = { id: string };

function isIgnorableSchemaError(message: string): boolean {
  const value = message.toLowerCase();
  return value.includes('column') || value.includes('relation') || value.includes('schema cache') || value.includes('does not exist');
}

export async function createClientFromSubmission(submissionId: string, type: SubmissionType): Promise<ConversionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (type === 'commercial') {
    const account = await prisma.commercialAccount.findUnique({
      where: { id: submissionId },
      include: {
        quotes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!account) {
      throw new Error('Commercial intake account not found.');
    }

    if (account.convertedClientId) {
      return {
        status: 'already_converted',
        clientId: account.convertedClientId,
        submissionId,
        type,
      };
    }

    const fullName = account.legalName.trim();
    const address = account.physicalAddress.trim();

    const existingClient = await supabase.from('clients').select('id').ilike('full_name', fullName).maybeSingle();
    if (existingClient.error) {
      throw new Error(existingClient.error.message);
    }

    let clientId = (existingClient.data as ClientIdRow | null)?.id ?? null;

    if (!clientId) {
      const inserted = await supabase
        .from('clients')
        .insert([
          {
            full_name: fullName,
            address: address || null,
            source: 'Commercial Intake Conversion',
          },
        ])
        .select('id')
        .single();

      if (inserted.error) {
        throw new Error(inserted.error.message);
      }

      clientId = inserted.data.id;
    }

    if (!clientId) {
      throw new Error('Client conversion failed for commercial submission.');
    }

    await prisma.commercialAccount.update({
      where: { id: submissionId },
      data: {
        convertedClientId: clientId,
        convertedAt: new Date(),
      },
    });

    const latestQuote = account.quotes[0] ?? null;

    const assetInsert = await supabase.from('client_assets').insert([
      {
        client_id: clientId,
        title: `Commercial Intake - ${account.legalName}`,
        asset_type: 'commercial_intake',
        value: account.id,
        metadata: {
          commercial_account_id: account.id,
          fein: account.fein,
          dba_name: account.dbaName,
          industry_group: account.industryGroup,
          naics_code: account.naicsCode,
          risk_snapshot: account.riskSnapshot,
        },
      },
      {
        client_id: clientId,
        title: `Commercial Quote - ${account.legalName}`,
        asset_type: 'commercial_quote',
        value: latestQuote?.id ?? null,
        metadata: {
          commercial_account_id: account.id,
          quote_id: latestQuote?.id ?? null,
          quote_status: latestQuote?.status ?? 'not_generated',
          quote_carrier: latestQuote?.carrier ?? 'manual_review',
        },
      },
    ]);

    if (assetInsert.error && !isIgnorableSchemaError(assetInsert.error.message)) {
      throw new Error(assetInsert.error.message);
    }

    await writeNotification({
      client_id: clientId,
      type: 'lead',
      message: `Commercial intake converted to client profile for ${account.legalName}.`,
    });

    return {
      status: 'converted',
      clientId,
      submissionId,
      type,
    };
  }

  const account = await prisma.personalAccount.findUnique({
    where: { id: submissionId },
  });

  if (!account) {
    throw new Error('Personal submission not found.');
  }

  if (account.convertedClientId) {
    return {
      status: 'already_converted',
      clientId: account.convertedClientId,
      submissionId,
      type,
    };
  }

  const fullName = `${account.firstName} ${account.lastName}`.trim();
  const email = account.primaryEmail.trim().toLowerCase();
  const phone = account.primaryPhone.trim();
  const address = `${account.streetAddress}, ${account.city}, ${account.state} ${account.zipCode}`.trim();

  const existingByEmail = await supabase.from('clients').select('id').ilike('email', email).maybeSingle();
  if (existingByEmail.error) {
    throw new Error(existingByEmail.error.message);
  }

  let clientId = (existingByEmail.data as ClientIdRow | null)?.id ?? null;

  if (!clientId) {
    const inserted = await supabase
      .from('clients')
      .insert([
        {
          full_name: fullName,
          phone: phone || null,
          email,
          address: address || null,
          source: 'Personal Submission Conversion',
        },
      ])
      .select('id')
      .single();

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    clientId = inserted.data.id;
  }

  if (!clientId) {
    throw new Error('Client conversion failed for personal submission.');
  }

  await prisma.personalAccount.update({
    where: { id: submissionId },
    data: {
      convertedClientId: clientId,
      convertedAt: new Date(),
    },
  });

  const assetInsert = await supabase.from('client_assets').insert([
    {
      client_id: clientId,
      title: `Personal Submission - ${fullName}`,
      asset_type: 'personal_submission',
      value: account.id,
      metadata: {
        personal_account_id: account.id,
        first_name: account.firstName,
        last_name: account.lastName,
        dob: account.dob,
        current_carrier: account.currentCarrier,
        current_policy_expiration: account.currentPolicyExpiration,
        auto_snapshot: account.autoSnapshot,
        property_snapshot: account.propertySnapshot,
        quote_modules: account.quoteModules,
      },
    },
  ]);

  if (assetInsert.error && !isIgnorableSchemaError(assetInsert.error.message)) {
    throw new Error(assetInsert.error.message);
  }

  await writeNotification({
    client_id: clientId,
    type: 'lead',
    message: `Personal submission converted to client profile for ${fullName}.`,
  });

  return {
    status: 'converted',
    clientId,
    submissionId,
    type,
  };
}
