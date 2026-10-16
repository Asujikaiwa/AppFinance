/**
 * Deno-native copy of the filing-calendar logic.
 * Mirror of packages/tax-core/src/calendar.ts — keep in sync.
 *
 * (Edge functions can't bundle tax-core because it uses Node-style ".js"
 *  import specifiers, which Deno doesn't resolve. This small copy avoids that.)
 */

export type Obligation =
  | 'pp30' | 'png1' | 'png3' | 'png53'
  | 'png50' | 'png51' | 'png90' | 'png91';

export interface WorkspaceProfile {
  kind: 'personal' | 'corporate';
  vatRegistered: boolean;
  fiscalYearStartMonth: number;
  hasPayroll?: boolean;
  hasWhtIndividual?: boolean;
  hasWhtJuristic?: boolean;
}

export interface DueItem {
  obligation: Obligation;
  periodLabel: string;
  dueDate: string;
  eFilingDate?: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthLabel(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, '0')}`;
}

export function monthlyDueDates(
  profile: WorkspaceProfile,
  year: number,
  month1: number,
): DueItem[] {
  const items: DueItem[] = [];
  const next = new Date(Date.UTC(year, month1, 15));
  const paper7 = new Date(Date.UTC(year, month1, 7));
  const label = monthLabel(year, month1);

  if (profile.vatRegistered) {
    items.push({ obligation: 'pp30', periodLabel: label, dueDate: iso(next) });
  }
  if (profile.hasPayroll) {
    items.push({ obligation: 'png1', periodLabel: label, dueDate: iso(paper7), eFilingDate: iso(next) });
  }
  if (profile.hasWhtIndividual) {
    items.push({ obligation: 'png3', periodLabel: label, dueDate: iso(paper7), eFilingDate: iso(next) });
  }
  if (profile.hasWhtJuristic) {
    items.push({ obligation: 'png53', periodLabel: label, dueDate: iso(paper7), eFilingDate: iso(next) });
  }
  return items;
}

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

export function daysUntil(dueDateIso: string, today = new Date()): number {
  const due = new Date(dueDateIso + 'T00:00:00Z');
  const t0 = new Date(iso(today) + 'T00:00:00Z');
  return Math.round((due.getTime() - t0.getTime()) / 86_400_000);
}
