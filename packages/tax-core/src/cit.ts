import {
  CIT_SME_BRACKETS,
  CIT_SME_LIMITS,
  CIT_STANDARD_RATE,
} from './constants';
import { applyBrackets } from './pit';
import type { CITInput, CITResult } from './types';

/**
 * Determine whether a company qualifies for the SME corporate tax brackets.
 * Both registered capital AND annual revenue must be under their thresholds.
 */
export function qualifiesAsSME(
  registeredCapital?: number,
  annualRevenue?: number,
): boolean {
  if (registeredCapital === undefined || annualRevenue === undefined) return false;
  return (
    registeredCapital <= CIT_SME_LIMITS.maxRegisteredCapital &&
    annualRevenue <= CIT_SME_LIMITS.maxAnnualRevenue
  );
}

export function calculateCIT(input: CITInput): CITResult {
  const sme =
    input.isSME &&
    qualifiesAsSME(input.registeredCapital, input.annualRevenue);

  if (input.netProfit <= 0) {
    return {
      netProfit: input.netProfit,
      taxLiability: 0,
      effectiveRate: 0,
      bracketUsed: sme ? 'SME' : 'STANDARD',
      breakdown: [],
    };
  }

  if (sme) {
    const { total, breakdown } = applyBrackets(
      input.netProfit,
      CIT_SME_BRACKETS,
    );
    return {
      netProfit: input.netProfit,
      taxLiability: round2(total),
      effectiveRate: total / input.netProfit,
      bracketUsed: 'SME',
      breakdown: breakdown.map((b) => ({
        bracket: b.bracket,
        amount: b.amountInBracket,
        rate: b.rate,
        tax: round2(b.tax),
      })),
    };
  }

  const tax = input.netProfit * CIT_STANDARD_RATE;
  return {
    netProfit: input.netProfit,
    taxLiability: round2(tax),
    effectiveRate: CIT_STANDARD_RATE,
    bracketUsed: 'STANDARD',
    breakdown: [
      {
        bracket: 'flat 20%',
        amount: input.netProfit,
        rate: CIT_STANDARD_RATE,
        tax: round2(tax),
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
