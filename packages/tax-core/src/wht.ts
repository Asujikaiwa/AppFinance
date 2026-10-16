import { WHT_FORM_BY_CATEGORY, WHT_RATES } from './constants';
import type { WHTPayment, WHTResult } from './types';

/**
 * Compute WHT for a single payment. Amount is in satang (excl VAT).
 * WHT is always calculated on the pre-VAT amount.
 */
export function calculateWHT(payment: WHTPayment): WHTResult {
  const rate = WHT_RATES[payment.category];
  const whtAmount = Math.round(payment.amountExclVat * rate);
  return {
    category: payment.category,
    rate,
    amountExclVat: payment.amountExclVat,
    whtAmount,
    form: WHT_FORM_BY_CATEGORY[payment.category],
  };
}

/** Group multiple WHT payments by form for monthly filing. */
export function groupWHTByForm(
  payments: ReadonlyArray<WHTPayment>,
): Record<WHTResult['form'], { count: number; totalWht: number; totalBase: number }> {
  const groups: Record<string, { count: number; totalWht: number; totalBase: number }> =
    {};
  for (const p of payments) {
    const r = calculateWHT(p);
    const g = groups[r.form] ?? { count: 0, totalWht: 0, totalBase: 0 };
    g.count += 1;
    g.totalWht += r.whtAmount;
    g.totalBase += r.amountExclVat;
    groups[r.form] = g;
  }
  return groups as Record<WHTResult['form'], { count: number; totalWht: number; totalBase: number }>;
}
