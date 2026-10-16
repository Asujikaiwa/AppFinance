/**
 * Backward-compatible shim over the multi-provider `llm.ts` layer.
 *
 * Existing functions still call `callClaude(...)` exactly as before, but now the
 * request is auto-routed:
 *   - any message containing an image  → 'vision' tier (default Claude Sonnet)
 *   - text-only requests               → 'text' tier   (default Claude Haiku)
 *
 * To override the model/provider per tier, set the LLM_* env vars (see
 * docs/ai-providers.md). For explicit control, import `complete` from llm.ts.
 */
import {
  complete,
  extractJSON,
  type LLMContentBlock,
  type LLMMessage,
} from './llm.ts';

export { extractJSON };

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ClaudeRequest {
  model?: string; // ignored — tier routing decides the model now
  system?: string;
  messages: ClaudeMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ClaudeResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

function hasImage(messages: ClaudeMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image'),
  );
}

/** Convert legacy Claude-format messages to the unified LLM format. */
function toLLMMessages(messages: ClaudeMessage[]): LLMMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : (m.content.map((b) =>
            b.type === 'text'
              ? { type: 'text', text: b.text }
              : {
                  type: 'image',
                  mediaType: b.source.media_type,
                  base64: b.source.data,
                },
          ) as LLMContentBlock[]),
  }));
}

export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const task = hasImage(req.messages) ? 'vision' : 'text';
  const result = await complete({
    task,
    ...(req.system !== undefined ? { system: req.system } : {}),
    messages: toLLMMessages(req.messages),
    ...(req.max_tokens !== undefined ? { maxTokens: req.max_tokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
  return {
    content: [{ type: 'text', text: result.text }],
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    },
  };
}
