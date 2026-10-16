'use client';

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { createClient } from '../../../../lib/supabase/client';

export default function LineCallback(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [msg, setMsg] = useState('กำลังเข้าสู่ระบบด้วย LINE...');

  useEffect(() => {
    (async () => {
      const code = params.get('code');
      const state = params.get('state');
      const savedState = sessionStorage.getItem('line_oauth_state');
      if (!code || state !== savedState) {
        setMsg('การยืนยันไม่ถูกต้อง กรุณาลองใหม่');
        return;
      }

      try {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
          throw new Error('ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL');
        }

        const redirectUri = `${window.location.origin}/auth/line/callback`;
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/line-auth`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'code', code, redirectUri }),
          },
        );
        if (!res.ok) throw new Error(`line-auth ${res.status}`);
        const { token_hash, email } = (await res.json()) as {
          token_hash: string;
          email: string;
        };

        const supabase = createClient();
        const { error } = await supabase.auth.verifyOtp({
          type: 'magiclink',
          token_hash,
          email,
        });
        if (error) throw error;
        router.replace('/dashboard');
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      }
    })();
  }, [params, router]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-gray-600">{msg}</p>
    </main>
  );
}
