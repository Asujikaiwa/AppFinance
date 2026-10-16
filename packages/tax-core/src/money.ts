import type { Baht, Satang } from './types';

/** Convert a baht-with-decimals input into integer satang. Half-even rounding. */
export function bahtToSatang(baht: number): Satang {
  if (!Number.isFinite(baht)) throw new Error('bahtToSatang: input must be finite');
  // Multiply then round to nearest integer (handles 0.1 + 0.2 cases).
  return Math.round(baht * 100) as Satang;
}

export function satangToBaht(satang: number): Baht {
  return (satang / 100) as Baht;
}

/** Compute VAT amount from a pre-tax amount, in satang. */
export function vatOnExcl(amountExclSatang: number, rate: number): Satang {
  return Math.round(amountExclSatang * rate) as Satang;
}

/**
 * Split a VAT-inclusive total into excl + vat parts, in satang.
 * Useful for receipts that quote only the total.
 */
export function splitInclusive(
  totalSatang: number,
  rate: number,
): { excl: Satang; vat: Satang } {
  const excl = Math.round(totalSatang / (1 + rate));
  const vat = (totalSatang - excl) as Satang;
  return { excl: excl as Satang, vat };
}

/** Format satang for display: ฿1,234.56 */
export function formatTHB(satang: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(satang / 100);
}

/** Sum a list of satang values safely. */
export function sumSatang(values: ReadonlyArray<number>): Satang {
  let total = 0;
  for (const v of values) total += v;
  return total as Satang;
}
