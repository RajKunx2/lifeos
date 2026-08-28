/**
 * Gmail REST client — plain fetch, no SDK.
 */
import { getValidAccessToken } from './google-oauth';

export interface RawGmailMessage {
  gmailId: string;
  threadId: string;
  sender: string;
  subject: string;
  receivedAt: Date;
  bodyText: string;
  snippet: string;
}

/** Fetches one message's full content by id. */
export async function fetchMessage(id: string): Promise<RawGmailMessage | null> {
  const auth = await getValidAccessToken();
  if ('error' in auth) throw new Error(auth.error);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { authorization: `Bearer ${auth.token}` } },
  );
  if (!res.ok) return null;
  return parseMessage(await res.json());
}

/**
 * Lists message ids matching the sender allowlist, then fetches each
 * one's full content. Gmail's `from:` query matches address OR display
 * name, so a display-name pattern like "Meridian Bank" works directly.
 * Used by the on-demand /api/gmail/sync route; the Pub/Sub webhook uses
 * lib/gmail-history.ts instead.
 */
export async function fetchMessagesFromSenders(
  senderQueries: string[], maxResults = 40,
): Promise<{ ok: true; messages: RawGmailMessage[] } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if ('error' in auth) return { ok: false, error: auth.error };

  const q = senderQueries.map((s) => `from:(${JSON.stringify(s)})`).join(' OR ');
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('q', `${q} newer_than:30d`);
  listUrl.searchParams.set('maxResults', String(maxResults));

  const listRes = await fetch(listUrl, { headers: { authorization: `Bearer ${auth.token}` } });
  if (!listRes.ok) return { ok: false, error: `Gmail list failed: ${listRes.status} ${(await listRes.text()).slice(0, 200)}` };
  const listJson: any = await listRes.json();
  const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id);

  const messages: RawGmailMessage[] = [];
  for (const id of ids) {
    const m = await fetchMessage(id).catch(() => null);
    if (m) messages.push(m);
  }
  return { ok: true, messages };
}

function header(headers: any[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBody(data?: string): string {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Walks the MIME tree for the first text/plain part, falling back to text/html stripped of tags. */
function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data && payload.mimeType === 'text/plain') return decodeBody(payload.body.data);

  let htmlFallback = '';
  const stack = [payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBody(part.body.data);
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) htmlFallback = decodeBody(part.body.data);
    if (part.parts) stack.push(...part.parts);
  }
  return htmlFallback.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseMessage(msg: any): RawGmailMessage {
  const headers = msg.payload?.headers ?? [];
  return {
    gmailId: msg.id,
    threadId: msg.threadId,
    sender: header(headers, 'From'),
    subject: header(headers, 'Subject'),
    receivedAt: new Date(Number(msg.internalDate)),
    bodyText: extractBody(msg.payload),
    snippet: msg.snippet ?? '',
  };
}
