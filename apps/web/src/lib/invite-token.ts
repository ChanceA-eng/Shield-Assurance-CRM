export function inviteTokenHash(fragment: URLSearchParams, query: URLSearchParams): string | null {
  const source = fragment.get('type') === 'invite' ? fragment : query;
  return source.get('type') === 'invite' ? source.get('token_hash') : null;
}
