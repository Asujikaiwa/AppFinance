/**
 * LINE Messaging API + Login helpers for edge functions.
 * Docs: https://developers.line.biz/en/reference/messaging-api/
 */

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA_API = 'https://api-data.line.me/v2/bot';
const LINE_LOGIN_API = 'https://api.line.me/oauth2/v2.1';
const LINE_PROFILE_API = 'https://api.line.me/v2/profile';

function accessToken(): string {
  const t = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!t) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  return t;
}

/**
 * Verify the X-Line-Signature header (HMAC-SHA256 of the raw body, base64).
 * Must be called with the *raw* request body string.
 */
export async function verifyLineSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const secret = Deno.env.get('LINE_CHANNEL_SECRET');
  if (!secret) throw new Error('LINE_CHANNEL_SECRET not set');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

// ---------------------------------------------------------------------------
// Messaging API
// ---------------------------------------------------------------------------

export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<void> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) throw new Error(`LINE reply ${res.status}: ${await res.text()}`);
}

export async function pushMessage(
  to: string,
  messages: LineMessage[],
): Promise<void> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text()}`);
}

/** Download the binary content (image/file) of a message. */
export async function getMessageContent(messageId: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const res = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  const buf = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

// ---------------------------------------------------------------------------
// LINE Login (token exchange + profile)
// ---------------------------------------------------------------------------

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export async function exchangeCodeForProfile(
  code: string,
  redirectUri: string,
): Promise<LineProfile> {
  const channelId = Deno.env.get('LINE_LOGIN_CHANNEL_ID');
  const channelSecret = Deno.env.get('LINE_LOGIN_CHANNEL_SECRET');
  if (!channelId || !channelSecret) {
    throw new Error('LINE Login channel env not set');
  }

  const tokenRes = await fetch(`${LINE_LOGIN_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!tokenRes.ok) throw new Error(`LINE token ${tokenRes.status}: ${await tokenRes.text()}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(LINE_PROFILE_API, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error(`LINE profile ${profileRes.status}`);
  return (await profileRes.json()) as LineProfile;
}

/** Verify a LIFF-issued ID token and return the profile (used by LIFF web). */
export async function verifyIdToken(idToken: string): Promise<LineProfile> {
  const channelId = Deno.env.get('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw new Error('LINE_LOGIN_CHANNEL_ID not set');

  const res = await fetch(`${LINE_LOGIN_API}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) throw new Error(`LINE verify ${res.status}: ${await res.text()}`);
  const claims = (await res.json()) as {
    sub: string;
    name?: string;
    picture?: string;
  };
  return {
    userId: claims.sub,
    displayName: claims.name ?? 'LINE User',
    ...(claims.picture ? { pictureUrl: claims.picture } : {}),
  };
}

// ---------------------------------------------------------------------------
// Message types & builders
// ---------------------------------------------------------------------------

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: unknown };

export function textMessage(text: string): LineMessage {
  return { type: 'text', text };
}

/** A confirmation bubble for a saved entry. */
export function entryConfirmFlex(params: {
  description: string;
  total: number; // satang
  vat: number; // satang
  wht: number; // satang
  status: string;
  liffUrl: string;
}): LineMessage {
  const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const rows: unknown[] = [
    kv('รายการ', params.description),
    kv('ยอดรวม', `฿${baht(params.total)}`),
  ];
  if (params.vat > 0) rows.push(kv('VAT', `฿${baht(params.vat)}`));
  if (params.wht > 0) rows.push(kv('หัก ณ ที่จ่าย', `฿${baht(params.wht)}`));
  rows.push(kv('สถานะ', params.status));

  return {
    type: 'flex',
    altText: `บันทึกแล้ว: ${params.description} ฿${baht(params.total)}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '✓ บันทึกรายการแล้ว', weight: 'bold', color: '#059669', size: 'lg' },
          { type: 'separator', margin: 'md' },
          ...rows,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#10b981',
            action: { type: 'uri', label: 'ตรวจสอบ/แก้ไข', uri: params.liffUrl },
          },
        ],
      },
    },
  };
}

function kv(label: string, value: string): unknown {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#888888', size: 'sm', flex: 2 },
      { type: 'text', text: value, wrap: true, size: 'sm', flex: 5 },
    ],
  };
}
