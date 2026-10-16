/**
 * Validate + sanitize the JSON the AI returns before it touches the database.
 * If the model returns something malformed, we DON'T crash or insert garbage —
 * we salvage what we can and force the entry to a low-confidence draft so a
 * human reviews it.
 */
import { z } from 'npm:zod@3.23.8';
import type { ExtractedEntry } from './extract.ts';

const taxIdSchema = z
  .string()
  .regex(/^\d{13}$/)
  .nullable()
  .catch(null);

const moneySchema = z.number().int().nonnegative().catch(0);

export const extractedSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => new Date().toISOString().slice(0, 10)),
  direction: z.enum(['income', 'expense']).catch('expense'),
  docType: z
    .enum(['tax_invoice_full', 'tax_invoice_abbr', 'receipt', 'invoice', 'other'])
    .catch('other'),
  docNumber: z.string().nullable().catch(null),
  counterparty: z
    .object({
      name: z.string().catch(''),
      taxId: taxIdSchema,
    })
    .catch({ name: '', taxId: null }),
  description: z.string().catch(''),
  amountExclVat: moneySchema,
  vatAmount: moneySchema,
  whtRate: z.number().min(0).max(1).nullable().catch(null),
  whtAmount: moneySchema.nullable().catch(null),
  suggestedCategoryCode: z.string().nullable().catch(null),
  confidence: z.number().min(0).max(1).catch(0.2),
  notes: z.string().nullable().catch(null),
});

/**
 * Returns a guaranteed-valid ExtractedEntry. On any structural problem the
 * entry is downgraded to confidence ≤ 0.3 (→ draft) with a note explaining why.
 */
export function validateExtracted(raw: unknown): ExtractedEntry {
  const parsed = extractedSchema.safeParse(raw);
  if (parsed.success) {
    const e = parsed.data as ExtractedEntry;
    // Cross-field sanity: total must be positive and VAT not absurd.
    if (e.amountExclVat <= 0) {
      return { ...e, confidence: Math.min(e.confidence, 0.3), notes: appendNote(e.notes, 'ยอดเงินอ่านไม่ได้ — โปรดตรวจสอบ') };
    }
    return e;
  }

  // Total parse failure → minimal safe draft.
  return {
    date: new Date().toISOString().slice(0, 10),
    direction: 'expense',
    docType: 'other',
    docNumber: null,
    counterparty: { name: '', taxId: null },
    description: 'ไม่สามารถอ่านรายการได้',
    amountExclVat: 0,
    vatAmount: 0,
    whtRate: null,
    whtAmount: null,
    suggestedCategoryCode: null,
    confidence: 0.1,
    notes: 'AI ส่งข้อมูลไม่ถูกรูปแบบ — โปรดกรอกด้วยตนเอง',
  };
}

function appendNote(existing: string | null, msg: string): string {
  return existing ? `${existing} | ${msg}` : msg;
}
