import type { EntryDirection, WHTCategory } from './types';

/**
 * Default chart of accounts seeded for every new workspace.
 * Codes loosely follow common Thai SME bookkeeping conventions; firms can override.
 */
export interface CategorySeed {
  readonly code: string;
  readonly nameTh: string;
  readonly nameEn: string;
  readonly direction: EntryDirection;
  readonly deductible: boolean;
  readonly vatApplicable: boolean;
  readonly defaultWhtCategory?: WHTCategory;
  /** Keywords used by heuristic categorizer (fallback before AI) */
  readonly keywords: ReadonlyArray<string>;
}

export const DEFAULT_CATEGORIES: ReadonlyArray<CategorySeed> = [
  // === INCOME ===
  {
    code: '4100',
    nameTh: 'รายได้จากการขายสินค้า',
    nameEn: 'Sales revenue',
    direction: 'income',
    deductible: false,
    vatApplicable: true,
    keywords: ['ขาย', 'sale', 'invoice'],
  },
  {
    code: '4200',
    nameTh: 'รายได้ค่าบริการ',
    nameEn: 'Service revenue',
    direction: 'income',
    deductible: false,
    vatApplicable: true,
    keywords: ['บริการ', 'service', 'consulting', 'ค่าจ้าง'],
  },
  {
    code: '4900',
    nameTh: 'รายได้อื่นๆ',
    nameEn: 'Other income',
    direction: 'income',
    deductible: false,
    vatApplicable: false,
    keywords: ['อื่นๆ'],
  },

  // === COST / EXPENSE ===
  {
    code: '5100-01',
    nameTh: 'ค่าน้ำมันรถ',
    nameEn: 'Fuel',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    keywords: ['น้ำมัน', 'ปตท', 'เชลล์', 'shell', 'esso', 'caltex', 'bangchak', 'fuel'],
  },
  {
    code: '5100-02',
    nameTh: 'ค่าเดินทาง',
    nameEn: 'Travel',
    direction: 'expense',
    deductible: true,
    vatApplicable: false,
    keywords: ['แท็กซี่', 'taxi', 'grab', 'bts', 'mrt', 'รถไฟ', 'flight', 'เครื่องบิน'],
  },
  {
    code: '5200',
    nameTh: 'ค่าเช่า',
    nameEn: 'Rent',
    direction: 'expense',
    deductible: true,
    vatApplicable: false,
    defaultWhtCategory: 'rent',
    keywords: ['ค่าเช่า', 'rent', 'lease', 'เช่าออฟฟิศ'],
  },
  {
    code: '5300',
    nameTh: 'ค่าสาธารณูปโภค',
    nameEn: 'Utilities',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    keywords: ['ค่าไฟ', 'ค่าน้ำ', 'การไฟฟ้า', 'การประปา', 'electricity', 'water'],
  },
  {
    code: '5400',
    nameTh: 'ค่าโทรศัพท์/อินเทอร์เน็ต',
    nameEn: 'Telecom / Internet',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    keywords: ['ais', 'true', 'dtac', 'อินเทอร์เน็ต', 'internet', '3bb'],
  },
  {
    code: '5500',
    nameTh: 'ค่าโฆษณาและประชาสัมพันธ์',
    nameEn: 'Advertising',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    defaultWhtCategory: 'advertising',
    keywords: ['โฆษณา', 'facebook ads', 'google ads', 'tiktok ads', 'meta', 'advertising'],
  },
  {
    code: '5600',
    nameTh: 'ค่าบริการวิชาชีพ',
    nameEn: 'Professional fees',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    defaultWhtCategory: 'service_corporate',
    keywords: ['ค่าทนาย', 'ค่าตรวจสอบ', 'audit', 'lawyer', 'ที่ปรึกษา', 'consultant'],
  },
  {
    code: '5700',
    nameTh: 'ค่าซอฟต์แวร์/SaaS',
    nameEn: 'Software / SaaS',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    keywords: ['microsoft', 'google workspace', 'github', 'figma', 'adobe', 'aws', 'subscription'],
  },
  {
    code: '5800',
    nameTh: 'ค่าอาหารและรับรอง',
    nameEn: 'Meals & entertainment',
    direction: 'expense',
    deductible: true,
    vatApplicable: false,
    keywords: ['ร้านอาหาร', 'restaurant', 'รับรอง', 'meal', 'อาหาร'],
  },
  {
    code: '5900',
    nameTh: 'ค่าวัสดุสำนักงาน',
    nameEn: 'Office supplies',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    keywords: ['ออฟฟิศเมท', 'b2s', 'officemate', 'กระดาษ', 'หมึก', 'stationery'],
  },
  {
    code: '6100',
    nameTh: 'เงินเดือนพนักงาน',
    nameEn: 'Salary',
    direction: 'expense',
    deductible: true,
    vatApplicable: false,
    keywords: ['เงินเดือน', 'salary', 'payroll'],
  },
  {
    code: '6200',
    nameTh: 'ค่าขนส่ง',
    nameEn: 'Transport / Logistics',
    direction: 'expense',
    deductible: true,
    vatApplicable: true,
    defaultWhtCategory: 'transport',
    keywords: ['kerry', 'flash', 'j&t', 'ขนส่ง', 'logistic'],
  },
  {
    code: '9999',
    nameTh: 'รายจ่ายต้องห้าม',
    nameEn: 'Non-deductible expense',
    direction: 'expense',
    deductible: false,
    vatApplicable: false,
    keywords: ['ค่าปรับ', 'penalty', 'ส่วนตัว'],
  },
];

/**
 * Heuristic category guess based on free-text description.
 * This is the fallback before AI categorization — fast and offline.
 */
export interface CategoryGuess {
  readonly category: CategorySeed;
  readonly confidence: number; // 0–1
  readonly matchedKeyword?: string;
}

export function heuristicCategorize(
  description: string,
  catalog: ReadonlyArray<CategorySeed> = DEFAULT_CATEGORIES,
): CategoryGuess | null {
  const lower = description.toLowerCase();
  for (const cat of catalog) {
    for (const kw of cat.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          category: cat,
          confidence: 0.6,
          matchedKeyword: kw,
        };
      }
    }
  }
  return null;
}
