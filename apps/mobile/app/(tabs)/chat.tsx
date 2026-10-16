import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../lib/api';
import { useWorkspace } from '../../stores/workspace';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  entryId?: string;
}

export default function ChatScreen() {
  const router = useRouter();
  const active = useWorkspace((s) => s.active);
  const [mode, setMode] = useState<'log' | 'advisor'>('log');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!active || !input.trim()) return;
    const msg = input.trim();
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setInput('');
    setBusy(true);

    try {
      if (mode === 'log') {
        const res = await api.chatLog(active.id, msg);
        const e = res.entry;
        const reply = [
          'บันทึกเป็นรายการแล้ว',
          e.description,
          `ยอดรวม ${(e.amount_total / 100).toLocaleString('th-TH', {
            minimumFractionDigits: 2,
          })} บาท`,
          e.vat_amount ? `VAT ${(e.vat_amount / 100).toLocaleString('th-TH')} บาท` : null,
          e.wht_amount ? `หัก ณ ที่จ่าย ${(e.wht_amount / 100).toLocaleString('th-TH')} บาท` : null,
          `สถานะ: ${e.status === 'confirmed' ? 'ยืนยันแล้ว' : 'รอตรวจ'}`,
        ]
          .filter(Boolean)
          .join('\n');
        setMessages((m) => [...m, { role: 'assistant', text: reply, entryId: e.id }]);
      } else {
        const res = await api.taxAdvisor(active.id, msg);
        setMessages((m) => [...m, { role: 'assistant', text: res.answer }]);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      Alert.alert('ผิดพลาด', errMsg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View className="flex-row px-4 pt-3 gap-2">
          <ModeButton active={mode === 'log'} label="บันทึกรายการ" onPress={() => setMode('log')} />
          <ModeButton active={mode === 'advisor'} label="ที่ปรึกษาภาษี" onPress={() => setMode('advisor')} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} className="flex-1">
          {messages.length === 0 && (
            <View className="mt-8">
              <Text className="text-gray-400 text-center">
                {mode === 'log'
                  ? 'ลองพิมพ์: จ่ายค่าโฆษณา Facebook 10,700 รวม VAT แล้ว'
                  : 'ลองถาม: เดือนนี้ต้องเตรียมจ่าย VAT ประมาณเท่าไร'}
              </Text>
              <Text className="text-gray-400 text-center mt-2">
                AI จะช่วยแปลงข้อความเป็นรายการ หรือช่วยอธิบายภาษีจากข้อมูลจริงของกิจการ
              </Text>
            </View>
          )}

          {messages.map((m, i) => (
            <View
              key={`${m.role}-${i}`}
              className={`my-1 p-3 rounded-2xl max-w-[85%] ${
                m.role === 'user' ? 'bg-brand-500 self-end' : 'bg-surface-muted self-start'
              }`}
            >
              <Text className={m.role === 'user' ? 'text-white' : ''}>{m.text}</Text>
              {m.entryId ? (
                <Pressable
                  onPress={() => router.push(`/entry/${m.entryId}`)}
                  className="mt-3 rounded-xl bg-white border border-brand-100 py-2"
                >
                  <Text className="text-brand-700 text-center font-semibold">ตรวจและยืนยัน</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View className="flex-row p-3 border-t border-gray-200">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={mode === 'log' ? 'พิมพ์รายการที่จะบันทึก...' : 'ถามเรื่องภาษีหรือกระแสเงินสด...'}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 mr-2 bg-white"
            multiline
            editable={!busy}
          />
          <Pressable
            onPress={send}
            disabled={busy || !input.trim()}
            className={`px-4 py-2 rounded-full ${
              busy || !input.trim() ? 'bg-gray-300' : 'bg-brand-500'
            }`}
          >
            <Text className="text-white font-semibold">{busy ? '...' : 'ส่ง'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 px-4 py-2 rounded-full ${
        active ? 'bg-brand-500' : 'bg-surface-muted border border-gray-200'
      }`}
    >
      <Text className={`text-center ${active ? 'text-white' : 'text-gray-700'}`}>{label}</Text>
    </Pressable>
  );
}
