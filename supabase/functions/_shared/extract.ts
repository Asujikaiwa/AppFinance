/**
 * Shared entry-extraction hub used by chat-log, ocr-receipt, line-webhook and
 * email-inbound so every channel behaves identically:
 *
 *   1. enforce monthly AI quota
 *   2. call the right model tier (text for messages, vision for images)
 *   3. log token usage + estimated cost
 *   4. fill the category via free heuristic when the model didn't pick one
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { complete } from './llm.ts';
import { extractJSON } from './llm.ts';
import { EXTRACT_ENTRY_SYSTEM } from './prompts.ts';
import { heuristicCategorize } from './heuristic.ts';
import { enforceQuota, logUsage } from './usage.ts';
import { validateExtracted } from './validation.ts';

export interface ExtractedEntry {
  date: string;
  direction: 'income' | 'expense';
  docType: string;
  docNumber: string | null;
  counterparty: { name: string; taxId: string | null };
  description: string;
  amountExclVat: number; // satang
  vatAmount: number; // satang
  whtRate: number | null;
  whtAmount: number | null;
  suggestedCategoryCode: string | null;
  confidence: number;
  notes: string | null;
}

export interface ExtractContext {
  fn: string; // function name for usage logging
  createdBy?: string;
}

async function categoryHint(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data: cats } = await supabase
    .from('categories')
    .select('code, name_th, direction')
    .eq('workspace_id', workspaceId);
  return (cats ?? [])
    .map((c) => `  ${c.code} — ${c.name_th} (${c.direction})`)
    .join('\n');
}

/** Fill suggestedCategoryCode from the free heuristic if the model left it null. */
function applyHeuristicFallback(e: ExtractedEntry): ExtractedEntry {
  if (e.suggestedCategoryCode) return e;
  const guess = heuristicCategorize(e.description, e.counterparty?.name);
  if (guess) return { ...e, suggestedCategoryCode: guess.code };
  return e;
}

export async function extractFromText(
  supabase: SupabaseClient,
  workspaceId: string,
  message: string,
  ctx: ExtractContext,
): Promise<ExtractedEntry> {
  await enforceQuota(supabase, workspaceId);

  const today = new Date().toISOString().slice(0, 10);
  const hint = await categoryHint(supabase, workspaceId);
  const res = await complete({
    task: 'text',
    system: EXTRACT_ENTRY_SYSTEM,
    maxTokens: 1024,
    messages: [
      {
        role: 'user',
        content: `วันที่ปัจจุบัน: ${today}\n\nผู้ใช้พิมพ์ว่า:\n"${message}"\n\nหมวดที่ใช้ได้:\n${hint}\n\nสกัดเป็น JSON`,
      },
    ],
  });
  await logUsage(supabase, { workspaceId, fn: ctx.fn, tier: 'text', result: res, ...(ctx.createdBy ? { createdBy: ctx.createdBy } : {}) });
  return applyHeuristicFallback(validateExtracted(safeJson(res.text)));
}

export async function extractFromImage(
  supabase: SupabaseClient,
  workspaceId: string,
  base64: string,
  mimeType: string,
  ctx: ExtractContext,
): Promise<ExtractedEntry> {
  await enforceQuota(supabase, workspaceId);

  const today = new Date().toISOString().slice(0, 10);
  const hint = await categoryHint(supabase, workspaceId);
  const res = await complete({
    task: 'vision',
    system: EXTRACT_ENTRY_SYSTEM,
    maxTokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: mimeType, base64 },
          {
            type: 'text',
            text: `วันที่ปัจจุบัน (ถ้าหาในเอกสารไม่ได้): ${today}\n\nหมวดที่ใช้ได้:\n${hint}\n\nอ่านใบเสร็จนี้แล้วสกัดเป็น JSON`,
          },
        ],
      },
    ],
  });
  await logUsage(supabase, { workspaceId, fn: ctx.fn, tier: 'vision', result: res, ...(ctx.createdBy ? { createdBy: ctx.createdBy } : {}) });
  return applyHeuristicFallback(validateExtracted(safeJson(res.text)));
}

/**
 * Extract from a PDF using Claude's native document support (not OCR-as-image).
 * Uses the vision tier (must be an anthropic provider — see llm.ts).
 */
export async function extractFromDocument(
  supabase: SupabaseClient,
  workspaceId: string,
  base64: string,
  ctx: ExtractContext,
): Promise<ExtractedEntry> {
  await enforceQuota(supabase, workspaceId);

  const today = new Date().toISOString().slice(0, 10);
  const hint = await categoryHint(supabase, workspaceId);
  const res = await complete({
    task: 'vision',
    system: EXTRACT_ENTRY_SYSTEM,
    maxTokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', mediaType: 'application/pdf', base64 },
          {
            type: 'text',
            text: `วันที่ปัจจุบัน (ถ้าหาในเอกสารไม่ได้): ${today}\n\nหมวดที่ใช้ได้:\n${hint}\n\nอ่านใบแจ้งหนี้/ใบเสร็จ PDF นี้แล้วสกัดเป็น JSON`,
          },
        ],
      },
    ],
  });
  await logUsage(supabase, { workspaceId, fn: ctx.fn, tier: 'vision', result: res, ...(ctx.createdBy ? { createdBy: ctx.createdBy } : {}) });
  return applyHeuristicFallback(validateExtracted(safeJson(res.text)));
}

/** Parse JSON from the model, returning {} on failure (validateExtracted salvages). */
function safeJson(text: string): unknown {
  try {
    return extractJSON(text || '{}');
  } catch {
    return {};
  }
}

/** Resolve a category code → id within a workspace. */
export async function resolveCategoryId(
  supabase: SupabaseClient,
  workspaceId: string,
  code: string | null,
): Promise<string | null> {
  if (!code) return null;
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('code', code)
    .maybeSingle();
  return data?.id ?? null;
}

/** Insert an extracted entry. `autoConfirm` only when high confidence + text source. */
export async function insertExtractedEntry(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    createdBy: string;
    source: 'manual' | 'chat' | 'ocr' | 'import';
    extracted: ExtractedEntry;
    autoConfirm: boolean;
  },
): Promise<{ id: string; amount_total: number } & Record<string, unknown>> {
  const { workspaceId, createdBy, source, extracted, autoConfirm } = params;
  const categoryId = await resolveCategoryId(
    supabase,
    workspaceId,
    extracted.suggestedCategoryCode,
  );

  const { data, error } = await supabase
    .from('entries')
    .insert({
      workspace_id: workspaceId,
      direction: extracted.direction,
      entry_date: extracted.date,
      doc_type: extracted.docType,
      doc_number: extracted.docNumber,
      counterparty_name: extracted.counterparty.name,
      counterparty_tax_id: extracted.counterparty.taxId,
      description: extracted.description,
      category_id: categoryId,
      amount_excl_vat: extracted.amountExclVat,
      vat_amount: extracted.vatAmount,
      wht_rate: extracted.whtRate,
      wht_amount: extracted.whtAmount ?? 0,
      source,
      ai_confidence: extracted.confidence,
      status: autoConfirm && extracted.confidence >= 0.8 ? 'confirmed' : 'draft',
      notes: extracted.notes,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) throw new Error(`Insert failed: ${error.message}`);
  return data as { id: string; amount_total: number } & Record<string, unknown>;
}
