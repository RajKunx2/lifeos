/**
 * LLM client — plain fetch against an Azure OpenAI chat-completions
 * deployment. Swap the URL/headers in `complete()` for plain OpenAI,
 * Anthropic, or a local model — the rest of the pipeline only depends
 * on `complete()` returning a JSON string.
 *
 * Every call is logged to llm_calls with token counts, and a monthly
 * spend cap is enforced before the request goes out, not after the
 * bill arrives.
 */
import { col, C } from './db';

const ENDPOINT = () => (process.env.AZURE_OPENAI_ENDPOINT ?? '').replace(/\/$/, '');
const KEY = () => process.env.AZURE_OPENAI_API_KEY ?? '';
const DEPLOYMENT = () => process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
const VERSION = () => process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview';

/** gpt-4o-mini list price, paise per token — update if the deployment changes. */
const IN_PAISE_PER_TOKEN = 0.00125;
const OUT_PAISE_PER_TOKEN = 0.005;

export function llmConfigured(): boolean {
  return !!(ENDPOINT() && KEY());
}

async function monthSpendPaise(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const c = await col<any>(C.llmCalls);
  const rows = await c.find({ created_at: { $gte: start } }).toArray();
  return rows.reduce((s, r) => s + (r.cost_paise ?? 0), 0);
}

export async function complete(opts: {
  purpose: string;
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!llmConfigured()) {
    return { ok: false, text: '', error: 'LLM is not configured — set AZURE_OPENAI_* in .env.local.' };
  }

  const capInr = Number(process.env.LLM_MONTHLY_CAP_INR ?? 500);
  const spent = await monthSpendPaise();
  if (capInr > 0 && spent >= capInr * 100) {
    return { ok: false, text: '', error: `Monthly LLM cap of ₹${capInr} reached.` };
  }

  const url = `${ENDPOINT()}/openai/deployments/${DEPLOYMENT()}/chat/completions?api-version=${VERSION()}`;
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': KEY(), 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 1200,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    const latency = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      await logCall(opts.purpose, 0, 0, latency, false, `${res.status} ${body.slice(0, 300)}`);
      return { ok: false, text: '', error: `LLM endpoint returned ${res.status}.` };
    }

    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? '';
    const pt = Number(json?.usage?.prompt_tokens ?? 0);
    const ct = Number(json?.usage?.completion_tokens ?? 0);
    await logCall(opts.purpose, pt, ct, latency, true, null);
    return { ok: true, text };
  } catch (e: any) {
    await logCall(opts.purpose, 0, 0, Date.now() - started, false, String(e?.message ?? e));
    return { ok: false, text: '', error: 'Could not reach the LLM endpoint.' };
  }
}

async function logCall(purpose: string, pt: number, ct: number, latency: number, ok: boolean, error: string | null) {
  const cost = Math.round(pt * IN_PAISE_PER_TOKEN + ct * OUT_PAISE_PER_TOKEN);
  const c = await col<any>(C.llmCalls);
  await c.insertOne({
    _id: crypto.randomUUID(), purpose, model: DEPLOYMENT(),
    prompt_tokens: pt, completion_tokens: ct, cost_paise: cost,
    latency_ms: latency, ok, error, created_at: new Date(),
  }).catch(() => { /* never let telemetry break the caller */ });
}
