/**
 * Pure report builders. Take DB entry rows, produce the data structures behind
 * ภ.พ.30 (VAT return) and the supporting reports an accountant files.
 *
 * All amounts come in as integer satang and are converted to baht (number with
 * 2 decimals) for the spreadsheet, so accountants can sum/format normally.
 *
 * Deno-native (no tax-core import). VAT logic mirrors tax-core/vat.ts.
 */

export interface EntryRow {
  direction: 'income' | 'expense';
  entry_date: string;
  doc_type: string;
  doc_number: string | null;
  counterparty_name: string | null;
  counterparty_tax_id: string | null;
  description: string;
  amount_excl_vat: number; // satang
  vat_amount: number; // satang
  wht_rate: number | null;
  wht_amount: number; // satang
  // categories joined as { name_th }
  categories?: { name_th?: string } | null;
}

const baht = (satang: number): number => Math.round(satang) / 100;

// ---------------------------------------------------------------------------
// ภ.พ.30 — VAT return summary
// ---------------------------------------------------------------------------
export interface Pp30Summary {
  taxableSalesExcl: number; // baht
  outputVat: number;
  purchasesExcl: number;
  inputVat: number;
  netVatPayable: number; // positive = pay, negative = carry-forward credit
  salesCount: number;
  purchaseCount: number;
}

export function buildPp30Summary(entries: EntryRow[]): Pp30Summary {
  let taxableSalesExcl = 0,
    outputVat = 0,
    purchasesExcl = 0,
    inputVat = 0,
    salesCount = 0,
    purchaseCount = 0;

  for (const e of entries) {
    if (e.direction === 'income') {
      taxableSalesExcl += e.amount_excl_vat;
      outputVat += e.vat_amount;
      if (e.vat_amount > 0) salesCount++;
    } else {
      // Only purchases with a proper full tax invoice can claim input VAT.
      if (e.vat_amount > 0 && e.doc_type === 'tax_invoice_full') {
        purchasesExcl += e.amount_excl_vat;
        inputVat += e.vat_amount;
        purchaseCount++;
      }
    }
  }

  return {
    taxableSalesExcl: baht(taxableSalesExcl),
    outputVat: baht(outputVat),
    purchasesExcl: baht(purchasesExcl),
    inputVat: baht(inputVat),
    netVatPayable: baht(outputVat - inputVat),
    salesCount,
    purchaseCount,
  };
}

/** ภ.พ.30 summary as a sheet (array-of-arrays). */
export function pp30SummaryAoA(s: Pp30Summary, periodLabel: string): (string | number)[][] {
  return [
    ['แบบ ภ.พ.30 — สรุปภาษีมูลค่าเพิ่ม', ''],
    ['งวดภาษี', periodLabel],
    ['', ''],
    ['รายการ', 'จำนวนเงิน (บาท)'],
    ['ยอดขายที่ต้องเสียภาษี', s.taxableSalesExcl],
    ['ภาษีขาย (Output VAT)', s.outputVat],
    ['ยอดซื้อที่มีสิทธิ์ขอคืน', s.purchasesExcl],
    ['ภาษีซื้อ (Input VAT)', s.inputVat],
    ['', ''],
    [s.netVatPayable >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีชำระเกิน (ยกไปงวดหน้า)', Math.abs(s.netVatPayable)],
    ['', ''],
    ['จำนวนใบกำกับภาษีขาย', s.salesCount],
    ['จำนวนใบกำกับภาษีซื้อ', s.purchaseCount],
  ];
}

// ---------------------------------------------------------------------------
// รายงานภาษีขาย / รายงานภาษีซื้อ (line-by-line VAT reports)
// ---------------------------------------------------------------------------
const VAT_REPORT_HEADER = [
  'ลำดับ',
  'วันที่',
  'เลขที่ใบกำกับ',
  'ชื่อผู้ประกอบการ',
  'เลขประจำตัวผู้เสียภาษี',
  'มูลค่าสินค้า/บริการ',
  'ภาษีมูลค่าเพิ่ม',
];

export function salesReportAoA(entries: EntryRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [['รายงานภาษีขาย'], VAT_REPORT_HEADER];
  let i = 0;
  let totExcl = 0,
    totVat = 0;
  for (const e of entries) {
    if (e.direction !== 'income' || e.vat_amount <= 0) continue;
    i++;
    totExcl += e.amount_excl_vat;
    totVat += e.vat_amount;
    rows.push([
      i,
      e.entry_date,
      e.doc_number ?? '-',
      e.counterparty_name ?? '-',
      e.counterparty_tax_id ?? '-',
      baht(e.amount_excl_vat),
      baht(e.vat_amount),
    ]);
  }
  rows.push(['', '', '', '', 'รวม', baht(totExcl), baht(totVat)]);
  return rows;
}

export function purchaseReportAoA(entries: EntryRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [['รายงานภาษีซื้อ'], VAT_REPORT_HEADER];
  let i = 0;
  let totExcl = 0,
    totVat = 0;
  for (const e of entries) {
    if (e.direction !== 'expense' || e.vat_amount <= 0 || e.doc_type !== 'tax_invoice_full')
      continue;
    i++;
    totExcl += e.amount_excl_vat;
    totVat += e.vat_amount;
    rows.push([
      i,
      e.entry_date,
      e.doc_number ?? '-',
      e.counterparty_name ?? '-',
      e.counterparty_tax_id ?? '-',
      baht(e.amount_excl_vat),
      baht(e.vat_amount),
    ]);
  }
  rows.push(['', '', '', '', 'รวม', baht(totExcl), baht(totVat)]);
  return rows;
}

// ---------------------------------------------------------------------------
// WHT report (ภ.ง.ด.3/53)
// ---------------------------------------------------------------------------
export function whtReportAoA(entries: EntryRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['รายงานภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53)'],
    ['ลำดับ', 'วันที่', 'ผู้รับเงิน', 'เลขผู้เสียภาษี', 'ฐานเงินได้', 'อัตรา %', 'ภาษีที่หัก'],
  ];
  let i = 0;
  let totBase = 0,
    totWht = 0;
  for (const e of entries) {
    if (e.wht_amount <= 0) continue;
    i++;
    totBase += e.amount_excl_vat;
    totWht += e.wht_amount;
    rows.push([
      i,
      e.entry_date,
      e.counterparty_name ?? '-',
      e.counterparty_tax_id ?? '-',
      baht(e.amount_excl_vat),
      e.wht_rate ? Math.round(e.wht_rate * 10000) / 100 : 0,
      baht(e.wht_amount),
    ]);
  }
  rows.push(['', '', '', '', 'รวม', '', baht(totWht)]);
  return rows;
}

// ---------------------------------------------------------------------------
// All entries (full ledger)
// ---------------------------------------------------------------------------
export function allEntriesAoA(entries: EntryRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [
    [
      'วันที่',
      'ทิศทาง',
      'ประเภทเอกสาร',
      'เลขที่',
      'คู่ค้า',
      'เลขผู้เสียภาษี',
      'รายละเอียด',
      'หมวด',
      'มูลค่า',
      'VAT',
      'WHT',
    ],
  ];
  for (const e of entries) {
    rows.push([
      e.entry_date,
      e.direction === 'income' ? 'รายรับ' : 'รายจ่าย',
      e.doc_type,
      e.doc_number ?? '-',
      e.counterparty_name ?? '-',
      e.counterparty_tax_id ?? '-',
      e.description,
      e.categories?.name_th ?? '-',
      baht(e.amount_excl_vat),
      baht(e.vat_amount),
      baht(e.wht_amount),
    ]);
  }
  return rows;
}
