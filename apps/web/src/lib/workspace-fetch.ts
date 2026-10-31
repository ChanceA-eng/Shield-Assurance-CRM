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
