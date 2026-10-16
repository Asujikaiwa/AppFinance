import * as ImagePicker from 'expo-image-picker';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useWorkspace } from '../../stores/workspace';

export default function LogScreen() {
  const active = useWorkspace((s) => s.active);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function captureAndOcr(useCamera: boolean) {
    if (!active) {
      Alert.alert('ยังไม่มีกิจการ', 'กรุณาสร้างหรือเลือกกิจการก่อนบันทึกรายการ');
      return;
    }

    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('ต้องอนุญาตการเข้าถึง', 'เปิดสิทธิ์กล้องหรือคลังรูปเพื่ออัปโหลดใบเสร็จ');
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: false });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      const path = `${active.id}/${crypto.randomUUID()}.jpg`;
      const blob = await fetch(asset.uri).then((r) => r.blob());
      const { error: upErr } = await supabase.storage
        .from('receipts')
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;

      const out = await api.ocrReceipt(active.id, path);
      Alert.alert(
        'อ่านใบเสร็จแล้ว',
        `ยอดรวม ${(out.entry.amount_total / 100).toLocaleString('th-TH', {
          minimumFractionDigits: 2,
        })} บาท\nสถานะ: ${out.entry.status === 'draft' ? 'รอตรวจ' : 'ยืนยันแล้ว'}`,
        [
          { text: 'ปิด', style: 'cancel' },
          { text: 'ตรวจรายการ', onPress: () => router.push(`/entry/${out.entry.id}`) },
        ],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('ผิดพลาด', msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text className="text-2xl font-bold mb-1">บันทึกเร็ว</Text>
        <Text className="text-sm text-gray-500 mb-6">
          เลือกวิธีที่เร็วที่สุดสำหรับงานตอนนี้ แล้วค่อยตรวจรายละเอียดภายหลังได้
        </Text>

        <ActionCard
          title="ถ่ายใบเสร็จ"
          detail="เหมาะกับใบเสร็จหน้าร้านหรือใบกำกับภาษีที่อยู่ตรงหน้า"
          disabled={busy || !active}
          primary
          onPress={() => captureAndOcr(true)}
        />

        <ActionCard
          title="เลือกรูปจากเครื่อง"
          detail="ใช้กับใบเสร็จที่บันทึกไว้ หรือภาพจากแชตที่ดาวน์โหลดมาแล้ว"
          disabled={busy || !active}
          onPress={() => captureAndOcr(false)}
        />

        <Link href="/(tabs)/chat" asChild>
          <Pressable className="bg-surface-muted rounded-2xl p-5 mb-3 border border-gray-200">
            <Text className="text-lg font-semibold">พิมพ์รายการสั้น ๆ</Text>
            <Text className="text-gray-500 text-sm mt-1">
              เช่น จ่ายค่าโฆษณา Facebook 10,700 รวม VAT แล้ว
            </Text>
          </Pressable>
        </Link>

        <Link href="/entries?filter=review" asChild>
          <Pressable className="rounded-2xl p-4 mt-3 bg-amber-50 border border-amber-200">
            <Text className="text-amber-800 font-semibold">ไปตรวจรายการที่ AI อ่านไว้</Text>
            <Text className="text-amber-700 text-sm mt-1">
              ใช้สำหรับเช็กยอด วันที่ หมวด VAT และเลขผู้เสียภาษีก่อนส่งบัญชี
            </Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionCard({
  title,
  detail,
  disabled,
  primary,
  onPress,
}: {
  title: string;
  detail: string;
  disabled: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-2xl p-5 mb-3 ${
        primary ? 'bg-brand-500' : 'bg-surface-muted border border-gray-200'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <Text className={`text-lg font-semibold ${primary ? 'text-white' : ''}`}>{title}</Text>
      <Text className={`text-sm mt-1 ${primary ? 'text-brand-50' : 'text-gray-500'}`}>
        {detail}
      </Text>
    </Pressable>
  );
}
