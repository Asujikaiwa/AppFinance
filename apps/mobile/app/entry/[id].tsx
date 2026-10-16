import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { useWorkspace } from '../../stores/workspace';

interface Category {
  id: string;
  code: string;
  name_th: string;
  direction: string;
}

const docTypes = [
  { key: 'tax_invoice_full', label: 'ใบกำกับเต็ม' },
  { key: 'tax_invoice_abbr', label: 'ใบกำกับย่อ' },
  { key: 'receipt', label: 'ใบเสร็จ' },
  { key: 'invoice', label: 'ใบแจ้งหนี้' },
  { key: 'other', label: 'อื่น ๆ' },
] as const;

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = useWorkspace((s) => s.active);

  const [form, setForm] = useState({
    description: '',
    counterparty_name: '',
    counterparty_tax_id: '',
    doc_number: '',
    doc_type: 'receipt',
    entry_date: '',
    amount_excl_vat: '',
    vat_amount: '',
    wht_amount: '',
    category_id: '' as string | null,
    status: 'draft' as 'draft' | 'confirmed' | 'locked',
    direction: 'expense' as 'income' | 'expense',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['entry', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('entries').select('*').eq('id', id).single();
      if (error) throw error;
      // The column holds only a mask (migration 0011); load the real TIN for editing.
      if (data.counterparty_tax_id) {
        const { data: revealed, error: rErr } = await supabase.rpc('reveal_entry_tax_ids', {
          p_entry_ids: [id],
        });
        if (rErr) throw rErr;
        data.counterparty_tax_id = revealed?.[0]?.tax_id ?? data.counterparty_tax_id;
      }
      return data;
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['categories', active?.id, entry?.direction],
    enabled: !!active && !!entry,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, code, name_th, direction')
        .eq('workspace_id', active!.id)
        .eq('direction', entry!.direction)
        .order('code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  useEffect(() => {
    if (!entry) return;
    setForm({
      description: entry.description ?? '',
      counterparty_name: entry.counterparty_name ?? '',
      counterparty_tax_id: entry.counterparty_tax_id ?? '',
      doc_number: entry.doc_number ?? '',
      doc_type: entry.doc_type ?? 'receipt',
      entry_date: entry.entry_date ?? '',
      amount_excl_vat: (entry.amount_excl_vat / 100).toFixed(2),
      vat_amount: (entry.vat_amount / 100).toFixed(2),
      wht_amount: (entry.wht_amount / 100).toFixed(2),
      category_id: entry.category_id,
      status: entry.status,
      direction: entry.direction,
      notes: entry.notes ?? '',
    });
  }, [entry]);

  const reviewItems = useMemo(() => {
    const items: string[] = [];
    if (form.status === 'draft') items.push('รายการนี้ยังเป็นร่างจาก AI');
    if (!form.category_id) items.push('ยังไม่เลือกหมวดบัญชี');
    if (form.doc_type === 'tax_invoice_full' && !form.counterparty_tax_id) {
      items.push('ใบกำกับเต็มควรมีเลขผู้เสียภาษี');
    }
    if (!form.entry_date) items.push('ยังไม่มีวันที่เอกสาร');
    if (!parseFloat(form.amount_excl_vat || '0')) items.push('ยอดก่อน VAT เป็นศูนย์');
    return items;
  }, [form]);

  const locked = form.status === 'locked';

  async function save(nextStatus?: 'draft' | 'confirmed' | 'locked') {
    if (locked && nextStatus !== 'locked') {
      Alert.alert('รายการถูกล็อกแล้ว', 'รายการที่ยื่นแล้วไม่ควรแก้ไขโดยตรง');
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase
        .from('entries')
        .update({
          description: form.description.trim(),
          counterparty_name: form.counterparty_name.trim() || null,
          counterparty_tax_id: form.counterparty_tax_id.replace(/[\s-]/g, '') || null,
          doc_number: form.doc_number.trim() || null,
          doc_type: form.doc_type,
          entry_date: form.entry_date,
          amount_excl_vat: bahtToSatang(form.amount_excl_vat),
          vat_amount: bahtToSatang(form.vat_amount),
          wht_amount: bahtToSatang(form.wht_amount),
          category_id: form.category_id,
          notes: form.notes.trim() || null,
          status: nextStatus ?? form.status,
        })
        .eq('id', id);
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['entry', id] });
      await queryClient.invalidateQueries({ queryKey: ['entries-list'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-entries'] });

      Alert.alert(
        'บันทึกแล้ว',
        nextStatus === 'confirmed'
          ? 'ยืนยันรายการเรียบร้อย'
          : nextStatus === 'locked'
            ? 'ล็อกเป็นรายการยื่นแล้ว'
            : 'บันทึกการแก้ไขเรียบร้อย',
      );
      router.back();
    } catch (e) {
      Alert.alert('ผิดพลาด', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    Alert.alert('ลบรายการ?', 'การลบไม่สามารถย้อนกลับได้', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('entries').delete().eq('id', id);
          if (error) Alert.alert('ผิดพลาด', error.message);
          else router.back();
        },
      },
    ]);
  }

  if (isLoading || !entry) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <ActivityIndicator color="#059669" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <Stack.Screen options={{ title: 'ตรวจรายการ', headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View className="rounded-2xl bg-surface-muted border border-gray-200 p-4 mb-4">
          <Text className="text-sm text-gray-500">สถานะเอกสาร</Text>
          <Text className="text-xl font-semibold mt-1">{statusLabel(form.status)}</Text>
          {reviewItems.length > 0 ? (
            <View className="mt-3">
              {reviewItems.map((item) => (
                <Text key={item} className="text-sm text-amber-700 mt-1">
                  ต้องตรวจ: {item}
                </Text>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-brand-700 mt-3">ข้อมูลหลักครบ พร้อมส่งต่อบัญชี</Text>
          )}
        </View>

        <View className="flex-row gap-2 mb-4">
          <Segment active={form.direction === 'income'} label="รายรับ" />
          <Segment active={form.direction === 'expense'} label="รายจ่าย" />
        </View>

        <Field
          label="รายละเอียด"
          value={form.description}
          onChange={(v) => setForm({ ...form, description: v })}
          editable={!locked}
        />
        <Field
          label="คู่ค้า"
          value={form.counterparty_name}
          onChange={(v) => setForm({ ...form, counterparty_name: v })}
          editable={!locked}
        />
        <Field
          label="เลขผู้เสียภาษี"
          value={form.counterparty_tax_id}
          onChange={(v) => setForm({ ...form, counterparty_tax_id: v })}
          keyboard="number-pad"
          editable={!locked}
        />

        <Text className="text-sm font-medium mb-2">ชนิดเอกสาร</Text>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {docTypes.map((doc) => (
            <Pressable
              key={doc.key}
              disabled={locked}
              onPress={() => setForm({ ...form, doc_type: doc.key })}
              className={`px-3 py-1.5 rounded-full border ${
                form.doc_type === doc.key ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-gray-200'
              }`}
            >
              <Text className={form.doc_type === doc.key ? 'text-white text-sm' : 'text-gray-700 text-sm'}>
                {doc.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field
          label="เลขที่เอกสาร"
          value={form.doc_number}
          onChange={(v) => setForm({ ...form, doc_number: v })}
          editable={!locked}
        />
        <Field
          label="วันที่ (YYYY-MM-DD)"
          value={form.entry_date}
          onChange={(v) => setForm({ ...form, entry_date: v })}
          editable={!locked}
        />
        <Field
          label="ยอดก่อน VAT (บาท)"
          value={form.amount_excl_vat}
          onChange={(v) => setForm({ ...form, amount_excl_vat: v })}
          keyboard="decimal-pad"
          editable={!locked}
        />
        <Field
          label="VAT (บาท)"
          value={form.vat_amount}
          onChange={(v) => setForm({ ...form, vat_amount: v })}
          keyboard="decimal-pad"
          editable={!locked}
        />
        <Field
          label="หัก ณ ที่จ่าย (บาท)"
          value={form.wht_amount}
          onChange={(v) => setForm({ ...form, wht_amount: v })}
          keyboard="decimal-pad"
          editable={!locked}
        />

        <Text className="text-sm font-medium mb-2">หมวดบัญชี</Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {(categories ?? []).map((c) => (
            <Pressable
              key={c.id}
              disabled={locked}
              onPress={() => setForm({ ...form, category_id: c.id })}
              className={`px-3 py-1.5 rounded-full border ${
                form.category_id === c.id ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-gray-200'
              }`}
            >
              <Text className={form.category_id === c.id ? 'text-white text-sm' : 'text-gray-700 text-sm'}>
                {c.name_th}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field
          label="หมายเหตุสำหรับบัญชี"
          value={form.notes}
          onChange={(v) => setForm({ ...form, notes: v })}
          editable={!locked}
          multiline
        />

        {!locked ? (
          <>
            <Pressable
              onPress={() => save('confirmed')}
              disabled={busy}
              className={`rounded-xl py-3 mb-3 ${busy ? 'bg-gray-300' : 'bg-brand-500'}`}
            >
              <Text className="text-white text-center font-semibold">ยืนยันและพร้อมส่งบัญชี</Text>
            </Pressable>

            <Pressable
              onPress={() => save()}
              disabled={busy}
              className="rounded-xl py-3 mb-3 bg-surface-muted border border-gray-200"
            >
              <Text className="text-center font-semibold">บันทึกการแก้ไข</Text>
            </Pressable>

            {form.status === 'confirmed' ? (
              <Pressable
                onPress={() => save('locked')}
                disabled={busy}
                className="rounded-xl py-3 mb-3 bg-gray-900"
              >
                <Text className="text-white text-center font-semibold">ทำเครื่องหมายว่ายื่นแล้ว</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={remove} disabled={busy} className="py-3">
              <Text className="text-center text-red-500">ลบรายการ</Text>
            </Pressable>
          </>
        ) : (
          <Text className="text-center text-gray-500 py-4">
            รายการนี้ถูกล็อกแล้ว เพราะถูกนับรวมในชุดเอกสารที่ยื่นหรือส่งบัญชีแล้ว
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboard,
  editable = true,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard?: 'default' | 'number-pad' | 'decimal-pad';
  editable?: boolean;
  multiline?: boolean;
}) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-medium mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard ?? 'default'}
        editable={editable}
        multiline={multiline}
        className={`border border-gray-300 rounded-xl px-4 py-3 ${
          editable ? 'bg-white' : 'bg-gray-100 text-gray-500'
        }`}
      />
    </View>
  );
}

function Segment({ active, label }: { active: boolean; label: string }) {
  return (
    <View className={`flex-1 rounded-xl py-2 ${active ? 'bg-brand-50 border border-brand-100' : 'bg-gray-50'}`}>
      <Text className={`text-center text-sm font-medium ${active ? 'text-brand-700' : 'text-gray-400'}`}>
        {label}
      </Text>
    </View>
  );
}

function statusLabel(status: 'draft' | 'confirmed' | 'locked') {
  return {
    draft: 'รอตรวจ',
    confirmed: 'ยืนยันแล้ว',
    locked: 'ยื่นแล้ว / ล็อกแล้ว',
  }[status];
}

function bahtToSatang(value: string) {
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
