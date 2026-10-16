import { describe, expect, it } from 'vitest';
import { applyBrackets, calculatePIT, computeExpenseAllowance } from '../pit.js';
import { PIT_BRACKETS } from '../constants.js';

describe('PIT — expense allowance (Section 40)', () => {
  it('caps 40(1)+40(2) combined at 100k', () => {
    const allowance = computeExpenseAllowance({ '40_1': 1_000_000 });
    expect(allowance).toBe(100_000);
  });

  it('returns 50% for low salaries under the cap', () => {
    const allowance = computeExpenseAllowance({ '40_1': 100_000 });
    expect(allowance).toBe(50_000);
  });

  it('gives 0 for 40(4) dividend/interest', () => {
    expect(computeExpenseAllowance({ '40_4': 500_000 })).toBe(0);
  });

  it('combines salary and freelance into a single 100k cap', () => {
    const allowance = computeExpenseAllowance({ '40_1': 80_000, '40_2': 80_000 });
    // 50% of 160k = 80k, under cap
    expect(allowance).toBe(80_000);
  });
});

describe('PIT — bracket application', () => {
  it('zero tax on income under 150k', () => {
    const { total } = applyBrackets(150_000, PIT_BRACKETS);
    expect(total).toBe(0);
  });

  it('5% applies only to the slice above 150k', () => {
    const { total } = applyBrackets(200_000, PIT_BRACKETS);
    // (200k - 150k) * 5% = 2,500
    expect(total).toBe(2_500);
  });

  it('handles top bracket', () => {
    const { total } = applyBrackets(6_000_000, PIT_BRACKETS);
    // 0 + 7,500 + 20,000 + 37,500 + 50,000 + 250,000 + 900,000 + 350,000 = 1,615,000
    expect(total).toBe(1_615_000);
  });
});

describe('PIT — full calculation', () => {
  it('worker on 600k salary with default deductions', () => {
    const r = calculatePIT({
      income: { '40_1': 600_000 },
      deductions: {
        // explicit so we are not testing the default
        personal: 60_000,
        socialSecurity: 9_000,
      },
    });
    // 50% of 600k = 300k, capped at 100k
    expect(r.expenseAllowance).toBe(100_000);
    expect(r.netIncomeBeforeDeductions).toBe(500_000);
    expect(r.totalDeductions).toBe(69_000);
    expect(r.taxableIncome).toBe(431_000);
    // Tax: 0 + 7,500 + 13,100 = 20,600
    //   150-300: 150k * 5% = 7,500
    //   300-431: 131k * 10% = 13,100
    expect(r.taxLiability).toBe(20_600);
  });

  it('refund when WHT exceeds liability', () => {
    const r = calculatePIT({
      income: { '40_1': 300_000 },
      deductions: { personal: 60_000 },
      withholdingPaid: 5_000,
    });
    // taxable = 300k - 100k (expense) - 60k = 140k → under 150k → tax 0
    expect(r.taxLiability).toBe(0);
    expect(r.taxPayableOrRefund).toBe(-5_000); // refund
  });
});
