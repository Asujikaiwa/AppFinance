import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) {
      Alert.alert('กรอกข้อมูลไม่ครบ', 'กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }
    setBusy(true);
    try {
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('ผิดพลาด', error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 px-6 justify-center">
        <Text className="text-3xl font-bold mb-2">AppFinance</Text>
        <Text className="text-gray-500 mb-8">บันทึก-คำนวณภาษีไทยด้วย AI</Text>

        <Text className="text-sm font-medium mb-1">อีเมล</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          className="border border-gray-300 rounded-xl px-4 py-3 mb-4"
          placeholder="you@example.com"
        />

        <Text className="text-sm font-medium mb-1">รหัสผ่าน</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          className="border border-gray-300 rounded-xl px-4 py-3 mb-6"
          placeholder="••••••••"
        />

        <Pressable
          onPress={submit}
          disabled={busy}
          className="bg-brand-500 rounded-xl py-3 mb-3"
        >
          <Text className="text-white text-center font-semibold">
            {busy ? 'กำลังดำเนินการ...' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
        >
          <Text className="text-center text-brand-600">
            {mode === 'signin' ? 'ยังไม่มีบัญชี? สมัครเลย' : 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
