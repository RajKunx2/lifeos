/**
 * Email → transaction pipeline.
 *
 * Raw email in, structured transaction out, nothing silently dropped:
 * every message lands in raw_emails first, and every extraction attempt
 * is recorded there whether or not it produced a transaction.
 *
 * Confidence bands:
 *   >= 0.90        auto-commit
 *   0.70 – 0.89    commit, needs_review = true
 *   <  0.70        held — never committed, sits in a review queue
 */
import { col, C } from './db';
import { complete, llmConfigured } from './llm';
import type { RawGmailMessage } from './gmail';

interface ExtractedRow {
  gmail_id: string;
  is_transaction: boolean;
  kind: string;
  direction: 'debit' | 'credit' | null;
  amount: number | null;
  currency: string;
  occurred_at: string | null;
  account_hint: string | null;
  merchant_raw: string | null;
  merchant_clean: string | null;
  payment_rail: string | null;
  suggested_category: string | null;
  confidence: number;
  uncertainty_note: string | null;
}

const SYSTEM_PROMPT = `You extract structured transaction data from Indian bank alert emails. Return ONLY JSON, no prose, no code fences: {"results":[{...one object per email, same order...}]}.

Each object has exactly these fields:
  gmail_id, is_transaction (bool), kind, direction ("debit"|"credit"|null),
  amount (number, rupees, or null), currency ("INR"), occurred_at (ISO 8601 with +05:30 offset, or null),
  account_hint (bank/card name mentioned, or null),
  merchant_raw (as it literally appears), merchant_clean (normalised, e.g. "Swiggy"),
  payment_rail ("card"|"upi"|"neft_imps"|"atm"|"emi"|null),
  suggested_category (one of: Food, Transport, Shopping, Health, Utilities, Housing, Entertainment,
    Fitness, Donation, Fees & Charges, Income, Transfer, Uncategorised),
  confidence (0 to 1), uncertainty_note (string or null).

kind is one of: card_spend, upi_debit, upi_credit, neft_imps, atm, emi_debit, refund, salary_credit,
statement_summary, otp_or_marketing, unknown.

Rules:
1. Never guess an amount. If it is not explicit in the text, set is_transaction=false and explain why in uncertainty_note.
2. Never invent a date. If only a date with no time is given, use 12:00 and cap confidence at 0.85.
3. OTP mails, marketing mails, and "statement is ready" notifications are not transactions — classify as otp_or_marketing and set is_transaction=false.
4. Refunds are direction="credit".`;

export interface SyncResult {
  fetched: number;
  autoCommitted: number;
  flaggedForReview: number;
  held: number;
  discarded: number;
  error?: string;
}

export async function parseAndStoreEmails(messages: RawGmailMessage[]): Promise<SyncResult> {
  const result: SyncResult = { fetched: messages.length, autoCommitted: 0, flaggedForReview: 0, held: 0, discarded: 0 };
  if (!messages.length) return result;

  const rawCol = await col<any>(C.rawEmails);
  const txnCol = await col<any>(C.transactions);
  const accCol = await col<any>(C.accounts);

  // Store raw first — nothing is ever lost even if extraction fails downstream.
  const toExtract: RawGmailMessage[] = [];
  for (const m of messages) {
    const existing = await rawCol.findOne({ gmail_id: m.gmailId });
    if (existing?.ingest_status === 'parsed') continue;

    await rawCol.updateOne(
      { gmail_id: m.gmailId },
      {
        $set: {
          thread_id: m.threadId, sender: m.sender, subject: m.subject, received_at: m.receivedAt,
          body_text: m.bodyText, snippet: m.snippet, ingest_status: 'pending', updated_at: new Date(),
        },
        $setOnInsert: { _id: crypto.randomUUID(), attempts: 0, created_at: new Date() },
      },
      { upsert: true },
    );
    toExtract.push(m);
  }
  if (!toExtract.length) return result;

  if (!llmConfigured()) {
    result.error = 'LLM is not configured — emails are stored but not yet parsed.';
    return result;
  }

  // Batched 20 at a time to keep extraction cost trivial.
  for (let i = 0; i < toExtract.length; i += 20) {
    const batch = toExtract.slice(i, i + 20);
    const payload = batch.map((m) => ({
      gmail_id: m.gmailId, sender: m.sender, subject: m.subject,
      received_at: m.receivedAt.toISOString(), body: m.bodyText.slice(0, 3000),
    }));

    const r = await complete({
      purpose: 'email_extract', json: true,
      system: SYSTEM_PROMPT, user: JSON.stringify({ emails: payload }), maxTokens: 4000,
    });

    if (!r.ok) {
      result.error = r.error;
      for (const m of batch) {
        await rawCol.updateOne({ gmail_id: m.gmailId }, {
          $set: { ingest_status: 'failed', error: r.error, processed_at: new Date() }, $inc: { attempts: 1 },
        });
      }
      continue;
    }

    let rows: ExtractedRow[];
    try { rows = JSON.parse(r.text).results ?? []; }
    catch { result.error = 'LLM returned unparseable JSON.'; continue; }

    for (const row of rows) {
      const email = batch.find((m) => m.gmailId === row.gmail_id);
      if (!email) continue;

      if (!row.is_transaction || row.kind === 'otp_or_marketing' || row.amount === null) {
        await rawCol.updateOne({ gmail_id: row.gmail_id }, {
          $set: { ingest_status: 'discarded', extraction_json: row, processed_at: new Date() },
        });
        result.discarded++;
        continue;
      }

      if (row.confidence < 0.70) {
        await rawCol.updateOne({ gmail_id: row.gmail_id }, {
          $set: { ingest_status: 'review', extraction_json: row, processed_at: new Date() },
        });
        result.held++;
        continue;
      }

      const account = await accCol.findOne({ name: new RegExp(row.account_hint ?? '', 'i') });
      const needsReview = row.confidence < 0.90;

      const txnDoc = {
        account_id: account?._id ?? null,
        occurred_at: row.occurred_at ? new Date(row.occurred_at) : email.receivedAt,
        amount_paise: Math.round(row.amount! * 100),
        direction: row.direction ?? 'debit',
        merchant_raw: row.merchant_raw, merchant_clean: row.merchant_clean,
        category: row.suggested_category ?? 'Uncategorised',
        source: 'email', source_ref: `gmail-${row.gmail_id}`,
        confidence: row.confidence, needs_review: needsReview || !account,
        updated_at: new Date(),
      };

      try {
        await txnCol.updateOne(
          { source_ref: txnDoc.source_ref },
          { $setOnInsert: { _id: crypto.randomUUID(), created_at: new Date() }, $set: txnDoc },
          { upsert: true },
        );
        needsReview ? result.flaggedForReview++ : result.autoCommitted++;
      } catch {
        // Unique-index collision — the dedupe already caught this one.
      }

      await rawCol.updateOne({ gmail_id: row.gmail_id }, {
        $set: { ingest_status: 'parsed', extraction_json: row, processed_at: new Date() },
      });
    }
  }

  return result;
}
