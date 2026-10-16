/**
 * Offline, free keyword-based categorization. Tried BEFORE any AI call to avoid
 * spending tokens on obvious cases ("ปตท." → fuel).
 *
 * Keep the keyword map in sync with packages/tax-core/src/categories.ts.
 * (Edge functions run on Deno and can't bundle the tax-core .js specifiers, so
 *  this is a deliberate, small duplication.)
 */

interface HeuristicRule {
  code: string;
  direction: 'income' | 'expense';
  keywords: string[];
}

const RULES: HeuristicRule[] = [
  { code: '4100', direction: 'income', keywords: ['ขายสินค้า', 'ขายของ'] },
  { code: '4200', direction: 'income', keywords: ['ค่าบริการ', 'consulting'] },
  { code: '5100-01', direction: 'expense', keywords: ['น้ำมัน', 'ปตท', 'ptt', 'เชลล์', 'shell', 'esso', 'caltex', 'bangchak', 'บางจาก', 'fuel'] },
  { code: '5100-02', direction: 'expense', keywords: ['แท็กซี่', 'taxi', 'grab', 'bolt', 'bts', 'mrt', 'รถไฟ', 'flight', 'เครื่องบิน', 'airasia', 'nok air'] },
  { code: '5200', direction: 'expense', keywords: ['ค่าเช่า', 'rent', 'lease', 'เช่าออฟฟิศ', 'เช่าที่'] },
  { code: '5300', direction: 'expense', keywords: ['ค่าไฟ', 'ค่าน้ำ', 'การไฟฟ้า', 'การประปา', 'electricity', 'mea', 'pea'] },
  { code: '5400', direction: 'expense', keywords: ['ais', 'true', 'dtac', 'อินเทอร์เน็ต', 'internet', '3bb', 'โทรศัพท์'] },
  { code: '5500', direction: 'expense', keywords: ['โฆษณา', 'facebook ads', 'google ads', 'tiktok ads', 'meta', 'advertising', 'โปรโมท'] },
  { code: '5600', direction: 'expense', keywords: ['ค่าทนาย', 'audit', 'lawyer', 'ที่ปรึกษา', 'consultant', 'สอบบัญชี', 'ค่าตรวจสอบ'] },
  { code: '5700', direction: 'expense', keywords: ['microsoft', 'google workspace', 'github', 'figma', 'adobe', 'aws', 'subscription', 'canva', 'notion', 'slack'] },
  { code: '5800', direction: 'expense', keywords: ['ร้านอาหาร', 'restaurant', 'รับรอง', 'อาหาร', 'กาแฟ', 'starbucks', 'cafe'] },
  { code: '5900', direction: 'expense', keywords: ['ออฟฟิศเมท', 'officemate', 'b2s', 'กระดาษ', 'หมึก', 'stationery', 'เครื่องเขียน'] },
  { code: '6100', direction: 'expense', keywords: ['เงินเดือน', 'salary', 'payroll', 'ค่าจ้างพนักงาน'] },
  { code: '6200', direction: 'expense', keywords: ['kerry', 'flash', 'j&t', 'ขนส่ง', 'logistic', 'ไปรษณีย์', 'ems'] },
  { code: '9999', direction: 'expense', keywords: ['ค่าปรับ', 'penalty', 'ส่วนตัว'] },
];

export interface HeuristicGuess {
  code: string;
  confidence: number;
  matchedKeyword: string;
}

/**
 * Returns a category code guess, or null if no keyword matched.
 * Confidence is fixed at 0.6 — high enough to use, low enough that the UI
 * still lets the user override.
 */
export function heuristicCategorize(
  description: string,
  counterpartyName?: string | null,
): HeuristicGuess | null {
  const haystack = `${description} ${counterpartyName ?? ''}`.toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw.toLowerCase())) {
        return { code: rule.code, confidence: 0.6, matchedKeyword: kw };
      }
    }
  }
  return null;
}
