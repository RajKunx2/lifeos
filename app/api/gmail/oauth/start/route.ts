import { NextResponse } from 'next/server';
import { buildAuthUrl, googleConfigured } from '@/lib/google-oauth';

/** Visit /api/gmail/oauth/start to begin the one-time Gmail authorization. */
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI first.' }, { status: 400 });
  }
  const state = crypto.randomUUID();
  return NextResponse.redirect(buildAuthUrl(state));
}
