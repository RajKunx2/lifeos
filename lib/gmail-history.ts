/**
 * Gmail history API — what the Pub/Sub webhook uses instead of a search
 * query. A push notification only tells you "something changed, and the
 * mailbox's history is now at id X" — it does NOT tell you which message.
 * You have to ask Gmail "what changed between the id I last saw and X?".
 *
 * This is also why the mailbox's `startHistoryId` must be persisted
 * (see lib/db.ts's gmail_sync_state collection) — without a last-known
 * id there's nothing to diff against.
 */
import { getValidAccessToken } from './google-oauth';

export interface HistoryResult {
  newMessageIds: string[];
  historyId: string;
}

export async function fetchHistorySince(startHistoryId: string): Promise<HistoryResult> {
  const auth = await getValidAccessToken();
  if ('error' in auth) throw new Error(auth.error);

  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${auth.token}` } });

    // A 404 means startHistoryId is too old (Gmail only retains ~1 week of
    // history) — the caller should fall back to a full resync in this case.
    if (res.status === 404) throw new Error('startHistoryId is stale — run a full resync instead.');
    if (!res.ok) throw new Error(`Gmail history.list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const json: any = await res.json();
    for (const h of json.history ?? []) {
      for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
    }
    if (json.historyId) latestHistoryId = json.historyId;
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { newMessageIds: [...ids], historyId: latestHistoryId };
}
