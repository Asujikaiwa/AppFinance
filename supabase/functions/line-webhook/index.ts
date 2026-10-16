/**
 * POST /functions/v1/line-webhook   (configure as the LINE Messaging API webhook URL)
 *
 * Deploy with: supabase functions deploy line-webhook --no-verify-jwt
 * (LINE calls this without a Supabase JWT; we verify the LINE signature instead.)
 *
 * Handles:
 *   - text messages → parse into an entry
 *   - image messages → OCR into an entry
 *   - postback (rich menu) → quick actions
 *   - follow event → greet + prompt account linking
 */
import { getAdminClient } from '../_shared/auth.ts';
import {
  entryConfirmFlex,
  getMessageContent,
  replyMessage,
  textMessage,
  verifyLineSignature,
  type LineMessage,
} from '../_shared/line.ts';
import {
  extractFromImage,
  extractFromText,
  insertExtractedEntry,
} from '../_shared/extract.ts';

const LIFF_BASE = () => `https://liff.line.me/${Deno.env.get('LIFF_ID') ?? ''}`;

interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; id: string; text?: string };
  postback?: { data: string };
}

// EdgeRuntime is provided by the Supabase Edge Functions runtime.
declare const EdgeRuntime:
  | { waitUntil(p: Promise<unknown>): void }
  | undefined;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature');

  // Verify signature BEFORE doing anything — reject forgeries.
  if (!(await verifyLineSignature(rawBody, signature))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events: LineEvent[] };

  // Respond 200 immediately (LINE times out ~1s); process in the background so
  // slow AI/OCR calls never cause LINE to retry and create duplicates.
  const work = processEvents(body.events ?? []);
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(work);
  } else {
    // Local dev fallback: await it.
    await work;
  }
  return new Response('OK', { status: 200 });
});

async function processEvents(events: LineEvent[]): Promise<void> {
  const admin = getAdminClient();
  for (const event of events) {
    try {
      // Idempotency: skip events we've already handled (LINE redelivers on retry).
      if (event.webhookEventId) {
        const { error: dupErr } = await admin
          .from('processed_line_events')
          .insert({ event_id: event.webhookEventId });
        if (dupErr) {
          // Unique-violation = already processed → skip silently.
          continue;
        }
      }
      await handleEvent(admin, event);
    } catch (err) {
      console.error('event error', err);
      const m = err instanceof Error ? err.message : String(err);
      const friendly = m.startsWith('QUOTA_EXCEEDED')
        ? m.replace('QUOTA_EXCEEDED: ', '⚠️ ')
        : 'ขออภัย เกิดข้อผิดพลาดในการประมวลผล ลองใหม่อีกครั้งนะครับ';
      if (event.replyToken) {
        await replyMessage(event.replyToken, [textMessage(friendly)]).catch(() => {});
      }
    }
  }
}

async function handleEvent(
  admin: ReturnType<typeof getAdminClient>,
  event: LineEvent,
): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  // Resolve the linked workspace
  const { data: identity } = await admin
    .from('line_identities')
    .select('user_id, default_workspace')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  // FOLLOW (added the OA) → greet
  if (event.type === 'follow' && event.replyToken) {
    await replyMessage(event.replyToken, [
      textMessage(
        'ยินดีต้อนรับสู่ AppFinance 🧾\n\nส่งรูปใบเสร็จ หรือพิมพ์รายการ เช่น "จ่ายค่าน้ำมัน 1,200 ที่ ปตท." แล้วผมจะบันทึกให้อัตโนมัติ',
      ),
      linkAccountMessage(lineUserId),
    ]);
    return;
  }

  const linked = identity?.user_id && identity?.default_workspace;
  if (!linked) {
    if (event.replyToken) {
      await replyMessage(event.replyToken, [
        textMessage('กรุณาเชื่อมบัญชีก่อนเริ่มใช้งานครับ 👇'),
        linkAccountMessage(lineUserId),
      ]);
    }
    return;
  }

  const workspaceId = identity!.default_workspace as string;
  const createdBy = identity!.user_id as string;

  // POSTBACK from rich menu
  if (event.type === 'postback' && event.replyToken) {
    await handlePostback(event.replyToken, event.postback!.data);
    return;
  }

  if (event.type !== 'message' || !event.message || !event.replyToken) return;

  // TEXT message → parse to entry
  if (event.message.type === 'text') {
    const text = event.message.text ?? '';
    const extracted = await extractFromText(admin, workspaceId, text, {
      fn: 'line-webhook',
      createdBy,
    });
    if (extracted.confidence < 0.3) {
      await replyMessage(event.replyToken, [
        textMessage(
          `ยังไม่แน่ใจรายละเอียดครับ${extracted.notes ? `\n(${extracted.notes})` : ''}\nลองระบุยอดเงินและร้านค้าให้ชัดเจนขึ้น หรือส่งรูปใบเสร็จมาได้เลย`,
        ),
      ]);
      return;
    }
    const entry = await insertExtractedEntry(admin, {
      workspaceId,
      createdBy,
      source: 'chat',
      extracted,
      autoConfirm: true,
    });
    await replyMessage(event.replyToken, [confirmFlex(entry, extracted)]);
    return;
  }

  // IMAGE message → OCR to entry
  if (event.message.type === 'image') {
    const content = await getMessageContent(event.message.id);
    const base64 = btoa(String.fromCharCode(...content.bytes));

    // Persist the receipt image to Storage for the audit trail
    const path = `${workspaceId}/${crypto.randomUUID()}.jpg`;
    await admin.storage.from('receipts').upload(path, content.bytes, {
      contentType: content.contentType,
    });

    const extracted = await extractFromImage(admin, workspaceId, base64, content.contentType, {
      fn: 'line-webhook',
      createdBy,
    });
    const entry = await insertExtractedEntry(admin, {
      workspaceId,
      createdBy,
      source: 'ocr',
      extracted,
      autoConfirm: false, // OCR always needs review
    });
    await admin.from('attachments').insert({
      entry_id: entry.id,
      storage_path: path,
      mime_type: content.contentType,
      ocr_text: JSON.stringify(extracted),
    });
    await replyMessage(event.replyToken, [confirmFlex(entry, extracted)]);
    return;
  }

  // Unsupported message type
  await replyMessage(event.replyToken, [
    textMessage('ส่งได้เฉพาะข้อความหรือรูปภาพใบเสร็จนะครับ'),
  ]);
}

async function handlePostback(replyToken: string, data: string): Promise<void> {
  const params = new URLSearchParams(data);
  const action = params.get('action');
  switch (action) {
    case 'summary':
      await replyMessage(replyToken, [
        textMessage('เปิดสรุปภาษีได้ที่ 👉 ' + `${LIFF_BASE()}/dashboard`),
      ]);
      break;
    case 'reports':
      await replyMessage(replyToken, [
        textMessage('ดูรายงานทั้งหมดได้ที่ 👉 ' + `${LIFF_BASE()}/reports`),
      ]);
      break;
    case 'reminders':
      await replyMessage(replyToken, [
        textMessage('ตั้งค่าการแจ้งเตือนได้ที่ 👉 ' + `${LIFF_BASE()}/reminders`),
      ]);
      break;
    case 'help':
      await replyMessage(replyToken, [
        textMessage(
          'วิธีใช้:\n• ส่งรูปใบเสร็จ → บันทึกอัตโนมัติ\n• พิมพ์ "จ่ายค่า... 1,200" → บันทึกด่วน\n• ถามภาษีได้เลย เช่น "เดือนนี้ต้องเสีย VAT เท่าไหร่"',
        ),
      ]);
      break;
    default:
      await replyMessage(replyToken, [textMessage('เปิดเมนู 👉 ' + LIFF_BASE())]);
  }
}

function confirmFlex(
  entry: { id: string; amount_total: number } & Record<string, unknown>,
  extracted: { vatAmount: number; whtAmount: number | null; description: string },
): LineMessage {
  return entryConfirmFlex({
    description: extracted.description,
    total: entry.amount_total,
    vat: extracted.vatAmount,
    wht: extracted.whtAmount ?? 0,
    status: (entry.status as string) === 'confirmed' ? 'ยืนยันแล้ว' : 'ฉบับร่าง — โปรดตรวจสอบ',
    liffUrl: `${LIFF_BASE()}/entry/${entry.id}`,
  });
}

function linkAccountMessage(lineUserId: string): LineMessage {
  return {
    type: 'flex',
    altText: 'เชื่อมบัญชี AppFinance',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'เชื่อมบัญชีของคุณ', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'เพื่อเริ่มบันทึกรายการผ่าน LINE', size: 'sm', color: '#888888', wrap: true },
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
            action: {
              type: 'uri',
              label: 'เชื่อมบัญชี',
              uri: `${LIFF_BASE()}/link?lineUserId=${lineUserId}`,
            },
          },
        ],
      },
    },
  };
}
