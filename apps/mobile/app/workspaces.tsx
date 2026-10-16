import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { useWorkspace } from '../stores/workspace';

export default function Workspaces() {
  const router = useRouter();
  const { list, active, setActive } = useWorkspace();
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function invite() {
    if (!active || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('invite_member_by_email', {
        p_workspace: active.id,
        p_email: inviteEmail.trim(),
        p_role: 'accountant',
      });
      if (error) throw error;
      const msg: Record<string, string> = {
        ok: 'เชิญนักบัญชีเรียบร้อย',
        not_owner: 'เฉพาะเจ้าของกิจการเท่านั้นที่เชิญสมาชิกได้',
        user_not_found: 'ไม่พบผู้ใช้อีเมลนี้ ผู้ถูกเชิญต้องมีบัญชี AppFinance ก่อน',
        invalid_role: 'บทบาทไม่ถูกต้อง',
      };
      Alert.alert(data === 'ok' ? 'สำเร็จ' : 'แจ้งเตือน', msg[data as string] ?? String(data));
      if (data === 'ok') setInviteEmail('');
    } catch (e) {
      Alert.alert('ผิดพลาด', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <Stack.Screen options={{ title: 'กิจการและทีม', headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text className="text-sm text-gray-500 mb-2">เลือกกิจการที่ต้องการทำงาน</Text>
        {list.map((w) => (
          <Pressable
            key={w.id}
            onPress={() => {
              setActive(w);
              router.back();
            }}
            className={`rounded-xl p-4 mb-2 border ${
              active?.id === w.id ? 'bg-brand-50 border-brand-500' : 'bg-surface-muted border-gray-200'
            }`}
          >
            <Text className="font-semibold">{w.name}</Text>
            <Text className="text-xs text-gray-500 mt-0.5">
              {w.kind === 'personal' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}
              {w.vat_registered ? ' · จด VAT' : ' · ไม่ได้จด VAT'}
              {active?.id === w.id ? ' · กำลังใช้งาน' : ''}
            </Text>
          </Pressable>
        ))}

        <Pressable
          onPress={() => router.push('/onboarding')}
          className="rounded-xl p-4 mb-6 border border-dashed border-brand-400"
        >
          <Text className="text-brand-600 text-center font-medium">สร้างกิจการใหม่</Text>
        </Pressable>

        {active && (
          <View className="border-t border-gray-100 pt-5">
            <Text className="text-sm font-medium mb-1">เชิญนักบัญชีเข้ากิจการนี้</Text>
            <Text className="text-xs text-gray-500 mb-3">
              นักบัญชีจะช่วยตรวจรายการ สร้างรายงาน และดูเอกสารที่เกี่ยวข้องได้ตามสิทธิ์
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="email@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 bg-white"
              />
              <Pressable
                onPress={invite}
                disabled={busy || !inviteEmail.trim()}
                className={`px-4 justify-center rounded-xl ${
                  busy || !inviteEmail.trim() ? 'bg-gray-300' : 'bg-brand-500'
                }`}
              >
                <Text className="text-white font-semibold">เชิญ</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
