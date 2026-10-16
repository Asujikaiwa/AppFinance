import { describe, expect, it } from 'vitest';
import { formatTaxId, validateTaxId, vatFilingDueDate } from '../validators.js';

describe('validateTaxId', () => {
  // Known valid Thai national ID format example (not a real person — synthetic).
  // We will craft one programmatically below for robustness.
  it('rejects non-13-digit input', () => {
    expect(validateTaxId('123')).toBe(false);
    expect(validateTaxId('abcdefghijklm')).toBe(false);
  });

  it('rejects wrong check digit', () => {
    // 1100400000000 — last digit fabricated; almost certainly fails Mod 11
    expect(validateTaxId('1100400000000')).toBe(false);
  });

  it('accepts a programmatically valid ID', () => {
    // Build a valid 13-digit ID: pick 12 digits, compute the check digit.
    const first12 = '123456789012';
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
    const check = (11 - (sum % 11)) % 10;
    const id = first12 + String(check);
    expect(validateTaxId(id)).toBe(true);
  });

  it('strips dashes and spaces', () => {
    const first12 = '123456789012';
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
    const check = (11 - (sum % 11)) % 10;
    const id = first12 + String(check);
    const formatted = `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
    expect(validateTaxId(formatted)).toBe(true);
  });
});

describe('formatTaxId', () => {
  it('formats with dashes', () => {
    expect(formatTaxId('1234567890123')).toBe('1-2345-67890-12-3');
  });
  it('passes through invalid input', () => {
    expect(formatTaxId('abc')).toBe('abc');
  });
});

describe('vatFilingDueDate', () => {
  it('returns the 15th of the next month', () => {
    const due = vatFilingDueDate(new Date(Date.UTC(2026, 4, 31))); // May 31
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-15');
  });
});
