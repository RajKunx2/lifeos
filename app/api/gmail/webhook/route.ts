import { NextResponse } from 'next/server';
import { col, C } from '@/lib/db';
import { fetchHistorySince } from '@/lib/gmail-history';
import { fetchMessage, type RawGmailMessage } from '@/lib/gmail';
import { parseAndStoreEmails } from '@/lib/email-parser';

/**
 * Gmail Pub/Sub push endpoint.
 *
 * Google Cloud Pub/Sub POSTs here the moment Gmail publishes a
 * new-history notification (see scripts/setup-gmail-watch.mjs and
 * HOW_IT_WORKS.md for how that subscription gets wired up). The body
 * looks like:
 *
 *   {
 *     "message": {
 *       "data": "<base64 JSON: { emailAddress, historyId }>",
 *       "messageId": "...",
 *       "publishTime": "..."
 *     },
 *     "subscription": "projects/.../subscriptions/..."
 *   }
 *
 * The payload never contains the email itself — just "history changed,
 * it's now at id X" — so this handler diffs against the last historyId
 * we've seen to find which message(s) actually arrived, then runs the
 * normal sender-allowlist + LLM pipeline on those.
 *
 * Security: Pub/Sub push requests can be verified two ways.
 *  1. (what this sample does) a shared secret in the URL —
 *     .../api/gmail/webhook?token=GMAIL_WEBHOOK_SECRET — cheap and
 *     enough for a personal project behind an unguessable URL.
 *  2. (recommended for anything more exposed) configure the push
 *     subscription with an OIDC token and verify the signed JWT Google
 *     attaches as an Authorization header. See:
 *     https://cloud.google.com/pubsub/docs/push#authenticate_push_endpoints
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!process.env.GMAIL_WEBHOOK_SECRET || token !== process.env.GMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const dataB64: string | undefined = body?.message?.data;
  if (!dataB64) return NextResponse.json({ error: 'malformed Pub/Sub envelope' }, { status: 400 });

  const payload = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8')) as {
    emailAddress: string;
    historyId: string | number;
  };

  const syncCol = await col<any>(C.gmailSync);
  const state = await syncCol.findOne({ provider: 'gmail' });
  const startHistoryId = state?.last_history_id ?? String(payload.historyId);

  let history;
  try {
    history = await fetchHistorySince(startHistoryId);
  } catch (e: any) {
    // Stale startHistoryId (mailbox history only retained ~1 week) —
    // fall back to the id Gmail just told us about and skip this round;
    // the next push will diff from a fresh baseline.
    await syncCol.updateOne(
      { provider: 'gmail' },
      { $set: { last_history_id: String(payload.historyId), updated_at: new Date() }, $setOnInsert: { _id: crypto.randomUUID() } },
      { upsert: true },
    );
    return NextResponse.json({ ok: false, resynced: true, error: String(e?.message ?? e) });
  }

  const patterns = (process.env.BANK_SENDER_PATTERNS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const matched: RawGmailMessage[] = [];
  for (const id of history.newMessageIds) {
    const msg = await fetchMessage(id).catch(() => null);
    if (msg && matchesAllowlist(msg, patterns)) matched.push(msg);
  }

  const result = matched.length ? await parseAndStoreEmails(matched) : null;

  await syncCol.updateOne(
    { provider: 'gmail' },
    { $set: { last_history_id: history.historyId, updated_at: new Date() }, $setOnInsert: { _id: crypto.randomUUID() } },
    { upsert: true },
  );

  // Pub/Sub push retries on any non-2xx, so always ack once handled —
  // even a partial failure inside parseAndStoreEmails() shouldn't cause
  // Google to keep re-delivering the same historyId forever.
  return NextResponse.json({
    ok: true,
    newMessages: history.newMessageIds.length,
    matched: matched.length,
    result,
  });
}

/** Same allowlist check the on-demand /api/gmail/sync route relies on Gmail's own `from:` search for — done here in-process since history.list doesn't support a query filter. */
function matchesAllowlist(msg: RawGmailMessage, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const sender = msg.sender.toLowerCase();
  return patterns.some((p) => sender.includes(p.toLowerCase()));
}
