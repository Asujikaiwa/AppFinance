/**
 * POST /functions/v1/email-inbound
 * Deploy with --no-verify-jwt; this is the webhook for an inbound-email provider
 * (Postmark / SendGrid Inbound Parse / Cloudflare Email Workers).
 *
 * Recipient convention:  inbox+<email_token>@in.appfinance.app
 * The +token maps to a workspace via workspaces.email_token.
 *
 * Flow: verify provider signature → resolve workspace → store raw → for each
 * attachment run OCR → create draft entries → notify the user via LINE.
 *
 * The provider payload shape varies; we normalize a minimal subset here.
 */
import { getAdminClient } from '../_shared/auth.ts';
import { errorResponse, json } from '../_shared/cors.ts';
import { callClaude, extractJSON } from '../_shared/claude.ts';
import { EXTRACT_ENTRY_SYSTEM } from '../_shared/prompts.ts';
import {
  extractFromDocument,
  extractFromImage,
  insertExtractedEntry,
  type ExtractedEntry,
} from '../_shared/extract.ts';
import { pushMessage, textMessage } from '../_shared/line.ts';

interface NormalizedEmail {
  to: string; // full recipient incl. +token
  from: string;
  subject: string;
  htmlBody?: string;
  textBody?: string;
  attachments: Array<{ filename: string; contentType: string; base64: string }>;
}

/** Verify the provider's webhook signature (shared secret in a header). */
function verifyProvider(req: Request): boolean {
  const expected = Deno.env.get('EMAIL_INBOUND_SIGNING_SECRET');
  if (!expected) return true; // not configured (local dev) → allow
  return req.headers.get('x-inbound-signature') === expected;
}

/** Extract the +token from "inbox+<token>@in.appfinance.app". */
function tokenFromAddress(to: string): string | null {
  const m = to.match(/\+([a-f0-9]+)@/i);
  return m?.[1] ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!verifyProvider(req)) return errorResponse('Invalid signature', 401);

  try {
    const email = (await req.json()) as NormalizedEmail;
    const admin = getAdminClient();

    const token = tokenFromAddress(email.to);
    if (!token) return errorResponse('No workspace token in recipient', 400);

    const { data: ws } = await admin
      .from('workspaces')
      .select('id')
      .eq('email_token', token)
      .maybeSingle();
    if (!ws) {
      // Unknown token — store as ignored for debugging, return 200 so provider stops retrying
      await admin.from('inbound_emails').insert({
        workspace_id: null,
        from_address: email.from,
        subject: email.subject,
        attachment_count: email.attachments?.length ?? 0,
        status: 'ignored',
        error: 'unknown email_token',
      });
      return json({ ok: true, ignored: true });
    }

    // Owner = the entry creator we attribute imports to
    const { data: owner } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', ws.id)
      .eq('role', 'owner')
      .maybeSingle();
    const createdBy = owner?.user_id;
    if (!createdBy) return errorResponse('Workspace has no owner', 400);

    // Store the inbound email record
    const { data: rec } = await admin
      .from('inbound_emails')
      .insert({
        workspace_id: ws.id,
        from_address: email.from,
        subject: email.subject,
        attachment_count: email.attachments?.length ?? 0,
        status: 'received',
      })
      .select()
      .single();

    let created = 0;
    const errors: string[] = [];

    // 1. Process image/PDF attachments via OCR
    for (const att of email.attachments ?? []) {
      const isImage = /^image\//.test(att.contentType);
      const isPdf = att.contentType === 'application/pdf';
      if (!isImage && !isPdf) continue;

      try {
        // Store the attachment for the audit trail
        const path = `${ws.id}/${crypto.randomUUID()}-${att.filename}`;
        const bytes = Uint8Array.from(atob(att.base64), (c) => c.charCodeAt(0));
        await admin.storage.from('receipts').upload(path, bytes, {
          contentType: att.contentType,
        });

        // Images → vision-as-image; PDFs → Claude native document support.
        const extracted = isPdf
          ? await extractFromDocument(admin, ws.id, att.base64, {
              fn: 'email-inbound',
              createdBy,
            })
          : await extractFromImage(admin, ws.id, att.base64, att.contentType, {
              fn: 'email-inbound',
              createdBy,
            });
        const entry = await insertExtractedEntry(admin, {
          workspaceId: ws.id,
          createdBy,
          source: 'import',
          extracted,
          autoConfirm: false,
        });
        await admin.from('attachments').insert({
          entry_id: entry.id,
          storage_path: path,
          mime_type: att.contentType,
          ocr_text: JSON.stringify(extracted),
        });
        created++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    // 2. No attachments → parse the email body itself (e.g. SaaS receipt emails)
    if (created === 0 && (email.htmlBody || email.textBody)) {
      try {
        const extracted = await parseEmailBody(
          admin,
          ws.id,
          email.subject,
          email.from,
          email.htmlBody ?? email.textBody ?? '',
        );
        if (extracted && extracted.confidence >= 0.4) {
          await insertExtractedEntry(admin, {
            workspaceId: ws.id,
            createdBy,
            source: 'import',
            extracted,
            autoConfirm: false,
          });
          created++;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    // Update the inbound record
    await admin
      .from('inbound_emails')
      .update({
        status: errors.length && created === 0 ? 'failed' : 'processed',
        entries_created: created,
        error: errors.length ? errors.join('; ') : null,
      })
      .eq('id', rec!.id);

    // 3. Notify the workspace owner via LINE (if linked)
    if (created > 0) {
      const { data: idn } = await admin
        .from('line_identities')
        .select('line_user_id')
        .eq('user_id', createdBy)
        .maybeSingle();
      if (idn?.line_user_id) {
        await pushMessage(idn.line_user_id, [
          textMessage(
            `📧 ได้รับอีเมลจาก ${email.from}\nสร้างรายการฉบับร่าง ${created} รายการ — เปิดแอปเพื่อตรวจสอบและยืนยันครับ`,
          ),
        ]).catch(() => {});
      }
    }

    return json({ ok: true, entries_created: created, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});

/** Parse a plain receipt email body (no attachment) into an entry. */
async function parseEmailBody(
  admin: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  subject: string,
  from: string,
  body: string,
): Promise<ExtractedEntry | null> {
  const { data: cats } = await admin
    .from('categories')
    .select('code, name_th, direction')
    .eq('workspace_id', workspaceId);
  const hint = (cats ?? [])
    .map((c) => `  ${c.code} — ${c.name_th} (${c.direction})`)
    .join('\n');

  // Strip HTML tags crudely to keep token usage down
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
  const today = new Date().toISOString().slice(0, 10);

  const res = await callClaude({
    system: EXTRACT_ENTRY_SYSTEM,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `วันที่ปัจจุบัน: ${today}\nอีเมลจาก: ${from}\nหัวข้อ: ${subject}\n\nเนื้อหา:\n${text}\n\nหมวดที่ใช้ได้:\n${hint}\n\nถ้านี่เป็นใบเสร็จ/ใบแจ้งหนี้ ให้สกัดเป็น JSON; ถ้าไม่ใช่ให้ตอบ {"confidence": 0}`,
      },
    ],
  });
  return extractJSON<ExtractedEntry>(res.content[0]?.text ?? '{}');
}
