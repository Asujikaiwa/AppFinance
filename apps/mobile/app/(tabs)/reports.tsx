import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatTHB } from '@appfinance/tax-core';

import { api, monthRange, yearRange } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useWorkspace } from '../../stores/workspace';

export default function ReportsScreen() {
  const active = useWorkspace((s) => s.active);
  const [busy, setBusy] = useState<string | null>(null);

  const now = new Date();
  const year = now.getFullYear();
  const month1 = now.getMonth() + 1;

  const { data: readiness } = useQuery({
    queryKey: ['report-readiness', active?.id, year, month1],
    enabled: !!active,
    queryFn: async () => {
      const [start, end] = monthRange(year, month1);
      const { data, error } = await supabase
        .from('entries')
        .select('status, doc_type, counterparty_tax_id, category_id')
        .eq('workspace_id', active!.id)
        .gte('entry_date', start)
        .lte('entry_date', end);
      if (error) throw error;
      const rows = data ?? [];
      return {
        total: rows.length,
        drafts: rows.filter((r) => r.status === 'draft').length,
        missingDocs: rows.filter((r) => r.doc_type === 'other' || !r.counterparty_tax_id || !r.category_id).length,
      };
    },
  });

  async function run(kind: 'pp30' | 'accountant_pack') {
    if (!active) return;
    const [start, end] = kind === 'pp30' ? monthRange(year, month1) : yearRange(year);
    setBusy(kind);
    try {
      const res = await api.generateReport(active.id, kind, start, end);
      const net = res.summary.netVatPayable;
      Alert.alert(
        kind === 'pp30' ? 'สร้าง ภ.พ.30 สำเร็จ' : 'สร้างชุดส่งบัญชีสำเร็จ',
        kind === 'pp30'
          ? `รวม ${res.entryCount} รายการ\nVAT ขาย ${formatTHB(res.summary.outputVat * 100)}\nVAT ซื้อ ${formatTHB(res.summary.inputVat * 100)}\n${net >= 0 ? 'ต้องชำระ' : 'ชำระเกิน'} ${formatTHB(Math.abs(net) * 100)}`
          : `รวม ${res.entryCount} รายการในชุดเอกสาร พร้อมไฟล์ Excel และใบเสร็จที่เกี่ยวข้อง`,
        [
          { text: 'ปิด', style: 'cancel' },
          { text: 'เปิดไฟล์', onPress: () => Linking.openURL(res.url) },
        ],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('ผิดพลาด', msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text className="text-2xl font-bold mb-1">รายงานและส่งบัญชี</Text>
        <Text className="text-sm text-gray-500 mb-5">
          สร้างไฟล์จากรายการที่ยืนยันแล้ว และเปิดลิงก์ดาวน์โหลดเพื่อส่งต่อได้ทันที
        </Text>

        <View className="rounded-2xl bg-brand-50 border border-brand-100 p-4 mb-4">
          <Text className="text-sm text-brand-700 font-semibold">ความพร้อมงวดนี้</Text>
          <View className="flex-row gap-2 mt-3">
            <Readiness label={`ทั้งหมด ${readiness?.total ?? 0}`} />
            <Readiness label={`รอตรวจ ${readiness?.drafts ?? 0}`} warning={(readiness?.drafts ?? 0) > 0} />
            <Readiness
              label={`เอกสารขาด ${readiness?.missingDocs ?? 0}`}
              warning={(readiness?.missingDocs ?? 0) > 0}
            />
          </View>
        </View>

        <ReportCard
          title="ภ.พ.30 รายเดือน"
          sub={`งวด ${month1}/${year} · รายงานภาษีซื้อ-ขายและยอด VAT สุทธิ`}
          loading={busy === 'pp30'}
          disabled={!active || busy !== null}
          onPress={() => run('pp30')}
        />

        <ReportCard
          title="ชุดส่งสำนักงานบัญชี"
          sub={`ปี ${year} · Excel ทุกชีต + ภาษีหัก ณ ที่จ่าย + รูปใบเสร็จ`}
          loading={busy === 'accountant_pack'}
          disabled={!active || busy !== null}
          onPress={() => run('accountant_pack')}
        />

        <View className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <Text className="text-sm text-amber-800 font-semibold">ก่อนส่งจริงควรตรวจ 3 จุด</Text>
          <Text className="text-sm text-amber-700 mt-1">ยอด VAT, เลขผู้เสียภาษี และหมวดบัญชีของรายการรอตรวจ</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportCard({
  title,
  sub,
  loading,
  disabled,
  onPress,
}: {
  title: string;
  sub: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-2xl p-4 mb-3 border ${
        disabled ? 'bg-gray-50 border-gray-100' : 'bg-surface-muted border-gray-200'
      }`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold">{title}</Text>
          <Text className="text-sm text-gray-500 mt-1">{sub}</Text>
        </View>
        {loading ? (
          <ActivityIndicator color="#059669" />
        ) : (
          <Text className="text-brand-600 font-semibold">สร้าง</Text>
        )}
      </View>
    </Pressable>
  );
}

function Readiness({ label, warning }: { label: string; warning?: boolean }) {
  return (
    <View className={`px-3 py-2 rounded-xl ${warning ? 'bg-amber-100' : 'bg-white'}`}>
      <Text className={`text-xs font-medium ${warning ? 'text-amber-700' : 'text-brand-700'}`}>
        {label}
      </Text>
    </View>
  );
}
