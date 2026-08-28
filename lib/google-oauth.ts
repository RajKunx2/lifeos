/**
 * Google OAuth for Gmail read-only access.
 *
 * Single-user sample, one token document (provider='google'). The
 * refresh token is what makes "authorize once" durable — Google only
 * issues one on the FIRST consent, so the auth URL forces
 * prompt=consent to guarantee we get it even on a reconnect.
 */
import { col, C } from './db';

const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET ?? '';
const REDIRECT_URI = () => process.env.GOOGLE_REDIRECT_URI ?? '';
const SCOPES = () => process.env.GOOGLE_SCOPES ?? 'https://www.googleapis.com/auth/gmail.readonly';

export function googleConfigured(): boolean {
  return !!(CLIENT_ID() && CLIENT_SECRET() && REDIRECT_URI());
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: REDIRECT_URI(),
    response_type: 'code',
    scope: SCOPES(),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenDoc {
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
  account_email: string | null;
}

export async function exchangeCodeForToken(code: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
      redirect_uri: REDIRECT_URI(), grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return { ok: false, error: `Google returned ${res.status}: ${(await res.text()).slice(0, 300)}` };

  const json: any = await res.json();
  const email = await fetchAccountEmail(json.access_token).catch(() => null);

  const c = await col<any>(C.oauthTokens);
  await c.updateOne(
    { provider: 'google' },
    {
      $set: {
        access_token: json.access_token,
        ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
        expires_at: new Date(Date.now() + json.expires_in * 1000),
        account_email: email, updated_at: new Date(),
      },
      $setOnInsert: { _id: crypto.randomUUID(), provider: 'google', created_at: new Date() },
    },
    { upsert: true },
  );
  return { ok: true };
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json.email ?? null;
}

/** A valid access token, refreshing first if it's expired or about to be. */
export async function getValidAccessToken(): Promise<{ token: string } | { error: string }> {
  const c = await col<any>(C.oauthTokens);
  const doc = (await c.findOne({ provider: 'google' })) as TokenDoc | null;
  if (!doc) return { error: 'Gmail is not connected yet — visit /api/gmail/oauth/start.' };

  const expiresSoon = new Date(doc.expires_at).getTime() - Date.now() < 60_000;
  if (!expiresSoon) return { token: doc.access_token };
  if (!doc.refresh_token) return { error: 'Access token expired and no refresh token is stored — reconnect Gmail.' };

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: doc.refresh_token, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return { error: `Token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const json: any = await res.json();
  await c.updateOne(
    { provider: 'google' },
    { $set: { access_token: json.access_token, expires_at: new Date(Date.now() + json.expires_in * 1000), updated_at: new Date() } },
  );
  return { token: json.access_token };
}
