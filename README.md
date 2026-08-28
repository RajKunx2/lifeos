# Expense Tracker — Showcase

A self-contained sample of two things:

1. **The dashboard** — an "every rupee in one place" view: accounts, a
   recent-expenses table, and monthly budgets. Runs on static sample
   data, so `npm install && npm run dev` is the whole setup — no API
   keys, no database.
2. **The ingestion pipeline** — the reference implementation of how a
   bank transaction email turns into a row in the dashboard, fully
   automatically: Gmail → Google Cloud Pub/Sub → sender allowlist → LLM
   extraction → MongoDB. This part is real, working code, but it needs
   your own Google Cloud project, Gmail account, and LLM key to actually
   run — see [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for the full setup.

No real account data, credentials, or personal information is in this
repo. Everything in `lib/sample-data.ts` is made up.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:4100
```

That's it for the dashboard. Nothing under `.env.example` is required
unless you want to wire up the live pipeline.

## What's in here

```
app/
  page.tsx                     the dashboard (reads lib/sample-data.ts)
  api/gmail/
    webhook/route.ts           Pub/Sub push receiver — the "how we scan email" core
    sync/route.ts              on-demand fallback (no Pub/Sub required)
    oauth/start, oauth/callback  Gmail OAuth handshake
lib/
  sample-data.ts                static demo data — the ONLY thing app/page.tsx reads
  db.ts                         MongoDB access (pipeline only)
  google-oauth.ts               Gmail OAuth token exchange + refresh
  gmail.ts                      fetch a message's full content by id
  gmail-history.ts              Pub/Sub-driven "what changed?" lookup
  llm.ts                        LLM client + spend cap + call logging
  email-parser.ts               the extraction + confidence-gating logic
scripts/
  setup-gmail-watch.mjs         one-time (well, weekly) Gmail watch registration
```

## Why two halves that don't talk to each other

The dashboard and the pipeline share a data *shape* (accounts,
transactions, categories) but the dashboard doesn't read from Mongo in
this sample — it reads a static file. That's deliberate: the point of
this repo is to be readable and runnable without anyone having to hand
you a database or API keys just to see what it looks like. If you want
to point the dashboard at real data, swap `lib/sample-data.ts` for
queries against the collections the pipeline writes to (`transactions`,
`accounts`) — the shapes already line up.

## License

MIT — do whatever you like with it.
