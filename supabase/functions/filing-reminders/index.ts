/**
 * filing-reminders — scheduled daily (08:00 ICT / 01:00 UTC).
 * Deploy with --no-verify-jwt; trigger via pg_cron or external scheduler.
 *
 * Two phases:
 *   1. GENERATE — ensure each workspace has reminder rows for the next 3 months.
 *   2. NOTIFY   — for reminders due in {7,3,1} days, send LINE push (once each),
 *                 logged to notification_log for idempotency.
 *
 * Optional body: { offsets?: number[], dryRun?: boolean }
 */
import {
  generateUpcomingReminders,
  daysUntil,
  type WorkspaceProfile,
} from '../_shared/calendar.ts';
import { getAdminClient } from '../_shared/auth.ts';
import { errorResponse, json } from '../_shared/cors.ts';
import { pushMessage, textMessage } from '../_shared/line.ts';

const DEFAULT_OFFSETS = [7, 3, 1];

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const offsets: number[] = body.offsets ?? DEFAULT_OFFSETS;
    const dryRun: boolean = body.dryRun ?? false;

    const admin = getAdminClient();
    const now = new Date();
    const year = now.getUTCFullYear();
    const month1 = now.getUTCMonth() + 1;

    // ---- Phase 1: GENERATE ----
    const { data: workspaces } = await admin
      .from('workspaces')
      .select('id, kind, vat_registered, fiscal_year_start');

    let generated = 0;
    for (const ws of workspaces ?? []) {
      // Derive activity flags from the workspace's entries (last 90 days)
      const since = new Date(now);
      since.setUTCDate(since.getUTCDate() - 90);
      const { data: recent } = await admin
        .from('entries')
        .select('wht_amount, category_id, categories(code)')
        .eq('workspace_id', ws.id)
        .gte('entry_date', since.toISOString().slice(0, 10));

      const hasPayroll = (recent ?? []).some(
        (e) => (e.categories as { code?: string } | null)?.code === '6100',
      );
      const hasWht = (recent ?? []).some((e) => (e.wht_amount ?? 0) > 0);

      const profile: WorkspaceProfile = {
        kind: ws.kind,
        vatRegistered: ws.vat_registered,
        fiscalYearStartMonth: ws.fiscal_year_start ?? 1,
        hasPayroll,
        hasWhtIndividual: hasWht,
        hasWhtJuristic: hasWht,
      };

      const upcoming = generateUpcomingReminders(profile, year, month1, 3);
      for (const item of upcoming) {
        const { error } = await admin.from('reminders').upsert(
          {
            workspace_id: ws.id,
            obligation: item.obligation,
            period_label: item.periodLabel,
            due_date: item.eFilingDate ?? item.dueDate,
            status: 'pending',
          },
          { onConflict: 'workspace_id,obligation,period_label', ignoreDuplicates: true },
        );
        if (!error) generated++;
      }
    }

    // ---- Phase 2: NOTIFY ----
    const { data: pending } = await admin
      .from('reminders')
      .select('id, workspace_id, obligation, period_label, due_date')
      .eq('status', 'pending');

    let sent = 0;
    const notices: Array<{ workspace: string; obligation: string; days: number }> = [];

    for (const r of pending ?? []) {
      const days = daysUntil(r.due_date, now);
      if (!offsets.includes(days)) continue;

      // Idempotency: already notified for this offset?
      const { data: already } = await admin
        .from('notification_log')
        .select('id')
        .eq('reminder_id', r.id)
        .eq('channel', 'line')
        .eq('offset_days', days)
        .maybeSingle();
      if (already) continue;

      // Find the LINE recipients for this workspace
      const { data: members } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', r.workspace_id)
        .in('role', ['owner', 'accountant']);

      const userIds = (members ?? []).map((m) => m.user_id);
      const { data: identities } = await admin
        .from('line_identities')
        .select('line_user_id, user_id')
        .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

      const msg = buildReminderText(r.obligation, r.period_label, r.due_date, days);

      for (const idn of identities ?? []) {
        notices.push({ workspace: r.workspace_id, obligation: r.obligation, days });
        if (dryRun) continue;
        try {
          await pushMessage(idn.line_user_id, [textMessage(msg)]);
          await admin.from('notification_log').insert({
            workspace_id: r.workspace_id,
            reminder_id: r.id,
            channel: 'line',
            offset_days: days,
            recipient: idn.line_user_id,
            body: msg,
          });
          sent++;
        } catch (e) {
          console.error('push failed', e);
        }
      }
    }

    return json({ generated, sent, dryRun, notices });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});

function buildReminderText(
  obligation: string,
  period: string,
  dueDate: string,
  days: number,
): string {
  const titles: Record<string, string> = {
    pp30: 'ภ.พ.30 (ภาษีมูลค่าเพิ่ม)',
    png1: 'ภ.ง.ด.1 (หัก ณ ที่จ่าย เงินเดือน)',
    png3: 'ภ.ง.ด.3 (หัก ณ ที่จ่าย บุคคล)',
    png53: 'ภ.ง.ด.53 (หัก ณ ที่จ่าย นิติบุคคล)',
    png50: 'ภ.ง.ด.50 (ภาษีนิติบุคคล ประจำปี)',
    png51: 'ภ.ง.ด.51 (ภาษีนิติบุคคล ครึ่งปี)',
    png90: 'ภ.ง.ด.90 (ภาษีบุคคลธรรมดา)',
    png91: 'ภ.ง.ด.91 (ภาษีบุคคลธรรมดา เงินเดือน)',
  };
  const title = titles[obligation] ?? obligation;
  const when = days === 1 ? 'พรุ่งนี้' : `อีก ${days} วัน`;
  return `⏰ ใกล้ถึงกำหนดยื่นภาษี\n\n${title}\nงวด: ${period}\nกำหนดยื่น: ${dueDate} (${when})\n\nเปิดแอปเพื่อตรวจสอบและเตรียมยื่นได้เลยครับ`;
}
