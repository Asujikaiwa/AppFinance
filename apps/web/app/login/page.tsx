'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '../../lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const needsSetup = searchParams.get('setup') === 'supabase';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(
    needsSetup ? 'ต้องตั้งค่า Supabase ในไฟล์ .env.local ก่อนเข้าสู่ dashboard' : null,
  );

  async function emailLogin() {
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setErr(error.message);
      else router.push('/dashboard');
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function lineLogin() {
    const channelId = process.env.NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID;
    if (!channelId) {
      setErr('ยังไม่ได้ตั้งค่า NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID');
      return;
    }

    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/line/callback`);
    const state = crypto.randomUUID();
    sessionStorage.setItem('line_oauth_state', state);
    const url =
      `https://access.line.me/oauth2/v2.1/authorize?response_type=code` +
      `&client_id=${channelId}&redirect_uri=${redirectUri}` +
      `&state=${state}&scope=openid%20profile`;
    window.location.href = url;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6">เข้าสู่ระบบ</h1>

        <button
          onClick={lineLogin}
          className="w-full bg-[#06C755] text-white py-3 rounded-lg font-semibold mb-4"
        >
          เข้าสู่ระบบด้วย LINE
        </button>

        <div className="text-center text-gray-400 text-sm my-3">หรือ</div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="อีเมล"
          className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-3"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="รหัสผ่าน"
          className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4"
        />
        {err && <p className="text-red-500 text-sm mb-3">{err}</p>}
        <button
          onClick={emailLogin}
          disabled={busy}
          className="w-full bg-brand-500 text-white py-3 rounded-lg font-semibold"
        >
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วยอีเมล'}
        </button>
      </div>
    </main>
  );
}
