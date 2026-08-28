#!/usr/bin/env node
/**
 * Registers (or renews) the Gmail `watch` that makes Google publish a
 * Pub/Sub notification every time this mailbox's history changes.
 *
 * Prerequisites (see HOW_IT_WORKS.md for the full gcloud walkthrough):
 *   1. A Google Cloud Pub/Sub topic exists, and Gmail's push service
 *      account (gmail-api-push@system.gserviceaccount.com) has been
 *      granted the Pub/Sub Publisher role on it.
 *   2. A push subscription on that topic points at
 *      https://your-deployment/api/gmail/webhook?token=<GMAIL_WEBHOOK_SECRET>
 *   3. You've already run the OAuth flow once (GET /api/gmail/oauth/start
 *      in a browser) so a refresh token is stored in MongoDB.
 *
 * Gmail watches expire after 7 days — re-run this on a schedule (a
 * weekly cron / GitHub Action / cloud scheduler job) or the pipeline
 * silently goes quiet.
 *
 * Usage:
 *   npm run gmail:watch
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { MONGODB_URI, GMAIL_PUBSUB_TOPIC, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!MONGODB_URI) throw new Error('MONGODB_URI is not set.');
if (!GMAIL_PUBSUB_TOPIC) throw new Error('GMAIL_PUBSUB_TOPIC is not set, e.g. projects/my-project/topics/gmail-inbox');

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();

const tokenDoc = await db.collection('oauth_tokens').findOne({ provider: 'google' });
if (!tokenDoc) throw new Error('No stored Google token — visit /api/gmail/oauth/start first.');

async function accessToken() {
  if (new Date(tokenDoc.expires_at).getTime() - Date.now() > 60_000) return tokenDoc.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenDoc.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

const token = await accessToken();

const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ topicName: GMAIL_PUBSUB_TOPIC, labelIds: ['INBOX'] }),
});
const json = await res.json();
if (!res.ok) throw new Error(`Gmail watch failed: ${JSON.stringify(json)}`);

console.log('Gmail watch registered.');
console.log('  historyId :', json.historyId);
console.log('  expires   :', new Date(Number(json.expiration)).toISOString(), '(re-run this script before then)');

// Seed gmail_sync_state so the webhook has a baseline to diff against
// even before the first push notification arrives.
await db.collection('gmail_sync_state').updateOne(
  { provider: 'gmail' },
  { $set: { last_history_id: json.historyId, updated_at: new Date() }, $setOnInsert: { _id: crypto.randomUUID() } },
  { upsert: true },
);

await client.close();
