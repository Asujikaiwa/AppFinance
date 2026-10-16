import { ALLOWANCES, PIT_BRACKETS } from './constants';
import type {
  IncomeType40,
  PITDeductions,
  PITInput,
  PITResult,
  TaxBracket,
} from './types';

/**
 * Compute Section 40 expense allowance (ค่าใช้จ่ายตามมาตรา 40).
 * This is the lump-sum/percent-based allowance — callers wanting "actual expense"
 * should set the income to the post-expense amount and pass 0 to this function.
 */
export function computeExpenseAllowance(
  income: Partial<Record<IncomeType40, number>>,
): number {
  let allowance = 0;

  // 40(1) and 40(2) share a combined cap of 100,000 at 50%
  const combined12 = (income['40_1'] ?? 0) + (income['40_2'] ?? 0);
  if (combined12 > 0) {
    allowance += Math.min(combined12 * 0.5, 100_000);
  }

  // 40(3): same 50% / 100k cap (for goodwill, copyright, etc.)
  if (income['40_3']) {
    allowance += Math.min(income['40_3'] * 0.5, 100_000);
  }

  // 40(4): dividend / interest — no expense allowance
  // 40(5): rent — default 30% (real number varies 10–30%; caller can override income upfront)
  if (income['40_5']) {
    allowance += income['40_5'] * 0.3;
  }

  // 40(6): professional — default 30% (60% for medical; caller can override)
  if (income['40_6']) {
    allowance += income['40_6'] * 0.3;
  }

  // 40(7): contractor — 60%
  if (income['40_7']) {
    allowance += income['40_7'] * 0.6;
  }

  // 40(8): business — default 60% (varies; caller should adjust if actuals differ)
  if (income['40_8']) {
    allowance += income['40_8'] * 0.6;
  }

  return allowance;
}

export function computeTotalDeductions(
  d: PITDeductions,
  netIncomeBeforeDeductions: number,
): number {
  let total = 0;

  total += d.personal ?? ALLOWANCES.personal; // default to the standard 60k
  total += d.spouse ?? 0;
  total += (d.children ?? 0) * ALLOWANCES.childPerHead;
  total += (d.parents ?? 0) * ALLOWANCES.parentPerHead;
  total += Math.min(d.socialSecurity ?? 0, ALLOWANCES.socialSecurityCap);

  // life + health insurance share a 100k cap (health alone capped at 25k)
  const health = Math.min(d.healthInsurance ?? 0, ALLOWANCES.healthInsuranceSelfCap);
  const life = d.lifeInsurance ?? 0;
  total += Math.min(life + health, ALLOWANCES.lifeInsuranceCap);

  // Retirement vehicles (RMF + SSF) share a 500k cap; TESG is separate
  const rmf = Math.min(
    d.rmf ?? 0,
    netIncomeBeforeDeductions * ALLOWANCES.rmfPctOfIncome,
    ALLOWANCES.rmfAbsoluteCap,
  );
  const ssf = Math.min(
    d.ssf ?? 0,
    netIncomeBeforeDeductions * ALLOWANCES.ssfPctOfIncome,
    ALLOWANCES.ssfAbsoluteCap,
  );
  total += Math.min(rmf + ssf, ALLOWANCES.retirementCombinedCap);

  const tesg = Math.min(
    d.tesg ?? 0,
    netIncomeBeforeDeductions * ALLOWANCES.tesgPctOfIncome,
    ALLOWANCES.tesgAbsoluteCap,
  );
  total += tesg;

  total += Math.min(d.homeMortgageInterest ?? 0, ALLOWANCES.homeMortgageInterestCap);

  // Donations: education is double-counted, regular at face value. Combined cap 10% of net.
  const donationCap = netIncomeBeforeDeductions * ALLOWANCES.donationGeneralPctCap;
  const eduDonation =
    (d.donationsEducation ?? 0) * ALLOWANCES.donationEducationMultiplier;
  const regularDonation = d.donationsRegular ?? 0;
  total += Math.min(eduDonation + regularDonation, donationCap);

  total += d.other ?? 0;

  return total;
}

/**
 * Apply progressive tax brackets to a taxable income (in baht).
 * Returns total tax owed and a per-bracket breakdown.
 */
export function applyBrackets(
  taxable: number,
  brackets: ReadonlyArray<TaxBracket>,
): { total: number; breakdown: PITResult['breakdown'] } {
  const breakdown: PITResult['breakdown'] = [] as unknown as PITResult['breakdown'];
  const out: Array<{
    bracket: string;
    amountInBracket: number;
    rate: number;
    tax: number;
  }> = [];

  let lower = 0;
  let total = 0;

  for (const b of brackets) {
    if (taxable <= lower) break;
    const upper = Math.min(taxable, b.upTo);
    const slice = Math.max(0, upper - lower);
    if (slice > 0 || b.rate === 0) {
      const tax = slice * b.rate;
      total += tax;
      out.push({
        bracket:
          b.upTo === Number.POSITIVE_INFINITY
            ? `> ${lower.toLocaleString()}`
            : `${lower.toLocaleString()} – ${b.upTo.toLocaleString()}`,
        amountInBracket: slice,
        rate: b.rate,
        tax,
      });
    }
    lower = b.upTo;
  }

  return { total, breakdown: out };
}

export function calculatePIT(input: PITInput): PITResult {
  const grossIncome = Object.values(input.income).reduce(
    (sum, v) => sum + (v ?? 0),
    0,
  );

  const expenseAllowance = computeExpenseAllowance(input.income);
  const netIncomeBeforeDeductions = grossIncome - expenseAllowance;

  const totalDeductions = computeTotalDeductions(
    input.deductions,
    netIncomeBeforeDeductions,
  );

  const taxableIncome = Math.max(0, netIncomeBeforeDeductions - totalDeductions);

  const { total: taxLiability, breakdown } = applyBrackets(
    taxableIncome,
    PIT_BRACKETS,
  );

  const taxPayableOrRefund = taxLiability - (input.withholdingPaid ?? 0);

  return {
    grossIncome,
    expenseAllowance,
    netIncomeBeforeDeductions,
    totalDeductions,
    taxableIncome,
    taxLiability: round2(taxLiability),
    taxPayableOrRefund: round2(taxPayableOrRefund),
    effectiveRate: grossIncome > 0 ? taxLiability / grossIncome : 0,
    breakdown: breakdown.map((b) => ({ ...b, tax: round2(b.tax) })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
