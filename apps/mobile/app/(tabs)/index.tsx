import { useQuery } from '@tanstack/react-query';
import { Link, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatTHB } from '@appfinance/tax-core';

import { supabase } from '../../lib/supabase';
import { useWorkspace } from '../../stores/workspace';

type EntrySummary = {
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

type Reminder = {
  obligation: string;
  period_label: string;
  due_date: string;
};

export default function Dashboard() {
  const active = useWorkspace((s) => s.active);
  const year = new Date().getFullYear();

  const { data: entries } = useQuery({
    queryKey: ['dashboard-entries', active?.id, year],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select(
          'id, direction, entry_date, description, counterparty_name, amount_excl_vat, vat_amount, wht_amount, status, doc_type, counterparty_tax_id, category_id',
        )
        .eq('workspace_id', active!.id)
        .gte('entry_date', `${year}-01-01`)
        .order('entry_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EntrySummary[];
    },
  });

  const { data: reminders } = useQuery({
    queryKey: ['dashboard-reminders', active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminders')
        .select('obligation, period_label, due_date')
        .eq('workspace_id', active!.id)
        .eq('status', 'pending')
        .order('due_date', { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as Reminder[];
    },
  });

  const totals = useMemo(() => {
    const acc = {
      income: 0,
      expense: 0,
      outputVat: 0,
      inputVat: 0,
      wht: 0,
      drafts: 0,
      missingDocs: 0,
      locked: 0,
    };

    for (const e of entries ?? []) {
      if (e.status === 'draft') acc.drafts += 1;
      if (e.status === 'locked') acc.locked += 1;
      if (
        e.status !== 'locked' &&
        (e.doc_type === 'other' || !e.counterparty_tax_id || !e.category_id)
      ) {
        acc.missingDocs += 1;
      }
      if (e.direction === 'income') {
        acc.income += e.amount_excl_vat;
        acc.outputVat += e.vat_amount;
      } else {
        acc.expense += e.amount_excl_vat;
        acc.inputVat += e.vat_amount;
        acc.wht += e.wht_amount;
      }
    }

    return acc;
  }, [entries]);

  const urgentEntries = (entries ?? [])
    .filter(
      (e) =>
        e.status === 'draft' ||
        e.doc_type === 'other' ||
        !e.counterparty_tax_id ||
        !e.category_id,
    )
    .slice(0, 4);

  if (!active) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center px-6">
        <Text className="text-gray-500 text-center">
          ยังไม่มีกิจการ เริ่มจากสร้างพื้นที่ทำงานสำหรับบันทึกรายรับรายจ่ายก่อน
        </Text>
        <Link href="/onboarding" asChild>
          <Pressable className="mt-4 px-4 py-3 rounded-xl bg-brand-500">
            <Text className="text-white font-semibold">สร้างกิจการ</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View className="flex-row items-start justify-between mb-5">
          <View className="flex-1 pr-3">
            <Text className="text-sm text-gray-500">กำลังใช้งาน</Text>
            <Text className="text-2xl font-bold">{active.name}</Text>
            <Text className="text-xs text-gray-500 mt-1">
              {active.kind === 'personal' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}
              {active.vat_registered ? ' · จด VAT' : ' · ไม่ได้จด VAT'}
            </Text>
          </View>
          <Link href="/workspaces" asChild>
            <Pressable className="px-3 py-2 rounded-xl bg-surface-muted border border-gray-200">
              <Text className="text-brand-600 text-sm font-medium">สลับ</Text>
            </Pressable>
          </Link>
        </View>

        <View className="rounded-2xl bg-brand-50 border border-brand-100 p-4 mb-4">
          <Text className="text-sm text-brand-700 font-semibold mb-2">งานที่ควรจัดการวันนี้</Text>
          <View className="flex-row flex-wrap gap-2">
            <StatusPill label={`รอตรวจ ${totals.drafts}`} tone={totals.drafts > 0 ? 'warn' : 'ok'} />
            <StatusPill
              label={`เอกสารขาด ${totals.missingDocs}`}
              tone={totals.missingDocs > 0 ? 'warn' : 'ok'}
            />
            <StatusPill label={`ยื่นแล้ว ${totals.locked}`} tone="neutral" />
          </View>
          <View className="flex-row gap-2 mt-4">
            <QuickAction href="/(tabs)/log" label="ถ่ายใบเสร็จ" primary />
            <QuickAction href="/(tabs)/chat" label="พิมพ์รายการ" />
          </View>
          <View className="flex-row gap-2 mt-2">
            <QuickAction href="/entries?filter=review" label="ตรวจรายการ" />
            <QuickAction href="/(tabs)/reports" label="ส่งให้บัญชี" />
          </View>
        </View>

        <View className="grid gap-3">
          <KPI label="รายได้ปีนี้" value={formatTHB(totals.income)} />
          <KPI label="รายจ่ายปีนี้" value={formatTHB(totals.expense)} />
          <KPI
            label="กำไรประมาณการ"
            value={formatTHB(totals.income - totals.expense)}
            highlight
          />
          <KPI
            label="ภาษีมูลค่าเพิ่มที่ควรเตรียม"
            value={formatTHB(totals.outputVat - totals.inputVat)}
            hint={`VAT ขาย ${formatTHB(totals.outputVat)} · VAT ซื้อ ${formatTHB(totals.inputVat)}`}
            highlight
          />
          <KPI label="ภาษีหัก ณ ที่จ่าย" value={formatTHB(totals.wht)} />
        </View>

        <SectionTitle title="รายการที่ต้องตรวจ" href="/entries?filter=review" />
        {urgentEntries.length === 0 ? (
          <EmptyLine text="ไม่มีรายการค้างตรวจตอนนี้" />
        ) : (
          urgentEntries.map((item) => (
            <Link key={item.id} href={`/entry/${item.id}`} asChild>
              <Pressable className="py-3 border-b border-gray-100">
                <Text className="font-medium" numberOfLines={1}>
                  {item.description || item.counterparty_name || 'ไม่มีรายละเอียด'}
                </Text>
                <Text className="text-xs text-gray-500 mt-1">
                  {item.entry_date} · {item.status === 'draft' ? 'รอตรวจจาก AI' : 'เอกสารยังไม่ครบ'}
                </Text>
              </Pressable>
            </Link>
          ))
        )}

        <SectionTitle title="กำหนดยื่นใกล้ถึง" href="/(tabs)/reports" />
        {(reminders ?? []).length === 0 ? (
          <EmptyLine text="ยังไม่มีกำหนดเตือน" />
        ) : (
          (reminders ?? []).map((r, i) => (
            <View key={`${r.obligation}-${i}`} className="flex-row justify-between py-3 border-b border-gray-100">
              <Text className="font-medium">
                {r.obligation.toUpperCase()} · {r.period_label}
              </Text>
              <Text className="text-gray-500">{r.due_date}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KPI({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <View
      className={`rounded-2xl p-4 mb-3 ${
        highlight ? 'bg-brand-50 border border-brand-100' : 'bg-surface-muted'
      }`}
    >
      <Text className="text-xs text-gray-500 mb-1">{label}</Text>
      <Text className={`text-xl font-semibold ${highlight ? 'text-brand-700' : ''}`}>
        {value}
      </Text>
      {hint ? <Text className="text-xs text-gray-500 mt-1">{hint}</Text> : null}
    </View>
  );
}

function QuickAction({
  href,
  label,
  primary,
}: {
  href: Href<string>;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        className={`flex-1 rounded-xl py-3 ${
          primary ? 'bg-brand-500' : 'bg-white border border-brand-100'
        }`}
      >
        <Text className={`text-center font-semibold ${primary ? 'text-white' : 'text-brand-700'}`}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'neutral' }) {
  const styles = {
    ok: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    neutral: 'bg-gray-100 text-gray-600',
  };
  return (
    <View className={`px-3 py-1.5 rounded-full ${styles[tone]}`}>
      <Text className={`text-xs font-medium ${styles[tone]}`}>{label}</Text>
    </View>
  );
}

function SectionTitle({ title, href }: { title: string; href: Href<string> }) {
  return (
    <View className="flex-row justify-between items-center mt-5 mb-1">
      <Text className="text-lg font-semibold">{title}</Text>
      <Link href={href} asChild>
        <Pressable>
          <Text className="text-brand-600 text-sm font-medium">ดูทั้งหมด</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text className="text-gray-400 text-sm py-3">{text}</Text>;
}
