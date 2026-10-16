import type { TaxBracket, WHTCategory } from './types';

/**
 * Tax constants — keep this file as the single source of truth.
 * Update annually after reviewing rd.go.th for changes.
 * Reference: docs/tax-rules-th.md
 */

export const VAT_RATE = 0.07;

export const PIT_BRACKETS: ReadonlyArray<TaxBracket> = [
  { upTo: 150_000, rate: 0 },
  { upTo: 300_000, rate: 0.05 },
  { upTo: 500_000, rate: 0.1 },
  { upTo: 750_000, rate: 0.15 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: 2_000_000, rate: 0.25 },
  { upTo: 5_000_000, rate: 0.3 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.35 },
];

export const CIT_STANDARD_RATE = 0.2;

export const CIT_SME_BRACKETS: ReadonlyArray<TaxBracket> = [
  { upTo: 300_000, rate: 0 },
  { upTo: 3_000_000, rate: 0.15 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.2 },
];

/** Thresholds to qualify as SME for CIT purposes */
export const CIT_SME_LIMITS = {
  maxRegisteredCapital: 5_000_000, // baht
  maxAnnualRevenue: 30_000_000, // baht
} as const;

export const WHT_RATES: Record<WHTCategory, number> = {
  service_corporate: 0.03,
  service_individual: 0.03,
  rent: 0.05,
  advertising: 0.02,
  transport: 0.01,
  commission: 0.03,
  interest_nonbank: 0.01,
  dividend: 0.1,
};

/** Maps a WHT category to the form used to remit it */
export const WHT_FORM_BY_CATEGORY: Record<WHTCategory, 'PND_1' | 'PND_2' | 'PND_3' | 'PND_53' | 'PND_54'> = {
  service_corporate: 'PND_53',
  service_individual: 'PND_3',
  rent: 'PND_53', // assumes paying a juristic person; PND_3 if individual
  advertising: 'PND_53',
  transport: 'PND_53',
  commission: 'PND_53',
  interest_nonbank: 'PND_53',
  dividend: 'PND_2',
};

/** Personal allowances and deduction caps (baht). Verify each tax year. */
export const ALLOWANCES = {
  personal: 60_000,
  spouse: 60_000,
  childPerHead: 30_000,
  parentPerHead: 30_000,
  lifeInsuranceCap: 100_000,
  healthInsuranceSelfCap: 25_000,
  rmfPctOfIncome: 0.3,
  rmfAbsoluteCap: 500_000,
  ssfPctOfIncome: 0.3,
  ssfAbsoluteCap: 200_000,
  tesgPctOfIncome: 0.3,
  tesgAbsoluteCap: 300_000,
  retirementCombinedCap: 500_000, // RMF + SSF + provident fund + pension insurance
  homeMortgageInterestCap: 100_000,
  donationGeneralPctCap: 0.1,
  donationEducationMultiplier: 2,
  socialSecurityCap: 9_000, // employee side cap
} as const;

/** Section 40 expense-allowance rules */
export const SECTION_40_EXPENSE_RULES = {
  // 40(1)+(2) share a single 50% / 100k cap
  combined_1_2: { method: 'percent_with_cap', pct: 0.5, cap: 100_000 },
  '40_3': { method: 'percent_with_cap', pct: 0.5, cap: 100_000 },
  '40_4': { method: 'none' },
  '40_5': { method: 'percent_or_actual', pct: 0.3 }, // 10–30% depending on property; use 30 as default ceiling
  '40_6': { method: 'percent_or_actual', pct: 0.3 }, // can be 60% for medical — caller passes overrides
  '40_7': { method: 'percent_or_actual', pct: 0.6 },
  '40_8': { method: 'percent_or_actual', pct: 0.6 }, // varies; 40 or 60 commonly
} as const;

/** Used for VAT registration threshold checks */
export const VAT_REGISTRATION_THRESHOLD = 1_800_000; // baht per year
