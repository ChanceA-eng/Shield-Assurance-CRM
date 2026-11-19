export async function workspaceFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload: T & { message?: string } = await response.json();
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

export async function workspacePages<T>(url: string, size: number, parameter: 'page' | 'offset'): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const batch = await workspaceFetch<T[]>(`${url}&${parameter}=${parameter === 'offset' ? page * size : page}`);
    if (!Array.isArray(batch)) throw new Error('The server returned an invalid record list.');
    rows.push(...batch);
    if (batch.length < size) return rows;
  }

}

export async function workspacePage<T>(url: string): Promise<{ rows: T[]; nextOffset: number | null }> {
  const response = await fetch(url, { cache: 'no-store' });
  const rows: unknown = await response.json();
  if (!response.ok) throw new Error(rows && typeof rows === 'object' && 'message' in rows && typeof rows.message === 'string'
    ? rows.message : `Request failed (${response.status}).`);
  if (!Array.isArray(rows)) throw new Error('The server returned an invalid message page.');
  const next = response.headers.get('X-Next-Offset');
  const nextOffset = next ? Number(next) : null;
  if (nextOffset !== null && (!Number.isSafeInteger(nextOffset) || nextOffset < 0)) throw new Error('The server returned invalid message paging.');
  return { rows, nextOffset };
}
