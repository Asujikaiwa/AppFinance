'use client';

import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { signInWithLiff } from '../../../lib/liff';
import { createClient } from '../../../lib/supabase/client';

export default function LiffLinkPage(): ReactElement {
  const [status, setStatus] = useState<'init' | 'ready' | 'error'>('init');
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await signInWithLiff();
        if (!r.ok) {
          setErr(r.error ?? 'sign-in failed');
          setStatus('error');
          return;
        }
        const supabase = createClient();
        const { data } = await supabase
          .from('workspaces')
          .select('id, name')
          .order('created_at', { ascending: true });
        setWorkspaces(data ?? []);
        setStatus('ready');
      } catch (error) {
        setErr(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    })();
  }, []);

  async function pick(workspaceId: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('line_identities')
      .update({ default_workspace: workspaceId })
      .eq('user_id', user.id);
    setStatus('ready');
    alert('เชื่อมบัญชีเรียบร้อย กลับไปที่ LINE แล้วเริ่มส่งใบเสร็จได้เลย');
  }

  if (status === 'init') return <Center>กำลังเชื่อมต่อกับ LINE...</Center>;
  if (status === 'error') return <Center>เกิดข้อผิดพลาด: {err}</Center>;

  return (
    <main className="min-h-screen max-w-sm mx-auto px-6 py-10">
      <h1 className="text-xl font-bold mb-1">เลือกกิจการ</h1>
      <p className="text-sm text-gray-500 mb-6">
        เลือกกิจการที่จะใช้บันทึกรายการผ่าน LINE เป็นค่าเริ่มต้น
      </p>
      <div className="space-y-2">
        {workspaces.map((w) => (
          <button
            key={w.id}
            onClick={() => pick(w.id)}
            className="w-full text-left rounded-lg border border-gray-200 p-4 hover:border-brand-500"
          >
            {w.name}
          </button>
        ))}
        {workspaces.length === 0 && (
          <p className="text-gray-400 text-sm">
            ยังไม่มีกิจการ สร้างใหม่ในแอปหรือเว็บก่อน
          </p>
        )}
      </div>
    </main>
  );
}

function Center({ children }: { children: ReactNode }): ReactElement {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center text-gray-600">
      {children}
    </main>
  );
}
