import { supabase } from './supabase';

/**
 * Typed wrappers around our edge functions. Each returns the parsed JSON
 * body or throws.
 */

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Empty response from ${name}`);
  return data;
}

export interface EntryRow {
  id: string;
  workspace_id: string;
  direction: 'income' | 'expense';
  entry_date: string;
  doc_type: string;
  doc_number: string | null;
  counterparty_name: string | null;
  counterparty_tax_id: string | null;
  description: string;
  category_id: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  amount_total: number;
  wht_rate: number | null;
  wht_amount: number;
  is_deductible: boolean;
  source: 'manual' | 'chat' | 'ocr' | 'import';
  ai_confidence: number | null;
  status: 'draft' | 'confirmed' | 'locked';
  notes: string | null;
  created_at: string;
}

export const api = {
  chatLog: (workspaceId: string, message: string) =>
    invokeFn<{ entry: EntryRow; ai: unknown }>('chat-log', {
      workspaceId,
      message,
    }),

  ocrReceipt: (workspaceId: string, storagePath: string) =>
    invokeFn<{ entry: EntryRow; ai: unknown }>('ocr-receipt', {
      workspaceId,
      storagePath,
    }),

  categorize: (workspaceId: string, entryId: string) =>
    invokeFn<{ entry: EntryRow; reasoning: string }>('categorize', {
      workspaceId,
      entryId,
    }),

  taxAdvisor: (workspaceId: string, question: string, year?: number) =>
    invokeFn<{ answer: string; context_used: unknown }>('tax-advisor', {
      workspaceId,
      question,
      year,
    }),

  generateReport: (
    workspaceId: string,
    kind: 'pp30' | 'accountant_pack',
    periodStart: string,
    periodEnd: string,
  ) =>
    invokeFn<{
      url: string;
      storagePath: string;
      summary: {
        taxableSalesExcl: number;
        outputVat: number;
        inputVat: number;
        netVatPayable: number;
      };
      entryCount: number;
    }>('generate-report', { workspaceId, kind, periodStart, periodEnd }),
};

/** First & last day of a month, as YYYY-MM-DD. */
export function monthRange(year: number, month1: number): [string, string] {
  const start = `${year}-${String(month1).padStart(2, '0')}-01`;
  const last = new Date(year, month1, 0).getDate(); // day 0 of next month
  const end = `${year}-${String(month1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return [start, end];
}

export function yearRange(year: number): [string, string] {
  return [`${year}-01-01`, `${year}-12-31`];
}
