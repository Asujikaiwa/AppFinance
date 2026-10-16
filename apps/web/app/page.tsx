import Link from 'next/link';
import type { ReactElement } from 'react';

const features = [
  {
    title: 'บันทึกเร็วจาก LINE หรือมือถือ',
    desc: 'ถ่ายใบเสร็จ พิมพ์รายการสั้น ๆ หรือส่งรูปจากแชตให้ AI อ่านเป็นรายการบัญชี',
  },
  {
    title: 'ตรวจเอกสารก่อนส่งบัญชี',
    desc: 'เช็กสถานะรอตรวจ หมวดบัญชี เลขผู้เสียภาษี VAT และหัก ณ ที่จ่ายในหน้ารายการเดียว',
  },
  {
    title: 'รายงานพร้อมส่งต่อ',
    desc: 'สร้าง ภ.พ.30 และชุดเอกสารประจำปีเป็นไฟล์ที่ส่งสำนักงานบัญชีต่อได้ทันที',
  },
];

export default function Landing(): ReactElement {
  return (
    <main className="min-h-screen bg-white">
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-brand-600 mb-3">AppFinance</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-950">
            งานบัญชีและภาษีไทย สำหรับคนทำงานที่ไม่มีเวลาจัดเอกสารทั้งวัน
          </h1>
          <p className="mt-5 text-lg text-gray-600">
            บันทึกรายรับรายจ่ายจาก LINE มือถือ หรือเว็บ ให้ AI ช่วยอ่านใบเสร็จ
            จัดหมวด คำนวณ VAT และเตือนกำหนดยื่น ก่อนส่งไฟล์ให้บัญชีได้ในไม่กี่คลิก
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={process.env.NEXT_PUBLIC_LINE_ADD_FRIEND_URL ?? '#'}
              className="bg-[#06C755] text-white px-6 py-3 rounded-lg font-semibold"
            >
              เพิ่มเพื่อนใน LINE
            </a>
            <Link href="/login" className="bg-brand-500 text-white px-6 py-3 rounded-lg font-semibold">
              เข้าสู่ระบบบนเว็บ
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 pb-16 max-w-5xl mx-auto grid sm:grid-cols-3 gap-4">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-gray-200 p-5 bg-white">
            <h2 className="font-semibold text-gray-950">{feature.title}</h2>
            <p className="mt-2 text-sm text-gray-600">{feature.desc}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
