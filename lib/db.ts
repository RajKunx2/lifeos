/**
 * MongoDB access for the ingestion pipeline.
 *
 * The dashboard (app/page.tsx) does NOT use this — it reads static data
 * from lib/sample-data.ts so the repo runs with zero configuration. This
 * file is only exercised by the Gmail webhook / sync route, i.e. once
 * you've supplied your own MONGODB_URI, Google OAuth credentials, and an
 * LLM key. See HOW_IT_WORKS.md.
 *
 * IDs are app-generated UUID strings stored as `_id`, not ObjectId.
 * Money is always integer paise. Date-only values ('as_of', 'occurred_at'
 * date part) are 'YYYY-MM-DD' strings so they sort lexicographically.
 */
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __showcase_mongo: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is not set — copy .env.example to .env.local and fill it in.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, retryWrites: true });
  return client.connect();
}

/** Cached across hot reloads so a dev server restart doesn't leak connections. */
export function getClient(): Promise<MongoClient> {
  if (!global.__showcase_mongo) global.__showcase_mongo = connect();
  return global.__showcase_mongo;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db();
}

export async function col<T extends Document = Document>(name: string): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

/** Collection names used by the pipeline. */
export const C = {
  oauthTokens: 'oauth_tokens',
  gmailSync: 'gmail_sync_state',   // one doc: { provider: 'gmail', last_history_id }
  rawEmails: 'raw_emails',
  transactions: 'transactions',
  accounts: 'accounts',
  llmCalls: 'llm_calls',
};

export function newId(): string {
  return crypto.randomUUID();
}
