/**
 * POST /functions/v1/categorize
 * Body: { workspaceId, entryId }
 *
 * Re-categorizes an existing entry. Tries the free keyword heuristic FIRST and
 * only calls the AI when no keyword matches — saving tokens on common vendors.
 */
import { complete, extractJSON } from '../_shared/llm.ts';
import { getUserClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import { CATEGORIZE_SYSTEM } from '../_shared/prompts.ts';
import { heuristicCategorize } from '../_shared/heuristic.ts';
import { enforceQuota, logUsage } from '../_shared/usage.ts';

interface RequestBody {
  workspaceId: string;
  entryId: string;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as RequestBody;
    const supabase = getUserClient(req);

    const { data: entry, error: entErr } = await supabase
      .from('entries')
      .select('*')
      .eq('id', body.entryId)
      .single();
    if (entErr || !entry) return errorResponse('Entry not found', 404);

    // ---- 1. Heuristic first (free, no AI) ----
    const guess = heuristicCategorize(entry.description, entry.counterparty_name);
    if (guess) {
      const updated = await applyCategory(supabase, body, guess.code, guess.confidence);
      if (updated) {
        return json({
          entry: updated,
          reasoning: `จับคู่จากคำว่า "${guess.matchedKeyword}" (heuristic, ไม่ใช้ AI)`,
          usedAI: false,
        });
      }
    }

    // ---- 2. AI fallback ----
    await enforceQuota(supabase, body.workspaceId);

    const { data: cats } = await supabase
      .from('categories')
      .select('code, name_th, name_en, direction, deductible')
      .eq('workspace_id', body.workspaceId);

    const catalog = (cats ?? [])
      .filter((c) => c.direction === entry.direction)
      .map((c) => `  ${c.code} — ${c.name_th} (${c.deductible ? 'หักได้' : 'หักไม่ได้'})`)
      .join('\n');

    const res = await complete({
      task: 'text',
      system: CATEGORIZE_SYSTEM,
      maxTokens: 256,
      messages: [
        {
          role: 'user',
          content: `รายการ:
- ทิศทาง: ${entry.direction}
- คู่ค้า: ${entry.counterparty_name ?? 'ไม่ระบุ'}
- คำอธิบาย: ${entry.description}
- ยอด (excl VAT): ${entry.amount_excl_vat / 100} บาท

หมวดที่เลือกได้:
${catalog}

จัดหมวด ตอบเป็น JSON`,
        },
      ],
    });
    await logUsage(supabase, {
      workspaceId: body.workspaceId,
      fn: 'categorize',
      tier: 'text',
      result: res,
    });

    const result = extractJSON<{
      categoryCode: string;
      confidence: number;
      reasoning: string;
    }>(res.text || '{}');

    const updated = await applyCategory(
      supabase,
      body,
      result.categoryCode,
      result.confidence,
    );
    if (!updated) return errorResponse('Suggested category code not found', 400, result);

    return json({ entry: updated, reasoning: result.reasoning, usedAI: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('QUOTA_EXCEEDED') ? 429 : 500;
    return errorResponse(msg, status);
  }
});

async function applyCategory(
  supabase: ReturnType<typeof getUserClient>,
  body: RequestBody,
  code: string,
  confidence: number,
) {
  const { data: cat } = await supabase
    .from('categories')
    .select('id')
    .eq('workspace_id', body.workspaceId)
    .eq('code', code)
    .maybeSingle();
  if (!cat) return null;

  const { data: updated } = await supabase
    .from('entries')
    .update({ category_id: cat.id, ai_confidence: confidence })
    .eq('id', body.entryId)
    .select()
    .single();
  return updated;
}
