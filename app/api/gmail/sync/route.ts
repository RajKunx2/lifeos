import { NextResponse } from 'next/server';
import { fetchMessagesFromSenders } from '@/lib/gmail';
import { parseAndStoreEmails } from '@/lib/email-parser';

/**
 * On-demand fallback sync — searches Gmail directly instead of relying
 * on a Pub/Sub push. Useful for a first backfill, or if you'd rather
 * not stand up Pub/Sub at all and just hit this endpoint on a schedule.
 * The push-driven path is app/api/gmail/webhook/route.ts.
 */
export async function POST() {
  const patterns = (process.env.BANK_SENDER_PATTERNS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!patterns.length) {
    return NextResponse.json({ error: 'Set BANK_SENDER_PATTERNS in .env.local, e.g. "Meridian Bank,Northfield Bank".' }, { status: 400 });
  }

  const fetched = await fetchMessagesFromSenders(patterns);
  if (!fetched.ok) return NextResponse.json({ error: fetched.error }, { status: 502 });

  const result = await parseAndStoreEmails(fetched.messages);
  return NextResponse.json(result);
}
