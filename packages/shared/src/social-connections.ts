export const SOCIAL_PROVIDER = 'meta' as const;
export const SOCIAL_PROVIDER_PLATFORMS = ['facebook_page', 'instagram_business'] as const;
export type SocialProviderPlatform = typeof SOCIAL_PROVIDER_PLATFORMS[number];
export type SocialConnectionState = 'connected' | 'reconnect' | 'revocation_pending' | 'disconnected';

export interface SocialProviderConnection {
  id: string;
  grant_id: string;
  platform: SocialProviderPlatform;
  external_account_id: string;
  account_name: string;
  username: string | null;
  parent_page_id: string | null;
  parent_page_name: string | null;
  can_publish: boolean;
  capability_reason: string | null;
  granted_scopes: string[];
  state: SocialConnectionState;
  grant_state: SocialConnectionState;
  authorized_by: string;
  token_expires_at: string | null;
  last_validated_at: string | null;
  updated_at: string;
}

export interface SocialProviderGrant {
  id: string;
  user_name: string;
  state: SocialConnectionState;
  granted_scopes: string[];
  token_expires_at: string | null;
}

export interface SocialDiscoveredAccount {
  id: string;
  name: string;
  category: string | null;
  tasks: string[];
  can_publish_facebook: boolean;
  facebook_block_reason: string | null;
  instagram_business_account: { id: string; username: string | null } | null;
  can_publish_instagram: boolean;
  instagram_block_reason: string | null;
}

export interface SocialConnectionsList {
  enabled: boolean;
  setup_issues: string[];
  can_manage: boolean;
  connections: SocialProviderConnection[];
  grants: SocialProviderGrant[];
  candidates: SocialDiscoveredAccount[];
  oauth_expires_at: string | null;
  discovery_error: string | null;
}

export type SocialConnectionCommand =
  | { action: 'select_page'; page_id: string; include_instagram: boolean }
  | { action: 'disconnect_account'; id: string }
  | { action: 'revoke_grant'; grant_id: string }
  | { action: 'finish_selection' };

export function parseSocialConnectionCommand(value: unknown): SocialConnectionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send a social connection command.');
  const body: Record<string, unknown> = { ...value };
  const uuid = (input: unknown): input is string => typeof input === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
  let command: SocialConnectionCommand;
  if (body.action === 'select_page' && typeof body.page_id === 'string' && /^\d{1,32}$/.test(body.page_id)
    && typeof body.include_instagram === 'boolean') {
    command = { action: 'select_page', page_id: body.page_id, include_instagram: body.include_instagram };
  } else if (body.action === 'disconnect_account' && uuid(body.id)) command = { action: 'disconnect_account', id: body.id };
  else if (body.action === 'revoke_grant' && uuid(body.grant_id)) command = { action: 'revoke_grant', grant_id: body.grant_id };
  else if (body.action === 'finish_selection') command = { action: 'finish_selection' };
  else throw new Error('Choose a supported social connection action.');
  if (Object.keys(body).some((key) => !Object.prototype.hasOwnProperty.call(command, key))) {
    throw new Error('Unsupported social connection field.');
  }
  return command;
}
