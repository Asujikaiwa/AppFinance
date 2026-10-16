/**
 * POST /functions/v1/tax-advisor
 * Body: { workspaceId, question, year? }
 *
 * Loads the year-to-date totals from the workspace and asks Claude to answer
 * a tax question grounded in those real numbers.
 */
import { complete } from '../_shared/llm.ts';
import { enforceQuota, logUsage } from '../_shared/usage.ts';
import { getUserClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import { TAX_ADVISOR_SYSTEM } from '../_shared/prompts.ts';

interface RequestBody {
  workspaceId: string;
  question: string;
  year?: number;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as RequestBody;
    const supabase = getUserClient(req);

    await enforceQuota(supabase, body.workspaceId);

    const year = body.year ?? new Date().getFullYear();
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Pull workspace info
    const { data: ws } = await supabase
      .from('workspaces')
      .select('name, kind, vat_registered, fiscal_year_start')
      .eq('id', body.workspaceId)
      .single();

    // Pull entries aggregated by category
    const { data: entries } = await supabase
      .from('entries')
      .select(`
        direction, amount_excl_vat, vat_amount, wht_amount,
        entry_date, status,
        categories ( code, name_th, deductible )
      `)
      .eq('workspace_id', body.workspaceId)
      .gte('entry_date', yearStart)
      .lte('entry_date', yearEnd)
      .neq('status', 'draft');

    // Roll up totals (in baht for readability)
    type Bucket = { excl: number; vat: number; wht: number; count: number };
    const byCategory = new Map<string, Bucket>();
    let totalIncome = 0;
    let totalExpenseDeductible = 0;
    let totalExpenseNonDeductible = 0;
    let totalOutputVat = 0;
    let totalInputVat = 0;
    let totalWht = 0;

    for (const e of entries ?? []) {
      const cat = (e.categories as { code?: string; name_th?: string; deductible?: boolean } | null) ?? {};
      const key = `${cat.code ?? '----'} ${cat.name_th ?? 'ไม่ระบุหมวด'}`;
      const b = byCategory.get(key) ?? { excl: 0, vat: 0, wht: 0, count: 0 };
      b.excl += e.amount_excl_vat / 100;
      b.vat += e.vat_amount / 100;
      b.wht += e.wht_amount / 100;
      b.count += 1;
      byCategory.set(key, b);

      if (e.direction === 'income') {
        totalIncome += e.amount_excl_vat / 100;
        totalOutputVat += e.vat_amount / 100;
      } else {
        if (cat.deductible) totalExpenseDeductible += e.amount_excl_vat / 100;
        else totalExpenseNonDeductible += e.amount_excl_vat / 100;
        totalInputVat += e.vat_amount / 100;
        totalWht += e.wht_amount / 100;
      }
    }

    const summary = {
      workspace: ws,
      year,
      totals: {
        income: totalIncome,
        expense_deductible: totalExpenseDeductible,
        expense_nondeductible: totalExpenseNonDeductible,
        output_vat: totalOutputVat,
        input_vat: totalInputVat,
        wht_remitted: totalWht,
        net_profit_estimate:
          totalIncome - totalExpenseDeductible, // rough — pre-tax basis
      },
      by_category: Array.from(byCategory.entries()).map(([k, v]) => ({ category: k, ...v })),
    };

    const context = `## บริบทบัญชี (ปี ${year})

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

## คำถามผู้ใช้

${body.question}`;

    const res = await complete({
      task: 'reason', // advice quality matters → stronger model tier
      system: TAX_ADVISOR_SYSTEM,
      maxTokens: 2048,
      temperature: 0.2,
      messages: [{ role: 'user', content: context }],
    });
    await logUsage(supabase, {
      workspaceId: body.workspaceId,
      fn: 'tax-advisor',
      tier: 'reason',
      result: res,
    });

    return json({
      answer: res.text,
      context_used: summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
