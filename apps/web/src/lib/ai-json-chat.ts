import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export async function requestJsonChat(messages: ChatMessage[], maxTokens: number, timeoutMs = 20000): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error('[ai-json-chat] OPENAI_API_KEY is missing.');
    throw new WorkspaceError('AI drafting is not configured. Add OPENAI_API_KEY to the deployment settings and redeploy.', 503);
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OUTREACH_CHAT_MODEL ?? process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
        messages, temperature: 0.6, max_tokens: maxTokens, response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      let failure: unknown;
      try { failure = await response.json(); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      const code = isRecord(failure) && isRecord(failure.error) ? failure.error.code : null;
      console.error('[ai-json-chat] HTTP error', response.status);
      if (response.status === 401 || response.status === 403) {
        throw new WorkspaceError('The AI provider rejected access. Ask your administrator to check the OpenAI API key and project permissions.', 503);
      }
      if (response.status === 429 && code === 'insufficient_quota') {
        throw new WorkspaceError('AI drafting is paused because the OpenAI project has no available quota. Check OpenAI billing and project limits.', 503);
      }
      if (response.status === 429) {
        throw new WorkspaceError('The AI provider is receiving too many requests. Wait a moment, then try drafting again.', 429);
      }
      if (response.status === 400 || response.status === 404) {
        throw new WorkspaceError('The AI provider could not accept the drafting request. Ask your administrator to check the configured AI model and its access.', 503);
      }
      throw new WorkspaceError('The AI provider is temporarily unavailable. Try drafting again shortly. No message was sent.', 503);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('choices' in payload) || !Array.isArray(payload.choices)) {
      console.error('[ai-json-chat] Missing completion choices.'); return null;
    }
    const choice: unknown = payload.choices[0];
    if (!choice || typeof choice !== 'object' || !('message' in choice)) {
      console.error('[ai-json-chat] Missing completion message.'); return null;
    }
    const message = choice.message;
    if (!message || typeof message !== 'object' || !('content' in message) || typeof message.content !== 'string' || !message.content.trim()) {
      console.error('[ai-json-chat] Missing completion text.'); return null;
    }
    return message.content;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    console.error('[ai-json-chat] request failed', error instanceof Error ? error.name : 'Unknown error');
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new WorkspaceError('AI drafting timed out. Try again with a shorter instruction. No message was sent.', 504);
    }
    throw new WorkspaceError('The CRM could not reach the AI provider. Try drafting again shortly. No message was sent.', 503);
  }
}
