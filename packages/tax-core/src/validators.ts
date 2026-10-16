/**
 * Validate a Thai Tax ID (เลขประจำตัวผู้เสียภาษี / เลขประจำตัวประชาชน).
 * Both share the same 13-digit format with a Mod 11 check digit.
 *
 * Algorithm:
 *   sum = Σ digit[i] * (13 - i) for i in 0..11
 *   check = (11 - (sum % 11)) % 10
 *   valid iff check === digit[12]
 */
export function validateTaxId(id: string): boolean {
  const cleaned = id.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(cleaned[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(cleaned[12]);
}

/**
 * Validate ภ.พ.30 monthly filing date — must file by the 15th of the
 * following month. Returns the due date or null if input is invalid.
 */
export function vatFilingDueDate(periodEndDate: Date): Date | null {
  if (Number.isNaN(periodEndDate.getTime())) return null;
  const year = periodEndDate.getUTCFullYear();
  const month = periodEndDate.getUTCMonth(); // 0–11
  // Due on the 15th of the next month
  return new Date(Date.UTC(year, month + 1, 15));
}

/** Validate a 13-digit Tax ID more leniently (just length & numeric). */
export function isTaxIdFormat(id: string): boolean {
  return /^\d{13}$/.test(id.replace(/[\s-]/g, ''));
}

/** Format Tax ID with dashes: X-XXXX-XXXXX-XX-X */
export function formatTaxId(id: string): string {
  const c = id.replace(/[\s-]/g, '');
  if (c.length !== 13) return id;
  return `${c[0]}-${c.slice(1, 5)}-${c.slice(5, 10)}-${c.slice(10, 12)}-${c[12]}`;
}
