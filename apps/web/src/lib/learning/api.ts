export async function postLearningMutation(path: string, body: unknown, fallback: string): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string') {
    throw new Error(payload.message);
  }
  throw new Error(fallback);
}
