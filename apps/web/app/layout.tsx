import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'AppFinance - บันทึกและคำนวณภาษีไทยด้วย AI',
  description:
    'ถ่ายใบเสร็จหรือพิมพ์ใน LINE แล้วระบบช่วยบันทึก คำนวณ VAT หัก ณ ที่จ่าย และเตรียมเอกสารภาษี',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
