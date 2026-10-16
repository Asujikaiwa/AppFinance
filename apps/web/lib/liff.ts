'use client';

import liff from '@line/liff';
import { createClient } from './supabase/client';

let initialized = false;

/** Initialize LIFF once. Safe to call repeatedly. */
export async function initLiff(): Promise<void> {
  if (initialized) return;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) throw new Error('NEXT_PUBLIC_LIFF_ID not set');
  await liff.init({ liffId });
  initialized = true;
}

export function isInLineClient(): boolean {
  return initialized && liff.isInClient();
}

/**
 * Sign in to Supabase using the LIFF ID token.
 * 1. ensure LIFF login
 * 2. POST the idToken to our line-auth edge function
 * 3. exchange the returned token_hash for a Supabase session
 */
export async function signInWithLiff(): Promise<{ ok: boolean; error?: string }> {
  await initLiff();
  if (!liff.isLoggedIn()) {
    liff.login();
    return { ok: false, error: 'redirecting to LINE login' };
  }

  const idToken = liff.getIDToken();
  if (!idToken) return { ok: false, error: 'no id token' };

  const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/line-auth`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'idToken', idToken }),
  });
  if (!res.ok) return { ok: false, error: `line-auth ${res.status}` };

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
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
