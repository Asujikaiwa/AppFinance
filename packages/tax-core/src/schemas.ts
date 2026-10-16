import { z } from 'zod';

/**
 * Shared Zod schemas. Used to validate:
 *   - API payloads between mobile <-> edge functions
 *   - AI-structured outputs (OCR / chat parsing)
 *   - Form inputs in the mobile app
 */

export const taxIdSchema = z
  .string()
  .regex(/^\d{13}$/, 'Tax ID ต้องมี 13 หลัก');

export const moneySchema = z.number().int().nonnegative();

export const docTypeSchema = z.enum([
  'tax_invoice_full',
  'tax_invoice_abbr',
  'receipt',
  'invoice',
  'other',
]);

export const directionSchema = z.enum(['income', 'expense']);
export const sourceSchema = z.enum(['manual', 'chat', 'ocr', 'import']);

/** What the AI returns from OCR / chat-log — must be parseable into an Entry. */
export const aiExtractedEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  direction: directionSchema,
  docType: docTypeSchema,
  docNumber: z.string().nullable(),
  counterparty: z.object({
    name: z.string(),
    taxId: taxIdSchema.nullable(),
  }),
  description: z.string(),
  amountExclVat: moneySchema, // satang
  vatAmount: moneySchema, // satang
  whtRate: z.number().min(0).max(1).nullable(),
  whtAmount: moneySchema.nullable(),
  suggestedCategoryCode: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable(),
});

export type AIExtractedEntry = z.infer<typeof aiExtractedEntrySchema>;

/** Payload sent from mobile when a user types a chat message to log an entry. */
export const chatLogRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

export const ocrRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  storagePath: z.string().min(1),
});

export const categorizeRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  entryId: z.string().uuid(),
});

export const taxAdvisorRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  year: z.number().int().min(2020).max(2100).optional(),
});
