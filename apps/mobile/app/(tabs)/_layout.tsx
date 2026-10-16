import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { supabase } from '../../lib/supabase';
import { useWorkspace } from '../../stores/workspace';

export default function TabsLayout() {
  const setList = useWorkspace((s) => s.setList);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, name, kind, vat_registered')
        .order('created_at', { ascending: true });
      if (ws && ws.length > 0) {
        setList(ws);
      } else {
        router.replace('/onboarding');
      }
    })();
  }, [setList, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#059669',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'หน้าหลัก' }} />
      <Tabs.Screen name="log" options={{ title: 'บันทึก' }} />
      <Tabs.Screen name="chat" options={{ title: 'ถาม AI' }} />
      <Tabs.Screen name="reports" options={{ title: 'รายงาน' }} />
    </Tabs>
  );
}
