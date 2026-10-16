import { formatTHB } from '@appfinance/tax-core';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { createClient } from '../../lib/supabase/server';

type Entry = {
  id: string;
  direction: 'income' | 'expense';
  entry_date: string;
  description: string;
  counterparty_name: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  wht_amount: number;
  status: 'draft' | 'confirmed' | 'locked';
  doc_type: string;
  counterparty_tax_id: string | null;
  category_id: string | null;
};

export default async function DashboardPage(): Promise<ReactElement> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, kind, vat_registered')
    .order('created_at', { ascending: true });

  const active = workspaces?.[0];
  const year = new Date().getFullYear();

  const { data: entries } = active
    ? await supabase
        .from('entries')
        .select(
          'id, direction, entry_date, description, counterparty_name, amount_excl_vat, vat_amount, wht_amount, status, doc_type, counterparty_tax_id, category_id',
        )
        .eq('workspace_id', active.id)
        .gte('entry_date', `${year}-01-01`)
        .order('entry_date', { ascending: false })
        .limit(300)
    : { data: [] };

  const totals = { income: 0, expense: 0, outVat: 0, inVat: 0, wht: 0, drafts: 0, missing: 0 };
  for (const e of (entries ?? []) as Entry[]) {
    if (e.status === 'draft') totals.drafts += 1;
    if (e.status !== 'locked' && (e.doc_type === 'other' || !e.counterparty_tax_id || !e.category_id)) {
      totals.missing += 1;
    }
    if (e.direction === 'income') {
      totals.income += e.amount_excl_vat;
      totals.outVat += e.vat_amount;
    } else {
      totals.expense += e.amount_excl_vat;
      totals.inVat += e.vat_amount;
      totals.wht += e.wht_amount;
    }
  }

  const reviewEntries = ((entries ?? []) as Entry[])
    .filter((e) => e.status === 'draft' || e.doc_type === 'other' || !e.counterparty_tax_id || !e.category_id)
    .slice(0, 8);

  const { data: reminders } = active
    ? await supabase
        .from('reminders')
        .select('obligation, period_label, due_date')
        .eq('workspace_id', active.id)
        .eq('status', 'pending')
        .order('due_date', { ascending: true })
        .limit(5)
    : { data: [] };

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-sm text-gray-500">Workspace</p>
          <h1 className="text-2xl font-bold">{active?.name ?? 'ยังไม่มีกิจการ'}</h1>
          {active ? (
            <p className="text-sm text-gray-500 mt-1">
              {active.kind === 'personal' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}
              {active.vat_registered ? ' · จด VAT' : ' · ไม่ได้จด VAT'}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <a className="rounded-lg bg-brand-500 px-4 py-2 text-white font-semibold" href="/dashboard">
            รีเฟรช
          </a>
        </div>
      </div>

      <section className="rounded-lg border border-brand-100 bg-brand-50 p-5 mb-6">
        <h2 className="font-semibold text-brand-800">งานที่ควรจัดการวันนี้</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill label={`รอตรวจ ${totals.drafts}`} tone={totals.drafts ? 'warn' : 'ok'} />
          <Pill label={`เอกสารขาด ${totals.missing}`} tone={totals.missing ? 'warn' : 'ok'} />
          <Pill label={`กำหนดยื่น ${reminders?.length ?? 0}`} tone="neutral" />
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4 mb-8">
        <Kpi label="รายได้ปีนี้" value={formatTHB(totals.income)} />
        <Kpi label="รายจ่ายปีนี้" value={formatTHB(totals.expense)} />
        <Kpi label="กำไรประมาณการ" value={formatTHB(totals.income - totals.expense)} highlight />
        <Kpi label="VAT ขาย" value={formatTHB(totals.outVat)} />
        <Kpi label="VAT ซื้อ" value={formatTHB(totals.inVat)} />
        <Kpi label="VAT สุทธิ" value={formatTHB(totals.outVat - totals.inVat)} highlight />
      </section>

      <section className="grid lg:grid-cols-[1fr_360px] gap-8">
        <div>
          <h2 className="text-lg font-semibold mb-3">รายการที่ต้องตรวจ</h2>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {reviewEntries.length === 0 ? (
              <p className="text-gray-400 text-sm p-4">ไม่มีรายการค้างตรวจ</p>
            ) : (
              reviewEntries.map((entry) => (
                <div key={entry.id} className="p-4 flex justify-between gap-4">
                  <div>
                    <p className="font-medium">{entry.description || entry.counterparty_name || 'ไม่มีรายละเอียด'}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {entry.entry_date} · {entry.status === 'draft' ? 'รอตรวจจาก AI' : reviewReason(entry)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap">
                    {entry.direction === 'income' ? '+' : '-'}
                    {formatTHB(entry.amount_excl_vat + entry.vat_amount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">กำหนดยื่นใกล้ถึง</h2>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {(reminders ?? []).length === 0 ? (
              <p className="text-gray-400 text-sm p-4">ยังไม่มีกำหนดเตือน</p>
            ) : (
              (reminders ?? []).map((r, i) => (
                <div key={i} className="p-4 flex justify-between gap-4">
                  <span className="font-medium">
                    {r.obligation.toUpperCase()} · {r.period_label}
                  </span>
                  <span className="text-gray-500">{r.due_date}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-5 ${highlight ? 'bg-brand-50 border border-brand-100' : 'bg-gray-50'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold ${highlight ? 'text-brand-700' : ''}`}>{value}</p>
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'neutral' }) {
  const style = {
    ok: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    neutral: 'bg-white text-gray-600',
  }[tone];
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${style}`}>{label}</span>;
}

function reviewReason(entry: Entry) {
  if (!entry.category_id) return 'ยังไม่เลือกหมวด';
  if (!entry.counterparty_tax_id) return 'ไม่มีเลขผู้เสียภาษี';
  if (entry.doc_type === 'other') return 'ชนิดเอกสารยังไม่ชัดเจน';
  return 'ข้อมูลยังไม่ครบ';
}
