# How it works

This is the reference implementation behind the dashboard: how a bank
transaction alert email becomes a categorised, amount-tagged row in the
database, with no cron job, no manual entry, and no polling.

## The short version

```
Bank sends an alert email
        │
        ▼
Gmail receives it  ──────────────────────────────────────────────┐
        │                                                          │
        │ (Gmail is watching this mailbox — see step 1)            │
        ▼                                                          │
Google Cloud Pub/Sub gets a "history changed" notification          │
        │                                                          │
        ▼                                                          │
Pub/Sub PUSHes that notification to our webhook, instantly          │
        │                                                          │
        ▼                                                          │
Webhook asks Gmail "what changed since the last id you told me?"    │
        │                                                          │
        ▼                                                          │
New message id(s) → fetch full content → sender allowlist check ────┘
        │ (no match → dropped here, never touches the LLM)
        ▼ (match)
Raw email stored in MongoDB (nothing is lost even if extraction fails)
        │
        ▼
LLM reads the email body → returns one strict JSON object:
  amount, direction, merchant, category, confidence, ...
        │
        ▼
Confidence decides what happens:
  ≥ 0.90 → committed immediately
  0.70–0.89 → committed, flagged needs_review
  < 0.70 → held, never auto-committed
        │
        ▼
Transaction row written to MongoDB → dashboard reads it
```

## 1. Registering the Gmail watch

Gmail won't tell anyone about new mail on its own — you have to ask it
to, via the `users.watch` API call, and that watch **expires after 7
days**. This sample re-registers it with `npm run gmail:watch`
(`scripts/setup-gmail-watch.mjs`), which you'd put on a weekly cron.

`watch` takes one argument that matters: a Pub/Sub topic name. Gmail
publishes to that topic every time something in the mailbox changes.

## 2. Setting up the Google Cloud side

You need a Cloud project with the Gmail API and Pub/Sub API enabled.
Then, roughly:

```bash
# 1. Create the topic Gmail will publish to.
gcloud pubsub topics create gmail-inbox

# 2. Let Gmail's push service account publish to it. This exact
#    service account is fixed by Google — it's the same for everyone.
gcloud pubsub topics add-iam-policy-binding gmail-inbox \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# 3. Create a push subscription pointing at your deployed webhook.
#    The token query param is this sample's auth check — see §5.
gcloud pubsub subscriptions create gmail-inbox-push \
  --topic=gmail-inbox \
  --push-endpoint="https://your-deployment.example.com/api/gmail/webhook?token=YOUR_SECRET"
```

Put the topic's full resource name in `.env.local` as
`GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-inbox`.

**Local development:** Pub/Sub push needs a public HTTPS URL, so
`localhost` won't receive anything directly. Either tunnel it (ngrok,
Cloudflare Tunnel) and point the push subscription at the tunnel URL,
or use a **pull** subscription locally and poll it yourself — the
webhook logic (`app/api/gmail/webhook/route.ts`) is the same either
way, only the delivery mechanism changes.

## 3. What the notification actually contains

Pub/Sub delivers this shape to the webhook:

```json
{
  "message": {
    "data": "<base64 of { emailAddress, historyId }>",
    "messageId": "...",
    "publishTime": "..."
  },
  "subscription": "projects/.../subscriptions/gmail-inbox-push"
}
```

Note what's **not** in there: the email itself, or even which message
changed. `historyId` is just a checkpoint — "the mailbox's change log is
now at this point." To find out what actually happened, the webhook
calls `users.history.list(startHistoryId=<last one we saw>)`
(`lib/gmail-history.ts`), which returns the message ids that were added
since then. That's why the last-seen `historyId` has to be persisted
(`gmail_sync_state` in MongoDB) — without it there's nothing to diff
against.

Gmail only retains about a week of history. If the stored `historyId`
is older than that, `history.list` returns a 404 and the webhook falls
back to just recording the new baseline id rather than crashing.

## 4. The sender allowlist

Once we know a message id, we fetch its full content
(`users.messages.get`) and check the `From` header against
`BANK_SENDER_PATTERNS` — a plain substring match, no regex, no ML:

```ts
function matchesAllowlist(msg, patterns) {
  const sender = msg.sender.toLowerCase();
  return patterns.some((p) => sender.includes(p.toLowerCase()));
}
```

This works because bank alert emails are extremely consistent — the
same sender address/display name and the same subject shape, every
single time. Anything that doesn't match (marketing, OTPs, personal
mail, other banks) is dropped **before** it ever reaches the LLM —
cheap, deterministic, and it means the LLM never sees mail it has no
business reading.

## 5. Authenticating the webhook

Two options, both documented inline in `app/api/gmail/webhook/route.ts`:

- **Shared secret** (what this sample does): the push subscription's
  endpoint URL includes `?token=...`, and the webhook checks it against
  `GMAIL_WEBHOOK_SECRET`. Simple, and enough for a personal project
  behind an unguessable URL — but the token sits in plaintext in your
  Pub/Sub subscription config.
- **OIDC token verification** (recommended if this is public-facing):
  configure the push subscription with a service account, and Pub/Sub
  attaches a signed JWT as the `Authorization` header on every push.
  Verify it against Google's public keys instead of a static secret.
  See [Google's push authentication docs](https://cloud.google.com/pubsub/docs/push#authenticate_push_endpoints).

## 6. Storing the raw email first

Before any LLM call, the full message is upserted into `raw_emails`
with `ingest_status: 'pending'`. This means a crash, an LLM outage, or
a bad extraction never loses the underlying data — you can always
re-run extraction against what's already stored. Every row eventually
lands in one of four states: `parsed`, `discarded` (not a transaction),
`review` (low confidence), or `failed` (the LLM call itself errored).

## 7. What the LLM is asked to do

One system prompt (`lib/email-parser.ts`), one contract: return strict
JSON, one object per email, with these fields —

```
amount, direction ("debit"|"credit"), merchant_clean, suggested_category,
payment_rail, kind, confidence (0–1), is_transaction, occurred_at, ...
```

The rules that matter most:

- **Never guess an amount.** If it's not explicit in the text,
  `is_transaction: false` and the reason goes in `uncertainty_note`.
- **Never invent a date.** A date with no time gets defaulted to noon
  *and* has its confidence capped at 0.85 — a partial guess should never
  score as if it were a certain read.
- Marketing/OTP/statement-ready mail is classified `otp_or_marketing`
  and never becomes a transaction, even if it slipped past the sender
  allowlist somehow.

## 8. Confidence bands — where the human stays in the loop

```
confidence ≥ 0.90    →  committed immediately, no review
0.70 ≤ conf < 0.90    →  committed, but needs_review = true
confidence < 0.70    →  held — never written as a real transaction
```

This is the part that makes an LLM-driven pipeline trustworthy: it's
never a binary "trust the model or don't." A clean, unambiguous
"₹624 debited for Swiggy" reads at ~0.95+ and just shows up. A blurry
scan of a half-truncated email might read at 0.6 and simply waits for a
human glance — it's never silently wrong in the ledger.

## 9. Writing to the database

A matched, sufficiently-confident extraction becomes one document in
`transactions`, keyed by `source_ref: "gmail-<message id>"` so the same
email can never create two rows even if the webhook fires twice for it
(Pub/Sub explicitly does not guarantee exactly-once delivery — dedupe
on your own key, always). The account is matched by name against the
LLM's `account_hint`; no match still commits the transaction, just
flagged `needs_review` so it's easy to find and fix.

## 10. Idempotency and retries

Two places this pipeline has to assume "this might run twice":

- **Pub/Sub push** retries on any non-2xx response, and can also
  redeliver even after a 200 in rare cases. The `source_ref` unique key
  on `transactions` (and the `gmail_id` key on `raw_emails`) absorbs
  that — a duplicate write is a no-op, not a duplicate row.
- **The webhook itself** always returns 200 once it's *handled* the
  notification, even if zero messages matched the allowlist — an empty
  result is not a failure, and Pub/Sub shouldn't keep retrying it.

## Glossary

| Term | Meaning |
|---|---|
| `historyId` | A monotonically increasing checkpoint in a Gmail mailbox's change log. Not a message id. |
| `watch` | The Gmail API call that tells Google "publish history-changed events for this mailbox to this Pub/Sub topic." Expires after 7 days. |
| Push subscription | A Pub/Sub subscription that calls your webhook via HTTP POST, as opposed to a *pull* subscription your code polls. |
| Sender allowlist | The plain substring match against `From` that decides whether an email even reaches the LLM. |
| Confidence band | The three-tier gate (auto-commit / flag / hold) between an LLM's answer and what actually lands in the ledger. |
