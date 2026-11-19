import { NextRequest, NextResponse } from 'next/server';
import { parseSocialConnectionCommand } from '@crm/shared';
import { openSocialToken, sealSocialToken } from '@crm/shared/social-token-crypto';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { socialDatabaseError } from '../../../../lib/social-marketing-errors';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import {
  discoverSocialMetaPages, getSocialMetaPage, revokeSocialMetaGrant, socialMetaConfigurationIssues, socialMetaCookieNames,
} from '../../../../lib/social-meta-provider';
import type { SocialConnectionsList } from '@crm/shared';

interface OAuthGrantRow {
  id: string;
  workspace_id: string;
  external_user_id: string;
  encrypted_user_token: string;
  granted_scopes: string[];
  token_expires_at: string;
  expires_at: string;
}

function tokenContext(workspaceId: string, subject: string): string {
  return `${workspaceId}:meta:${subject}`;
}

function clearGrantCookie(response: NextResponse, request: NextRequest): void {
  response.cookies.set(socialMetaCookieNames().grant, '', {
    httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
    path: '/api/social-marketing/connections', maxAge: 0,
  });
}

async function loadOAuthGrant(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string, id: string): Promise<OAuthGrantRow> {
  const result = await db.rpc('load_social_oauth_grant', { p_actor: actor, p_id: id });
  if (result.error) throw socialDatabaseError(result.error);
  if (!result.data || typeof result.data !== 'object') throw new WorkspaceError('Social authorization expired. Reconnect and choose an account.', 409);
  const row = result.data as OAuthGrantRow;
  if (row.id !== id || !row.workspace_id || !row.external_user_id || !row.encrypted_user_token
    || !Array.isArray(row.granted_scopes) || Date.parse(row.expires_at) <= Date.now()) {
    throw new WorkspaceError('Social authorization expired. Reconnect and choose an account.', 409);
  }
  return row;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const listed = await db.rpc('list_social_provider_connections', { p_actor: session.user.id });
    if (listed.error) throw socialDatabaseError(listed.error);
    if (!listed.data || typeof listed.data !== 'object') throw new WorkspaceError('Connected-account status could not be confirmed. Reload.', 503);
    const data = listed.data as Omit<SocialConnectionsList, 'enabled' | 'setup_issues' | 'candidates' | 'oauth_expires_at' | 'discovery_error'>;
    const issues = socialMetaConfigurationIssues();
    const connections = Array.isArray(data.connections) ? data.connections : null;
    const grants = Array.isArray(data.grants) ? data.grants : null;
    if (!connections || !grants || typeof data.can_manage !== 'boolean') throw new WorkspaceError('Connected-account status returned an invalid response.', 503);
    const responseBody: SocialConnectionsList = {
      enabled: issues.length === 0, setup_issues: issues, can_manage: data.can_manage, connections, grants,
      candidates: [], oauth_expires_at: null, discovery_error: null,
    };
    const cookie = request.cookies.get(socialMetaCookieNames().grant)?.value;
    if (cookie && data.can_manage && issues.length === 0) {
      try {
        const grant = await loadOAuthGrant(db, session.user.id, cookie);
        const token = openSocialToken(grant.encrypted_user_token, tokenContext(grant.workspace_id, `user:${grant.external_user_id}`));
        responseBody.candidates = await discoverSocialMetaPages(token, grant.granted_scopes);
        responseBody.oauth_expires_at = grant.expires_at;
      } catch (failure) {
        if (!(failure instanceof WorkspaceError) || failure.status !== 409) throw failure;
        responseBody.discovery_error = failure.message;
      }
    }
    const response = NextResponse.json(responseBody, { headers: { 'Cache-Control': 'private, no-store' } });
    if (responseBody.discovery_error) clearGrantCookie(response, request);
    return response;
  } catch (error) { return workspaceApiError(error, 'social-connections/list'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    let command;
    try { command = parseSocialConnectionCommand(body); }
    catch (failure) { throw new WorkspaceError(failure instanceof Error ? failure.message : 'Invalid social connection command.', 400); }
    if (command.action === 'select_page') {
      const grantId = request.cookies.get(socialMetaCookieNames().grant)?.value;
      if (!grantId) throw new WorkspaceError('Reconnect Meta before choosing a Page.', 409);
      const grant = await loadOAuthGrant(db, session.user.id, grantId);
      const userToken = openSocialToken(grant.encrypted_user_token, tokenContext(grant.workspace_id, `user:${grant.external_user_id}`));
      const accounts = await discoverSocialMetaPages(userToken, grant.granted_scopes);
      const selected = accounts.find((account) => account.id === command.page_id);
      if (!selected) throw new WorkspaceError('That Facebook Page is not authorized by this Meta login. Refresh the list.', 403);
      if (!selected.can_publish_facebook) throw new WorkspaceError(selected.facebook_block_reason ?? 'This Page cannot publish. Check its Meta permissions.', 403);
      if (command.include_instagram && (!selected.instagram_business_account || !selected.can_publish_instagram)) {
        throw new WorkspaceError(selected.instagram_block_reason ?? 'The linked Instagram account is not ready.', 403);
      }
      const page = await getSocialMetaPage(userToken, command.page_id, grant.granted_scopes);
      const instagram = page.instagram_business_account;
      if (command.include_instagram && (!instagram || instagram.id !== selected.instagram_business_account?.id)) {
        throw new WorkspaceError('The linked Instagram account changed during selection. Refresh Page discovery and try again.', 409);
      }
      const scopes = grant.granted_scopes;
      const rows: Array<{
        platform: 'facebook_page' | 'instagram_business';
        external_account_id: string;
        account_name: string;
        username: string | null;
        parent_page_id: string | null;
        parent_page_name: string | null;
        encrypted_page_token: string | null;
        can_publish: boolean;
        capability_reason: string | null;
        granted_scopes: string[];
      }> = [{
        platform: 'facebook_page', external_account_id: page.id, account_name: page.name, username: null,
        parent_page_id: null, parent_page_name: null,
        encrypted_page_token: sealSocialToken(page.access_token, tokenContext(grant.workspace_id, `page:${page.id}`)),
        can_publish: true, capability_reason: null, granted_scopes: scopes,
      }];
      if (command.include_instagram && instagram) rows.push({
        platform: 'instagram_business', external_account_id: instagram.id,
        account_name: instagram.username || instagram.id,
        username: instagram.username || null, parent_page_id: page.id, parent_page_name: page.name,
        encrypted_page_token: null, can_publish: true, capability_reason: null, granted_scopes: scopes,
      });
      const saved = await db.rpc('save_social_provider_accounts', { p_actor: session.user.id, p_oauth_grant_id: grant.id, p_accounts: rows });
      if (saved.error) throw socialDatabaseError(saved.error);
      if (!saved.data) throw new WorkspaceError('The selected social account was not confirmed. Reload before retrying.', 503);
      return NextResponse.json(saved.data, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (command.action === 'finish_selection') {
      const grantId = request.cookies.get(socialMetaCookieNames().grant)?.value;
      if (grantId) {
        const finished = await db.rpc('finish_social_oauth_grant', { p_actor: session.user.id, p_id: grantId });
        if (finished.error) throw socialDatabaseError(finished.error);
      }
      const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
      clearGrantCookie(response, request);
      return response;
    }
    if (command.action === 'disconnect_account') {
      const result = await db.rpc('disconnect_social_provider_account', { p_actor: session.user.id, p_connection_id: command.id });
      if (result.error) throw socialDatabaseError(result.error);
      if (!result.data) throw new WorkspaceError('Account disconnection was not confirmed. Reload before retrying.', 503);
      return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const revoked = await db.rpc('load_social_provider_revoke', { p_actor: session.user.id, p_grant_id: command.grant_id });
    if (revoked.error) throw socialDatabaseError(revoked.error);
    if (!revoked.data || typeof revoked.data !== 'object') throw new WorkspaceError('Meta authorization could not be loaded. Reconnect before retrying.', 503);
    const grant = revoked.data as { id: string; workspace_id: string; external_user_id: string; encrypted_user_token: string };
    if (grant.id !== command.grant_id || !grant.workspace_id || !grant.external_user_id || !grant.encrypted_user_token) {
      throw new WorkspaceError('Meta authorization could not be loaded. Reconnect before retrying.', 503);
    }
    try {
      const userToken = openSocialToken(grant.encrypted_user_token, tokenContext(grant.workspace_id, `user:${grant.external_user_id}`));
      await revokeSocialMetaGrant(userToken);
    }
    catch {
      const pending = await db.rpc('finish_social_provider_revoke', {
        p_actor: session.user.id, p_grant_id: grant.id, p_revoked: false, p_error: 'Remote Meta revocation could not be confirmed.',
      });
      if (pending.error) throw socialDatabaseError(pending.error);
      if (!pending.data) throw new WorkspaceError('Meta revocation failed and the CRM could not confirm publishing is disabled. Contact an administrator before retrying.', 503);
      throw new WorkspaceError('Meta revocation could not be confirmed. CRM publishing is disabled; retry revocation or remove this app in Meta settings.', 503);
    }
    const completed = await db.rpc('finish_social_provider_revoke', {
      p_actor: session.user.id, p_grant_id: grant.id, p_revoked: true, p_error: null,
    });
    if (completed.error) throw socialDatabaseError(completed.error);
    if (!completed.data) throw new WorkspaceError('Meta access was revoked, but the CRM status was not confirmed. Reload the page.', 503);
    return NextResponse.json(completed.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-connections/command'); }
}
