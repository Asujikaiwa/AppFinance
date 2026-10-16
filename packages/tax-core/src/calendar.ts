/**
 * Thai tax filing calendar. Computes due dates for each obligation given a
 * workspace profile and a reference period. Pure functions — no I/O.
 *
 * Reference: docs/tax-rules-th.md § Filing Calendar
 */

export type Obligation =
  | 'pp30' // VAT monthly
  | 'png1' // payroll WHT monthly
  | 'png3' // WHT to individuals monthly
  | 'png53' // WHT to juristic persons monthly
  | 'png50' // CIT annual
  | 'png51' // CIT half-year
  | 'png90' // PIT (with business income)
  | 'png91'; // PIT (employment income only)

export interface WorkspaceProfile {
  kind: 'personal' | 'corporate';
  vatRegistered: boolean;
  fiscalYearStartMonth: number; // 1–12
  hasPayroll?: boolean;
  hasWhtIndividual?: boolean;
  hasWhtJuristic?: boolean;
}

export interface DueItem {
  obligation: Obligation;
  periodLabel: string; // "2026-05" or "FY2025"
  dueDate: string; // YYYY-MM-DD
  /** Whether the e-filing extension applies (gives a later deadline) */
  eFilingDate?: string;
  titleTh: string;
}

const OBLIGATION_TITLES: Record<Obligation, string> = {
  pp30: 'ภ.พ.30 — ภาษีมูลค่าเพิ่ม',
  png1: 'ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่าย (เงินเดือน)',
  png3: 'ภ.ง.ด.3 — ภาษีหัก ณ ที่จ่าย (บุคคลธรรมดา)',
  png53: 'ภ.ง.ด.53 — ภาษีหัก ณ ที่จ่าย (นิติบุคคล)',
  png50: 'ภ.ง.ด.50 — ภาษีเงินได้นิติบุคคล (ประจำปี)',
  png51: 'ภ.ง.ด.51 — ภาษีเงินได้นิติบุคคล (ครึ่งปี)',
  png90: 'ภ.ง.ด.90 — ภาษีเงินได้บุคคลธรรมดา',
  png91: 'ภ.ง.ด.91 — ภาษีเงินได้บุคคลธรรมดา (เงินเดือน)',
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthLabel(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, '0')}`;
}

/**
 * Monthly obligations due on the 15th of the *following* month
 * (we surface the e-filing deadline of the 15th; paper is the 7th for PND).
 */
export function monthlyDueDates(
  profile: WorkspaceProfile,
  year: number,
  month1: number, // the period month, 1–12
): DueItem[] {
  const items: DueItem[] = [];
  // Next month, the 15th
  const next = new Date(Date.UTC(year, month1, 15)); // month1 is 1-based → Date month index = month1 (next month)
  const paper7 = new Date(Date.UTC(year, month1, 7));
  const label = monthLabel(year, month1);

  if (profile.vatRegistered) {
    items.push({
      obligation: 'pp30',
      periodLabel: label,
      dueDate: iso(next), // VAT: 15th, no separate paper date in our model
      titleTh: OBLIGATION_TITLES.pp30,
    });
  }
  if (profile.hasPayroll) {
    items.push({
      obligation: 'png1',
      periodLabel: label,
      dueDate: iso(paper7),
      eFilingDate: iso(next),
      titleTh: OBLIGATION_TITLES.png1,
    });
  }
  if (profile.hasWhtIndividual) {
    items.push({
      obligation: 'png3',
      periodLabel: label,
      dueDate: iso(paper7),
      eFilingDate: iso(next),
      titleTh: OBLIGATION_TITLES.png3,
    });
  }
  if (profile.hasWhtJuristic) {
    items.push({
      obligation: 'png53',
      periodLabel: label,
      dueDate: iso(paper7),
      eFilingDate: iso(next),
      titleTh: OBLIGATION_TITLES.png53,
    });
  }
  return items;
}

/**
 * Annual obligations for a given calendar/fiscal year.
 * - Personal (PIT): ภ.ง.ด.90/91 due Mar 31 of the following year.
 * - Corporate (CIT): ภ.ง.ด.50 due 150 days after FY end; ภ.ง.ด.51 due 60 days
 *   after the half-year point.
 */
export function annualDueDates(
  profile: WorkspaceProfile,
  year: number,
): DueItem[] {
  const items: DueItem[] = [];

  if (profile.kind === 'personal') {
    const due = new Date(Date.UTC(year + 1, 2, 31)); // March 31 next year
    const ob: Obligation = profile.hasPayroll && !profile.hasWhtIndividual ? 'png91' : 'png90';
    items.push({
      obligation: ob,
      periodLabel: `FY${year}`,
      dueDate: iso(due),
      titleTh: OBLIGATION_TITLES[ob],
    });
    return items;
  }

  // Corporate: fiscal year starts at fiscalYearStartMonth
  const fyStart = new Date(Date.UTC(year, profile.fiscalYearStartMonth - 1, 1));
  const fyEnd = new Date(Date.UTC(year + 1, profile.fiscalYearStartMonth - 1, 1));
  fyEnd.setUTCDate(fyEnd.getUTCDate() - 1); // last day of FY

  // ภ.ง.ด.50: 150 days after FY end
  const png50Due = new Date(fyEnd);
  png50Due.setUTCDate(png50Due.getUTCDate() + 150);
  items.push({
    obligation: 'png50',
    periodLabel: `FY${year}`,
    dueDate: iso(png50Due),
    titleTh: OBLIGATION_TITLES.png50,
  });

  // ภ.ง.ด.51: 60 days after the half-year midpoint
  const halfPoint = new Date(fyStart);
  halfPoint.setUTCMonth(halfPoint.getUTCMonth() + 6);
  const png51Due = new Date(halfPoint);
  png51Due.setUTCDate(png51Due.getUTCDate() + 60);
  items.push({
    obligation: 'png51',
    periodLabel: `FY${year}-H1`,
    dueDate: iso(png51Due),
    titleTh: OBLIGATION_TITLES.png51,
  });

  return items;
}

/**
 * Generate all due items for a window of months ahead — used to pre-populate
 * the `reminders` table.
 */
export function generateUpcomingReminders(
  profile: WorkspaceProfile,
  fromYear: number,
  fromMonth1: number,
  monthsAhead = 3,
): DueItem[] {
  const out: DueItem[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const m0 = fromMonth1 - 1 + i;
    const y = fromYear + Math.floor(m0 / 12);
    const m1 = (m0 % 12) + 1;
    out.push(...monthlyDueDates(profile, y, m1));
  }
  return out;
}

/** Days between today and a due date (positive = future). */
export function daysUntil(dueDateIso: string, today = new Date()): number {
  const due = new Date(dueDateIso + 'T00:00:00Z');
  const t0 = new Date(iso(today) + 'T00:00:00Z');
  return Math.round((due.getTime() - t0.getTime()) / 86_400_000);
}
