import { VAT_RATE } from './constants';
import { vatOnExcl } from './money';
import type { VATEntry, VATResult } from './types';

/**
 * Aggregate a list of entries into a monthly VAT return summary (ภ.พ.30).
 * All amounts in satang.
 */
export function calculateVAT(entries: ReadonlyArray<VATEntry>): VATResult {
  let outputVat = 0;
  let inputVat = 0;
  let inputVatClaimable = 0;
  let entriesIn = 0;
  let entriesOut = 0;

  for (const e of entries) {
    if (e.direction === 'income') {
      outputVat += e.vatAmount;
      entriesOut += 1;
    } else {
      inputVat += e.vatAmount;
      // Default claimable unless explicitly marked false (e.g., entertainment, passenger cars)
      if (e.isClaimable !== false) {
        inputVatClaimable += e.vatAmount;
      }
      entriesIn += 1;
    }
  }

  return {
    outputVat,
    inputVat,
    inputVatClaimable,
    netVatPayable: outputVat - inputVatClaimable,
    entriesIn,
    entriesOut,
  };
}

/** Convenience: compute VAT for a single sale, in satang. */
export function vatForSale(amountExclSatang: number): number {
  return vatOnExcl(amountExclSatang, VAT_RATE);
}

/**
 * Quick sanity-check that a vendor's stated VAT matches the expected 7% (±1 satang).
 * Useful for OCR validation.
 */
export function isVatConsistent(
  amountExclSatang: number,
  vatSatang: number,
  toleranceSatang = 1,
): boolean {
  const expected = vatOnExcl(amountExclSatang, VAT_RATE);
  return Math.abs(expected - vatSatang) <= toleranceSatang;
}
