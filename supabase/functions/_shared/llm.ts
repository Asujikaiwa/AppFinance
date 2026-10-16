/**
 * Multi-provider LLM layer.
 *
 * One `complete()` call routes to the right provider+model based on the *task tier*:
 *   - 'text'   → cheap/fast model (categorize, parse a chat line). Default: Claude Haiku.
 *   - 'reason' → stronger model (tax advice). Default: Claude Sonnet.
 *   - 'vision' → image-capable model (OCR receipts). Default: Claude Sonnet.
 *
 * Each tier is configured independently by env, so you can point 'text' at a local
 * Ollama model (free) while keeping 'vision' on Claude (accurate), etc.
 *
 * Supported providers:
 *   - 'anthropic'  → api.anthropic.com  (Claude)
 *   - 'openai'     → any OpenAI-compatible /chat/completions endpoint:
 *                    Ollama (local), Typhoon, GitHub Models, OpenAI, vLLM, LM Studio
 *
 * See docs/ai-providers.md.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export type TaskTier = 'text' | 'reason' | 'vision';
export type Provider = 'anthropic' | 'openai';

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64: string }
  | { type: 'document'; mediaType: string; base64: string }; // PDF (Claude native)

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

export interface CompleteOptions {
  task: TaskTier;
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  provider: Provider;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

interface ProviderConfig {
  provider: Provider;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

const DEFAULTS: Record<TaskTier, { model: string }> = {
  text: { model: 'claude-haiku-4-5-20251001' },
  reason: { model: 'claude-sonnet-4-6' },
  vision: { model: 'claude-sonnet-4-6' },
};

/** Resolve provider config for a tier from env, with safe Anthropic defaults. */
function resolveConfig(task: TaskTier): ProviderConfig {
  const prefix = `LLM_${task.toUpperCase()}`; // LLM_TEXT / LLM_REASON / LLM_VISION
  const provider = (Deno.env.get(`${prefix}_PROVIDER`) ?? 'anthropic') as Provider;
  const model = Deno.env.get(`${prefix}_MODEL`) ?? DEFAULTS[task].model;
  const baseUrl = Deno.env.get(`${prefix}_BASE_URL`) ?? undefined;

  // API key resolution: tier-specific key, else provider-wide fallback.
  const tierKey = Deno.env.get(`${prefix}_API_KEY`);
  const apiKey =
    tierKey ??
    (provider === 'anthropic'
      ? (Deno.env.get('ANTHROPIC_API_KEY') ?? '')
      : (Deno.env.get('OPENAI_API_KEY') ?? 'ollama')); // Ollama ignores the key

  return { provider, model, ...(baseUrl ? { baseUrl } : {}), apiKey };
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const cfg = resolveConfig(opts.task);
  if (cfg.provider === 'anthropic') return callAnthropic(cfg, opts);
  return callOpenAICompatible(cfg, opts);
}

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------
async function callAnthropic(
  cfg: ProviderConfig,
  opts: CompleteOptions,
): Promise<CompleteResult> {
  if (!cfg.apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const messages = opts.messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => {
            if (b.type === 'text') return { type: 'text', text: b.text };
            if (b.type === 'document') {
              return {
                type: 'document',
                source: { type: 'base64', media_type: b.mediaType, data: b.base64 },
              };
            }
            return {
              type: 'image',
              source: { type: 'base64', media_type: b.mediaType, data: b.base64 },
            };
          }),
  }));

  const res = await fetch(cfg.baseUrl ?? ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: cfg.model,
      system: opts.system,
      messages,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  return {
    text,
    provider: 'anthropic',
    model: cfg.model,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter (Ollama / Typhoon / GitHub Models / OpenAI / vLLM)
// ---------------------------------------------------------------------------
async function callOpenAICompatible(
  cfg: ProviderConfig,
  opts: CompleteOptions,
): Promise<CompleteResult> {
  if (!cfg.baseUrl) {
    throw new Error(
      `LLM_${opts.task.toUpperCase()}_BASE_URL required for openai provider ` +
        `(e.g. http://host.docker.internal:11434/v1 for Ollama, ` +
        `https://api.opentyphoon.ai/v1 for Typhoon)`,
    );
  }

  // Translate to OpenAI chat format. System becomes the first message.
  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });

  for (const m of opts.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
    } else {
      messages.push({
        role: m.role,
        content: m.content.map((b) => {
          if (b.type === 'text') return { type: 'text', text: b.text };
          if (b.type === 'document') {
            throw new Error(
              'PDF documents are only supported on the anthropic provider; ' +
                'route the vision tier to Claude or rasterize the PDF first.',
            );
          }
          return {
            type: 'image_url',
            image_url: { url: `data:${b.mediaType};base64,${b.base64}` },
          };
        }),
      });
    }
  }

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    }),
  });
  if (!res.ok) throw new Error(`LLM(${cfg.model}) ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    provider: 'openai',
    model: cfg.model,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON extraction (shared by all extractors)
// ---------------------------------------------------------------------------
export function extractJSON<T = unknown>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return JSON.parse(fenced[1]) as T;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
  throw new Error('Could not extract JSON from LLM response');
}
