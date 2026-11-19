import { randomInt, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ResendSendError, resendConfiguration, sendResendEmail } from '@crm/shared/resend';
import { DEFAULT_EMAIL_DESIGN } from '@crm/shared';
import { assertSameOriginJson, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { parseProspectAnswers, parseProspectContact, parseQuestionnaire, prospectUpload } from '../../../../lib/prospect-questionnaires';
import { prospectDb, prospectHash, prospectJson, prospectRpc, prospectToken, requireProspectUploads } from '../../../../lib/prospect-questionnaire-server';

type Context = { params: Promise<{ token: string }> };
export const maxDuration = 60;
async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new WorkspaceError('Request not found.', 404);
    const db = prospectDb(), hash = prospectHash(token);
    const cookieName = `prospect-${hash.slice(0, 16)}`;
    const body = request.method === 'GET' ? { action: 'form' } : await workspaceBody(request);
    if (request.method !== 'GET') assertSameOriginJson(request);
    const action = body.action;
    const session = request.cookies.get(cookieName)?.value ?? '';
    const base = { session_hash: prospectHash(session) };
    const rpc = (operation: string, data: Record<string, unknown>): Promise<unknown> =>
      prospectRpc(db, 'prospect_questionnaire_public', { p_hash: hash, p_action: operation, p_data: data });
    if (action === 'challenge') {
      const contact = parseProspectContact(body.contact);
      if (process.env.CRM_PROSPECT_EMAIL_ENABLED !== 'true') throw new WorkspaceError('Email codes are unavailable right now. Contact your agent.', 503);
      const code = String(randomInt(100000, 1000000));
      // Only trust the deployment platform's client-IP header, not a supplied forwarded chain.
      const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : 'local';
      if (!ip) throw new WorkspaceError('Verification is temporarily unavailable.', 503);
      const result = await rpc('challenge', { code_hash: prospectHash(`${token}:${code}`), network: prospectHash(ip), contact });
      if (!isRecord(result) || typeof result.recipient !== 'string' || !isUuid(result.id)) throw new WorkspaceError('Verification could not be started.', 503);
      try {
        await sendResendEmail({ to: result.recipient, subject: 'Your Shield Assurance verification code',
          body: `Your verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
          emailDesign: { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Shield Assurance', heading: `Your code: ${code}` },
          purpose: 'service', requestId: randomUUID() }, resendConfiguration(process.env));
      } catch (failure) {
        console.error('[questionnaire/verification-email]', failure instanceof ResendSendError ? failure.code : failure instanceof Error ? failure.message : 'Unknown provider failure');
        throw new WorkspaceError('We could not email your code. Wait a minute and try again, or contact your agent.', 503);
      }
      return prospectJson({ message: 'We emailed you a 6-digit code.' });
    }
    if (action === 'verify') {
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new WorkspaceError('Enter the six-digit code.', 400);
      const secret = prospectToken();
      await rpc('verify', { code_hash: prospectHash(`${token}:${body.code}`), new_session: prospectHash(secret) });
      const response = prospectJson({ verified: true });
      response.cookies.set(cookieName, secret, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict',
        path: `/api/questionnaire/${token}` });
      return response;
    }
    if (action === 'upload') {
      requireProspectUploads();
      if (!isUuid(body.question_id)) throw new WorkspaceError('Choose a document question.', 400);
      const upload = prospectUpload(body);
      const file = await rpc('upload', { ...base, ...upload, id: randomUUID(), question_id: body.question_id });
      if (!isRecord(file) || typeof file.storage_path !== 'string') throw new WorkspaceError('Upload could not start.', 503);
      const signed = await db.storage.from('prospect-documents').createSignedUploadUrl(file.storage_path, { upsert: false });
      if (signed.error || !signed.data) {
        // Keep the reservation visible so it can be removed or retried, rather than silently losing it.
        console.error('[questionnaire/upload-ticket] Storage ticket failed.');
        throw new WorkspaceError('Upload could not start. Remove the unfinished upload and retry.', 503);
      }
      return prospectJson({ id: file.id, signed_url: signed.data.signedUrl, content_type: upload.type });
    }
    if (action === 'remove_file') {
      if (!isUuid(body.id)) throw new WorkspaceError('Choose an upload.', 400);
      const file = await rpc('remove_file', { ...base, id: body.id });
      if (!isRecord(file) || typeof file.storage_path !== 'string') throw new WorkspaceError('Upload removal could not be verified.', 503);
      const removed = await db.storage.from('prospect-documents').remove([file.storage_path]);
      if (removed.error) { console.error('[questionnaire/remove] Storage removal failed.'); throw new WorkspaceError('File reference removed, but private storage cleanup needs administrator attention.', 503); }
      return prospectJson({ removed: true });
    }
    if (action === 'form') return prospectJson(await rpc('form', base));
    if (action === 'submit') {
      const form = await rpc('form', base);
      if (!isRecord(form)) throw new WorkspaceError('Form could not be loaded.', 503);
      if (form.submitted === true) return prospectJson({ submitted: true });
      const answers = parseProspectAnswers(parseQuestionnaire(form.design), body.answers);
      return prospectJson(await rpc('submit', { ...base, answers, consent: body.consent }));
    }
    throw new WorkspaceError('Choose a questionnaire action.', 400);
  } catch (failure) {
    const response = workspaceApiError(failure, 'questionnaires/public');
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}
export const GET = handle;
export const POST = handle;
