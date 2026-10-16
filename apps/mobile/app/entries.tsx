import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatTHB } from '@appfinance/tax-core';

import { supabase } from '../lib/supabase';
import { useWorkspace } from '../stores/workspace';

type Filter = 'all' | 'review' | 'draft' | 'confirmed' | 'locked' | 'income' | 'expense';

type EntryListItem = {
  id: string;
  direction: 'income' | 'expense';
  entry_date: string;
  description: string;
  counterparty_name: string | null;
  counterparty_tax_id: string | null;
  doc_type: string;
  doc_number: string | null;
  category_id: string | null;
  amount_total: number;
  status: 'draft' | 'confirmed' | 'locked';
  source: 'manual' | 'chat' | 'ocr' | 'import';
};

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'review', label: 'ต้องตรวจ' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'confirmed', label: 'ยืนยันแล้ว' },
  { key: 'locked', label: 'ยื่นแล้ว' },
  { key: 'income', label: 'รายรับ' },
  { key: 'expense', label: 'รายจ่าย' },
];

export default function EntriesScreen() {
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const active = useWorkspace((s) => s.active);
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'all');
  const [search, setSearch] = useState('');

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ['entries-list', active?.id, filter],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from('entries')
        .select(
          'id, direction, entry_date, description, counterparty_name, counterparty_tax_id, doc_type, doc_number, category_id, amount_total, status, source',
        )
        .eq('workspace_id', active!.id)
        .order('entry_date', { ascending: false })
        .limit(300);

      if (filter === 'draft' || filter === 'confirmed' || filter === 'locked') {
        q = q.eq('status', filter);
      } else if (filter === 'income' || filter === 'expense') {
        q = q.eq('direction', filter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EntryListItem[];
    },
  });

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries ?? []).filter((entry) => {
      const needsReview =
        entry.status === 'draft' ||
        entry.doc_type === 'other' ||
        !entry.counterparty_tax_id ||
        !entry.category_id;
      if (filter === 'review' && !needsReview) return false;
      if (!needle) return true;

      return [
        entry.description,
        entry.counterparty_name,
        entry.doc_number,
        entry.counterparty_tax_id,
        entry.entry_date,
        entry.source,
        entry.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [entries, filter, search]);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <Stack.Screen options={{ title: 'รายการทั้งหมด', headerShown: true }} />

      <View className="px-4 pt-3 pb-2">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ค้นหาร้านค้า เลขเอกสาร จำนวนเงิน หรือวันที่"
          autoCapitalize="none"
          className="border border-gray-300 rounded-xl px-4 py-3 bg-white"
        />
      </View>

      <View className="px-4 pb-2">
        <FlatList
          horizontal
          data={filters}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View className="w-2" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setFilter(item.key)}
              className={`px-3 py-1.5 rounded-full ${
                filter === item.key ? 'bg-brand-500' : 'bg-surface-muted border border-gray-200'
              }`}
            >
              <Text className={filter === item.key ? 'text-white text-sm' : 'text-gray-700 text-sm'}>
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      <FlatList
        data={visibleEntries}
        keyExtractor={(e) => e.id}
        refreshing={isLoading}
        onRefresh={refetch}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListHeaderComponent={
          <Text className="text-xs text-gray-500 mb-2">
            พบ {visibleEntries.length} รายการ · แตะเพื่อแก้ไขหรือตรวจเอกสาร
          </Text>
        }
        ListEmptyComponent={
          <Text className="text-center text-gray-400 mt-10">ไม่พบรายการตามเงื่อนไขนี้</Text>
        }
        renderItem={({ item }) => {
          const needsReview =
            item.status === 'draft' ||
            item.doc_type === 'other' ||
            !item.counterparty_tax_id ||
            !item.category_id;

          return (
            <Link href={`/entry/${item.id}`} asChild>
              <Pressable className="flex-row items-center justify-between py-3 border-b border-gray-100">
                <View className="flex-1 pr-3">
                  <Text className="font-medium" numberOfLines={1}>
                    {item.description || item.counterparty_name || 'ไม่มีรายละเอียด'}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {item.entry_date} · {sourceLabel(item.source)} · {statusLabel(item.status)}
                  </Text>
                  {needsReview ? (
                    <Text className="text-xs text-amber-700 mt-1">
                      ต้องตรวจ: {reviewReason(item)}
                    </Text>
                  ) : null}
                </View>
                <Text
                  className={`font-semibold ${
                    item.direction === 'income' ? 'text-brand-600' : 'text-gray-800'
                  }`}
                >
                  {item.direction === 'income' ? '+' : '-'}
                  {formatTHB(item.amount_total)}
                </Text>
              </Pressable>
            </Link>
          );
        }}
      />
    </SafeAreaView>
  );
}

function statusLabel(status: EntryListItem['status']) {
  return {
    draft: 'รอตรวจ',
    confirmed: 'ยืนยันแล้ว',
    locked: 'ยื่นแล้ว',
  }[status];
}

function sourceLabel(source: EntryListItem['source']) {
  return {
    manual: 'กรอกเอง',
    chat: 'AI',
    ocr: 'OCR',
    import: 'นำเข้า',
  }[source];
}

function reviewReason(item: EntryListItem) {
  if (item.status === 'draft') return 'รายการจาก AI ยังไม่ยืนยัน';
  if (!item.category_id) return 'ยังไม่เลือกหมวด';
  if (!item.counterparty_tax_id) return 'ไม่มีเลขผู้เสียภาษี';
  if (item.doc_type === 'other') return 'ชนิดเอกสารยังไม่ชัดเจน';
  return 'ข้อมูลยังไม่ครบ';
}
