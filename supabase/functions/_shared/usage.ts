/**
 * AI usage logging + monthly quota enforcement.
 *
 * Cost is estimated in *satang* from token counts. Numbers are approximate —
 * update COST_PER_MTOK with current vendor pricing. Local/self-hosted models
 * (anything not in the table) are treated as zero marginal cost.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CompleteResult, TaskTier } from './llm.ts';

/** Satang per 1,000,000 tokens. ~35 THB/USD assumed. Update as prices change. */
const COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Claude (≈ $3 / $15 Sonnet, $0.80 / $4 Haiku)
  'claude-sonnet-4-6': { input: 10_500, output: 52_500 },
  'claude-haiku-4-5-20251001': { input: 2_800, output: 14_000 },
  // add OpenAI / Typhoon models here when used on paid endpoints
};

export function estimateCostSatang(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const c = COST_PER_MTOK[model] ?? { input: 0, output: 0 }; // local/unknown = free
  return Math.round(
    (usage.inputTokens / 1_000_000) * c.input +
      (usage.outputTokens / 1_000_000) * c.output,
  );
}

/** Monthly quota per plan, in satang. */
export const PLAN_LIMITS: Record<string, number> = {
  free: 5_000, // ฿50 / month of AI
  pro: 200_000, // ฿2,000 / month
  unlimited: Number.POSITIVE_INFINITY,
};

export class QuotaExceededError extends Error {
  constructor(public used: number, public limit: number) {
    super(
      `QUOTA_EXCEEDED: ใช้ AI ครบโควต้าเดือนนี้แล้ว (${(used / 100).toFixed(0)}/${(
        limit / 100
      ).toFixed(0)} บาท) — อัปเกรดแพ็กเกจหรือรอเดือนถัดไป`,
    );
    this.name = 'QuotaExceededError';
  }
}

/**
 * Per-minute burst limit (migration 0012). Shares the QUOTA_EXCEEDED prefix so
 * every caller already maps it to HTTP 429 / a friendly LINE reply.
 */
export class RateLimitedError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED: ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
    this.name = 'RateLimitedError';
  }
}

function monthStartISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Sum this calendar month's estimated AI cost for a workspace (satang). */
export async function monthlyCostSatang(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data } = await client
    .from('ai_usage')
    .select('estimated_cost_satang')
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStartISO());
  return (data ?? []).reduce((s, r) => s + (r.estimated_cost_satang ?? 0), 0);
}

/**
 * Throw RateLimitedError if the workspace is over its per-minute call limit, or
 * QuotaExceededError if it is over its monthly AI budget.
 * Call BEFORE making an AI request. Skips the check for the 'unlimited' plan.
 */
export async function enforceQuota(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { data: allowed, error: rlErr } = await client.rpc('consume_ai_rate_limit', {
    p_workspace: workspaceId,
  });
  if (rlErr) throw new Error(`rate limit check failed: ${rlErr.message}`);
  if (allowed === false) throw new RateLimitedError();

  const { data: ws } = await client
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .maybeSingle();
  const limit = PLAN_LIMITS[ws?.plan ?? 'free'] ?? PLAN_LIMITS.free;
  if (!Number.isFinite(limit)) return;

  const used = await monthlyCostSatang(client, workspaceId);
  if (used >= limit) throw new QuotaExceededError(used, limit);
}

/** Record a completed AI call. Best-effort — never throws. */
export async function logUsage(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    fn: string;
    tier: TaskTier;
    result: CompleteResult;
    createdBy?: string;
  },
): Promise<void> {
  try {
    const cost = estimateCostSatang(params.result.model, params.result.usage);
    await client.from('ai_usage').insert({
      workspace_id: params.workspaceId,
      fn: params.fn,
      task_tier: params.tier,
      provider: params.result.provider,
      model: params.result.model,
      input_tokens: params.result.usage.inputTokens,
      output_tokens: params.result.usage.outputTokens,
      estimated_cost_satang: cost,
      created_by: params.createdBy ?? null,
    });
  } catch (e) {
    console.error('logUsage failed (non-fatal)', e);
  }
}
