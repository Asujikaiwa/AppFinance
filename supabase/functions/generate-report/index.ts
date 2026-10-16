/**
 * POST /functions/v1/generate-report
 * Body: { workspaceId, kind, periodStart, periodEnd }
 *   kind = 'pp30'            → single .xlsx (summary + sales + purchase reports)
 *        = 'accountant_pack' → .zip (.xlsx with all sheets + receipts/ + README)
 *
 * Builds the file, uploads to the private 'reports' bucket, logs a `reports`
 * row, and returns a short-lived signed URL.
 *
 * Only confirmed/locked entries are included (drafts are excluded from filings).
 */
import * as XLSX from 'npm:xlsx@0.18.5';
import JSZip from 'npm:jszip@3.10.1';

import { getCurrentUserId, getUserClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import {
  allEntriesAoA,
  buildPp30Summary,
  pp30SummaryAoA,
  purchaseReportAoA,
  salesReportAoA,
  whtReportAoA,
  type EntryRow,
} from '../_shared/reports.ts';

interface RequestBody {
  workspaceId: string;
  kind: 'pp30' | 'accountant_pack';
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
}

function sheetFromAoA(aoa: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable default column widths
  ws['!cols'] = (aoa[1] ?? aoa[0] ?? []).map(() => ({ wch: 18 }));
  return ws;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.workspaceId || !body.kind || !body.periodStart || !body.periodEnd) {
      return errorResponse('workspaceId, kind, periodStart, periodEnd required');
    }

    const supabase = getUserClient(req);
    const userId = await getCurrentUserId(supabase);

    // Pull entries in range (exclude drafts — only filed-quality data)
    const { data: rawEntries, error: qErr } = await supabase
      .from('entries')
      .select(`
        id, direction, entry_date, doc_type, doc_number,
        counterparty_name, counterparty_tax_id, description,
        amount_excl_vat, vat_amount, wht_rate, wht_amount,
        categories ( name_th )
      `)
      .eq('workspace_id', body.workspaceId)
      .gte('entry_date', body.periodStart)
      .lte('entry_date', body.periodEnd)
      .neq('status', 'draft')
      .order('entry_date', { ascending: true });
    if (qErr) return errorResponse('Query failed', 500, qErr);

    const entries = (rawEntries ?? []) as unknown as (EntryRow & { id: string })[];

    // counterparty_tax_id is only a mask (migration 0011) — filings need the real TIN.
    const masked = entries.filter((e) => e.counterparty_tax_id).map((e) => e.id);
    const tins = new Map<string, string>();
    for (let i = 0; i < masked.length; i += 500) {
      const { data: revealed, error: rErr } = await supabase.rpc('reveal_entry_tax_ids', {
        p_entry_ids: masked.slice(i, i + 500),
      });
      if (rErr) return errorResponse('Tax ID lookup failed', 500, rErr);
      for (const r of (revealed ?? []) as { entry_id: string; tax_id: string }[]) {
        tins.set(r.entry_id, r.tax_id);
      }
    }
    for (const e of entries) {
      if (e.counterparty_tax_id) e.counterparty_tax_id = tins.get(e.id) ?? e.counterparty_tax_id;
    }

    const periodLabel = `${body.periodStart} ถึง ${body.periodEnd}`;
    const summary = buildPp30Summary(entries);

    // ---- Build the workbook ----
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(pp30SummaryAoA(summary, periodLabel)), 'ภพ30');
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(salesReportAoA(entries)), 'รายงานภาษีขาย');
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(purchaseReportAoA(entries)), 'รายงานภาษีซื้อ');

    if (body.kind === 'accountant_pack') {
      XLSX.utils.book_append_sheet(wb, sheetFromAoA(whtReportAoA(entries)), 'ภงด3-53');
      XLSX.utils.book_append_sheet(wb, sheetFromAoA(allEntriesAoA(entries)), 'รายการทั้งหมด');
    }

    const xlsxBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const periodSlug = `${body.periodStart}_${body.periodEnd}`;

    let uploadBytes: Uint8Array;
    let ext: string;
    let contentType: string;

    if (body.kind === 'pp30') {
      uploadBytes = new Uint8Array(xlsxBytes);
      ext = 'xlsx';
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      // Accountant pack: ZIP the workbook + receipts + a README
      const zip = new JSZip();
      zip.file(`ภพ30_${periodSlug}.xlsx`, new Uint8Array(xlsxBytes));
      zip.file(
        'README.txt',
        [
          'AppFinance — ชุดเอกสารสำหรับสำนักงานบัญชี',
          `งวด: ${periodLabel}`,
          '',
          'ไฟล์ในชุดนี้:',
          '- ภพ30_*.xlsx : สรุป ภ.พ.30 + รายงานภาษีขาย/ซื้อ + ภ.ง.ด.3/53 + รายการทั้งหมด',
          '- receipts/   : รูปใบเสร็จ/ใบกำกับภาษีที่แนบไว้',
          '',
          'หมายเหตุ: รวมเฉพาะรายการที่ยืนยันแล้ว (ไม่รวมฉบับร่าง)',
        ].join('\n'),
      );

      // Best-effort: attach receipt files referenced this period (cap to avoid timeouts)
      const { data: atts } = await supabase
        .from('attachments')
        .select('storage_path, entry_id, entries!inner(workspace_id, entry_date, status)')
        .eq('entries.workspace_id', body.workspaceId)
        .gte('entries.entry_date', body.periodStart)
        .lte('entries.entry_date', body.periodEnd)
        .neq('entries.status', 'draft')
        .limit(200);

      const receipts = zip.folder('receipts')!;
      for (const a of atts ?? []) {
        try {
          const { data: file } = await supabase.storage
            .from('receipts')
            .download(a.storage_path);
          if (file) {
            const name = a.storage_path.split('/').pop() ?? `${a.entry_id}.bin`;
            receipts.file(name, new Uint8Array(await file.arrayBuffer()));
          }
        } catch {
          // skip unreadable attachment
        }
      }

      uploadBytes = await zip.generateAsync({ type: 'uint8array' });
      ext = 'zip';
      contentType = 'application/zip';
    }

    // ---- Upload + sign ----
    const storagePath = `${body.workspaceId}/${body.kind}_${periodSlug}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('reports')
      .upload(storagePath, uploadBytes, { contentType, upsert: true });
    if (upErr) return errorResponse('Upload failed', 500, upErr);

    const { data: signed, error: signErr } = await supabase.storage
      .from('reports')
      .createSignedUrl(storagePath, 3600); // 1 hour
    if (signErr) return errorResponse('Sign failed', 500, signErr);

    // Log the report
    await supabase.from('reports').insert({
      workspace_id: body.workspaceId,
      kind: body.kind === 'pp30' ? 'pp30' : 'accountant_pack',
      period_start: body.periodStart,
      period_end: body.periodEnd,
      storage_path: storagePath,
      meta: summary,
      generated_by: userId,
    });

    return json({
      url: signed.signedUrl,
      storagePath,
      summary,
      entryCount: entries.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
