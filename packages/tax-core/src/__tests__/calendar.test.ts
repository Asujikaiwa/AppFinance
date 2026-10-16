import { describe, expect, it } from 'vitest';
import {
  annualDueDates,
  daysUntil,
  monthlyDueDates,
  type WorkspaceProfile,
} from '../calendar.js';

const vatCorp: WorkspaceProfile = {
  kind: 'corporate',
  vatRegistered: true,
  fiscalYearStartMonth: 1,
  hasPayroll: true,
  hasWhtJuristic: true,
};

describe('monthlyDueDates', () => {
  it('VAT (ภ.พ.30) for May 2026 is due June 15', () => {
    const items = monthlyDueDates(vatCorp, 2026, 5);
    const pp30 = items.find((i) => i.obligation === 'pp30');
    expect(pp30?.dueDate).toBe('2026-06-15');
  });

  it('WHT paper deadline is the 7th, e-filing the 15th', () => {
    const items = monthlyDueDates(vatCorp, 2026, 5);
    const png1 = items.find((i) => i.obligation === 'png1');
    expect(png1?.dueDate).toBe('2026-06-07');
    expect(png1?.eFilingDate).toBe('2026-06-15');
  });

  it('December rolls into next January', () => {
    const items = monthlyDueDates(vatCorp, 2026, 12);
    const pp30 = items.find((i) => i.obligation === 'pp30');
    expect(pp30?.dueDate).toBe('2027-01-15');
  });

  it('non-VAT workspace gets no ภ.พ.30', () => {
    const items = monthlyDueDates(
      { kind: 'personal', vatRegistered: false, fiscalYearStartMonth: 1 },
      2026,
      5,
    );
    expect(items.find((i) => i.obligation === 'pp30')).toBeUndefined();
  });
});

describe('annualDueDates', () => {
  it('personal PIT due March 31 next year', () => {
    const items = annualDueDates(
      { kind: 'personal', vatRegistered: false, fiscalYearStartMonth: 1 },
      2025,
    );
    expect(items[0]?.dueDate).toBe('2026-03-31');
  });

  it('corporate CIT (ภ.ง.ด.50) due 150 days after calendar FY end', () => {
    const items = annualDueDates(vatCorp, 2025);
    const png50 = items.find((i) => i.obligation === 'png50');
    // FY end 2025-12-31 + 150 days = 2026-05-30
    expect(png50?.dueDate).toBe('2026-05-30');
  });
});

describe('daysUntil', () => {
  it('counts forward days', () => {
    const today = new Date('2026-05-20T10:00:00Z');
    expect(daysUntil('2026-05-27', today)).toBe(7);
    expect(daysUntil('2026-05-21', today)).toBe(1);
    expect(daysUntil('2026-05-20', today)).toBe(0);
  });
});
