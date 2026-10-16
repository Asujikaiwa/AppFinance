import { describe, expect, it } from 'vitest';
import { calculateVAT, isVatConsistent, vatForSale } from '../vat.js';
import { splitInclusive } from '../money.js';

describe('VAT', () => {
  it('computes 7% on a clean amount', () => {
    expect(vatForSale(100_000)).toBe(7_000); // 1,000 baht * 7%
  });

  it('splits inclusive total correctly', () => {
    // 107 baht VAT-inclusive = 100 excl + 7 vat
    const { excl, vat } = splitInclusive(10_700, 0.07);
    expect(excl).toBe(10_000);
    expect(vat).toBe(700);
  });

  it('netVatPayable subtracts claimable input from output', () => {
    const r = calculateVAT([
      { direction: 'income', amountExclVat: 100_000, vatAmount: 7_000, docType: 'tax_invoice_full' },
      { direction: 'expense', amountExclVat: 50_000, vatAmount: 3_500, docType: 'tax_invoice_full' },
    ]);
    expect(r.outputVat).toBe(7_000);
    expect(r.inputVatClaimable).toBe(3_500);
    expect(r.netVatPayable).toBe(3_500);
  });

  it('excludes non-claimable input VAT (e.g., entertainment)', () => {
    const r = calculateVAT([
      { direction: 'expense', amountExclVat: 10_000, vatAmount: 700, docType: 'tax_invoice_full', isClaimable: false },
      { direction: 'expense', amountExclVat: 10_000, vatAmount: 700, docType: 'tax_invoice_full' },
    ]);
    expect(r.inputVat).toBe(1_400);
    expect(r.inputVatClaimable).toBe(700);
  });

  it('isVatConsistent flags wrong rates', () => {
    expect(isVatConsistent(10_000, 700)).toBe(true);
    expect(isVatConsistent(10_000, 500)).toBe(false);
  });
});
