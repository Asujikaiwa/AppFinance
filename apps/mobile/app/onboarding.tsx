import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { validateTaxId } from '@appfinance/tax-core';

import { supabase } from '../lib/supabase';
import { useWorkspace } from '../stores/workspace';

/**
 * First-run: create a workspace (tax-paying entity). Calls the create_workspace
 * RPC which inserts the workspace + owner membership atomically and seeds the
 * default chart of accounts.
 */
export default function Onboarding() {
  const router = useRouter();
  const setList = useWorkspace((s) => s.setList);
  const setActive = useWorkspace((s) => s.setActive);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'personal' | 'corporate'>('personal');
  const [vat, setVat] = useState(false);
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) {
      Alert.alert('กรอกชื่อกิจการ', 'เช่น "ส่วนตัว — สมชาย" หรือ "บริษัท ABC จำกัด"');
      return;
    }
    if (taxId && !validateTaxId(taxId)) {
      Alert.alert('เลขผู้เสียภาษีไม่ถูกต้อง', 'ต้องเป็นเลข 13 หลักที่ถูกต้อง หรือเว้นว่างไว้');
      return;
    }
    setBusy(true);
    try {
      const { data: wsId, error } = await supabase.rpc('create_workspace', {
        p_name: name.trim(),
        p_kind: kind,
        p_vat: vat,
        p_tax_id: taxId.replace(/[\s-]/g, '') || null,
      });
      if (error) throw error;

      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, name, kind, vat_registered')
        .order('created_at', { ascending: true });
      if (ws) {
        setList(ws);
        const created = ws.find((w) => w.id === wsId);
        if (created) setActive(created);
      }
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('ผิดพลาด', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-2xl font-bold mb-1">สร้างกิจการแรกของคุณ</Text>
        <Text className="text-gray-500 mb-8">
          กิจการคือหน่วยที่เสียภาษี — สร้างได้ทั้งแบบส่วนตัวและบริษัท
        </Text>

        <Text className="text-sm font-medium mb-1">ชื่อกิจการ</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="เช่น ส่วนตัว — สมชาย"
          className="border border-gray-300 rounded-xl px-4 py-3 mb-5"
        />

        <Text className="text-sm font-medium mb-2">ประเภท</Text>
        <View className="flex-row gap-2 mb-5">
          <TypeBtn label="บุคคลธรรมดา" on={kind === 'personal'} onPress={() => setKind('personal')} />
          <TypeBtn label="นิติบุคคล" on={kind === 'corporate'} onPress={() => setKind('corporate')} />
        </View>

        <View className="flex-row items-center justify-between mb-5">
          <View className="flex-1 pr-3">
            <Text className="text-sm font-medium">จดทะเบียน VAT</Text>
            <Text className="text-xs text-gray-500">เปิดถ้ารายได้เกิน 1.8 ล้าน/ปี หรือจดแล้ว</Text>
          </View>
          <Switch value={vat} onValueChange={setVat} trackColor={{ true: '#10b981' }} />
        </View>

        <Text className="text-sm font-medium mb-1">เลขประจำตัวผู้เสียภาษี (ถ้ามี)</Text>
        <TextInput
          value={taxId}
          onChangeText={setTaxId}
          placeholder="13 หลัก"
          keyboardType="number-pad"
          className="border border-gray-300 rounded-xl px-4 py-3 mb-8"
        />

        <Pressable
          onPress={create}
          disabled={busy}
          className={`rounded-xl py-3 ${busy ? 'bg-gray-300' : 'bg-brand-500'}`}
        >
          <Text className="text-white text-center font-semibold">
            {busy ? 'กำลังสร้าง...' : 'สร้างกิจการ'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function TypeBtn({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 py-3 rounded-xl border ${
        on ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-gray-200'
      }`}
    >
      <Text className={`text-center font-medium ${on ? 'text-white' : 'text-gray-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
