/**
 * All monetary values in this codebase are integers in *satang*
 * (1 baht = 100 satang) unless explicitly typed as `Baht`.
 * Never use floating point for money.
 */
export type Satang = number & { readonly __brand: 'satang' };
export type Baht = number & { readonly __brand: 'baht' };

export type WorkspaceKind = 'personal' | 'corporate';
export type EntryDirection = 'income' | 'expense';
export type EntrySource = 'manual' | 'chat' | 'ocr' | 'import';
export type DocType =
  | 'tax_invoice_full'
  | 'tax_invoice_abbr'
  | 'receipt'
  | 'invoice'
  | 'other';

/** Income classification under Section 40 of the Revenue Code */
export type IncomeType40 = '40_1' | '40_2' | '40_3' | '40_4' | '40_5' | '40_6' | '40_7' | '40_8';

/** Tax bracket: applies `rate` to amounts up to and including `upTo` */
export interface TaxBracket {
  readonly upTo: number; // baht (whole numbers — tax brackets are not in satang)
  readonly rate: number; // 0–1
}

export interface PITInput {
  /** Annual gross income broken down by Section 40 type */
  readonly income: Partial<Record<IncomeType40, number>>; // baht
  /** Deductions claimed */
  readonly deductions: PITDeductions;
  /** Tax already withheld throughout the year (baht) */
  readonly withholdingPaid?: number;
}

export interface PITDeductions {
  readonly personal?: number;
  readonly spouse?: number;
  readonly children?: number; // # of children
  readonly parents?: number; // # of parents
  readonly socialSecurity?: number;
  readonly lifeInsurance?: number;
  readonly healthInsurance?: number;
  readonly rmf?: number;
  readonly ssf?: number;
  readonly tesg?: number;
  readonly homeMortgageInterest?: number;
  readonly donationsRegular?: number;
  readonly donationsEducation?: number; // double deduction
  readonly other?: number;
}

export interface PITResult {
  readonly grossIncome: number;
  readonly expenseAllowance: number;
  readonly netIncomeBeforeDeductions: number;
  readonly totalDeductions: number;
  readonly taxableIncome: number;
  /** Tax owed before WHT credit */
  readonly taxLiability: number;
  /** Tax payable after WHT credit (can be negative = refund) */
  readonly taxPayableOrRefund: number;
  readonly effectiveRate: number; // 0–1
  readonly breakdown: ReadonlyArray<{
    readonly bracket: string;
    readonly amountInBracket: number;
    readonly rate: number;
    readonly tax: number;
  }>;
}

export interface CITInput {
  readonly netProfit: number; // baht
  readonly isSME: boolean;
  readonly registeredCapital?: number;
  readonly annualRevenue?: number;
}

export interface CITResult {
  readonly netProfit: number;
  readonly taxLiability: number;
  readonly effectiveRate: number;
  readonly bracketUsed: 'SME' | 'STANDARD';
  readonly breakdown: ReadonlyArray<{
    readonly bracket: string;
    readonly amount: number;
    readonly rate: number;
    readonly tax: number;
  }>;
}

export interface VATEntry {
  readonly direction: EntryDirection; // income = output VAT, expense = input VAT
  readonly amountExclVat: number; // satang
  readonly vatAmount: number; // satang
  readonly docType: DocType;
  /** Whether the input VAT is claimable (false for prohibited items) */
  readonly isClaimable?: boolean;
}

export interface VATResult {
  readonly outputVat: number; // satang
  readonly inputVat: number; // satang
  readonly inputVatClaimable: number; // satang (excludes prohibited)
  readonly netVatPayable: number; // satang (positive = pay, negative = credit)
  readonly entriesIn: number;
  readonly entriesOut: number;
}

export type WHTCategory =
  | 'service_corporate'
  | 'service_individual'
  | 'rent'
  | 'advertising'
  | 'transport'
  | 'commission'
  | 'interest_nonbank'
  | 'dividend';

export interface WHTPayment {
  readonly category: WHTCategory;
  readonly amountExclVat: number; // satang — WHT is calculated on amount excl VAT
}

export interface WHTResult {
  readonly category: WHTCategory;
  readonly rate: number;
  readonly amountExclVat: number;
  readonly whtAmount: number; // satang
  readonly form: 'PND_1' | 'PND_2' | 'PND_3' | 'PND_53' | 'PND_54';
}
