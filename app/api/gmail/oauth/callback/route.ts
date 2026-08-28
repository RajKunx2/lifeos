import { NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/google-oauth';

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'Missing ?code from Google.' }, { status: 400 });

  const r = await exchangeCodeForToken(code);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  return NextResponse.json({
    ok: true,
    next: 'Gmail is connected. Now run `npm run gmail:watch` to register the Pub/Sub watch — see HOW_IT_WORKS.md.',
  });
}
