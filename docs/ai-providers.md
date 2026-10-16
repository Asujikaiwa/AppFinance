# AI Providers — multi-provider, hybrid routing, local models

AppFinance does not hard-code one AI vendor. Every AI call goes through one
function — `complete()` in [`supabase/functions/_shared/llm.ts`](../supabase/functions/_shared/llm.ts) —
which routes to a provider+model based on the **task tier**.

## The three task tiers

| Tier | Used for | Why | Default model |
|---|---|---|---|
| `text` | parse a chat line, categorize | cheap, high volume | Claude Haiku |
| `reason` | tax advice (tax-advisor) | quality of reasoning matters | Claude Sonnet |
| `vision` | OCR receipt images | accuracy on Thai text/numbers | Claude Sonnet |

Each tier is configured **independently** by env vars, so you can mix providers —
e.g. run `text` on a free local model while keeping `vision` on Claude for accuracy.

## How routing happens

- `tax-advisor` calls `complete({ task: 'reason' })` directly.
- Everything else calls the legacy `callClaude(...)`, which is now a thin shim:
  it inspects the messages and picks `vision` if any image is present, otherwise
  `text`. So **all existing functions got hybrid routing with zero changes.**

```
chat-log (text)      ─┐
categorize (text)    ─┼─► callClaude() ─► auto-detect ─► text tier  (Haiku/local)
line-webhook text    ─┘
ocr-receipt (image)  ─┐
line-webhook image   ─┼─► callClaude() ─► auto-detect ─► vision tier (Sonnet)
email attachments    ─┘
tax-advisor          ───► complete({task:'reason'}) ───► reason tier (Sonnet)
```

## Supported providers

| `*_PROVIDER` | Endpoint | Examples |
|---|---|---|
| `anthropic` | api.anthropic.com | Claude Haiku / Sonnet |
| `openai` | any OpenAI-compatible `/chat/completions` | **Ollama** (local), **Typhoon**, **GitHub Models**, OpenAI, vLLM, LM Studio |

The `openai` provider is the universal adapter — almost every model server speaks the
OpenAI chat-completions format today.

## Configuration

Set these per tier (`TEXT`, `REASON`, `VISION`). Unset = Anthropic defaults.

```
LLM_<TIER>_PROVIDER=anthropic|openai
LLM_<TIER>_MODEL=<model-name>
LLM_<TIER>_BASE_URL=<required for openai provider>
LLM_<TIER>_API_KEY=<tier key; falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY>
```

### Recipe A — all Claude (default, works immediately)
Just set `ANTHROPIC_API_KEY`. Text uses Haiku, vision/reason use Sonnet.

### Recipe B — hybrid: free local text + accurate cloud vision (recommended for cost)
```
LLM_TEXT_PROVIDER=openai
LLM_TEXT_MODEL=qwen2.5:7b
LLM_TEXT_BASE_URL=http://host.docker.internal:11434/v1
LLM_TEXT_API_KEY=ollama
# vision stays on Claude (default) for receipt accuracy
```

### Recipe C — Thai model (Typhoon by SCB 10X)
```
LLM_TEXT_PROVIDER=openai
LLM_TEXT_MODEL=typhoon-v2-8b-instruct
LLM_TEXT_BASE_URL=https://api.opentyphoon.ai/v1
LLM_TEXT_API_KEY=sk-typhoon-...
```

---

## Running a local model with Ollama

Great for **development, privacy, and offloading cheap text tasks**. Not a fit for
serving production traffic from a laptop (see caveats).

### 1. Install + pull a model
```bash
# macOS/Linux/Windows: https://ollama.com/download
ollama pull qwen2.5:7b          # solid general/Thai-capable text model (~5GB)
# vision option (heavier, for OCR experiments):
ollama pull qwen2.5vl:7b
```

### 2. Ollama serves an OpenAI-compatible API on :11434
```bash
ollama serve                    # usually already running as a service
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"สวัสดี"}]}'
```

### 3. Point the `text` tier at it
When edge functions run **inside Docker** (`supabase functions serve`), `localhost`
is the container, not your host. Use `host.docker.internal`:
```
LLM_TEXT_PROVIDER=openai
LLM_TEXT_MODEL=qwen2.5:7b
LLM_TEXT_BASE_URL=http://host.docker.internal:11434/v1
LLM_TEXT_API_KEY=ollama
```
Restart `pnpm fn:serve` and the chat-logging / categorize paths now run locally — free.

### 4. (Optional) local vision for OCR
```
LLM_VISION_PROVIDER=openai
LLM_VISION_MODEL=qwen2.5vl:7b
LLM_VISION_BASE_URL=http://host.docker.internal:11434/v1
LLM_VISION_API_KEY=ollama
```
Test the accuracy on real Thai receipts before trusting it — open vision models trail
Claude/GPT on Thai text and small fonts. Keeping `vision` on Claude is usually worth it.

---

## Caveats for production

- **Laptop ≠ server.** A model on your machine can't serve users' phones. For a hosted
  "local" model you must rent a GPU box (RunPod, Vast.ai, AWS) and run Ollama/vLLM there.
- **Cost shape flips.** API = pay-per-token (cheap at low volume). Self-host = fixed
  monthly GPU cost (cheap only at high volume). Break-even is typically thousands of
  active users.
- **OCR accuracy is the constraint.** Misreading a receipt amount in a tax app is
  costly. Favor a strong vision model; route only text tasks to cheap/local models.
- **Privacy upside.** Self-hosting keeps financial data on your own infra — a real
  selling point for enterprise / accounting-firm customers and PDPA compliance.

## Cost rule of thumb (per action, very rough)

| Action | Tier | Claude est. |
|---|---|---|
| Parse a chat line | text (Haiku) | < ฿0.05 |
| Categorize an entry (keyword hit) | — | ฿0 (no AI) |
| Categorize an entry (AI fallback) | text (Haiku) | < ฿0.05 |
| OCR a receipt image | vision (Sonnet) | ฿0.30–0.40 |
| Tax advice answer | reason (Sonnet) | ฿0.20–0.60 |

## Cost controls built in

**1. Heuristic-first (free).** `_shared/heuristic.ts` matches common vendors by
keyword ("ปตท." → fuel). The `categorize` function tries it **before** any AI call and
returns `usedAI: false` on a hit. The extraction hub also uses it to fill an empty
category without a second call.

**2. Usage logging.** Every AI call is recorded in `ai_usage` (tokens + estimated
satang cost) by `logUsage()` in `_shared/usage.ts`. Query `ai_usage_month` view for a
per-workspace monthly rollup.

**3. Monthly quota / freemium.** `enforceQuota()` runs before each AI call and throws
`QUOTA_EXCEEDED` (HTTP 429, friendly Thai message in LINE) when a workspace passes its
`PLAN_LIMITS` budget. Plans live on `workspaces.plan` (`free` ฿50 / `pro` ฿2,000 /
`unlimited`). Local/self-hosted models estimate as ฿0, so routing `text` to Ollama
effectively doesn't consume quota.

> All AI flows pass through `_shared/extract.ts` (chat-log, ocr-receipt, line-webhook,
> email-inbound) or call `complete()` directly (categorize, tax-advisor), so quota +
> logging + heuristic apply uniformly across every channel.
