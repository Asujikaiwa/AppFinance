/**
 * POST /functions/v1/ocr-receipt
 * Body: { workspaceId, storagePath }
 *
 * Downloads the receipt image from Storage, extracts structured fields via the
 * vision tier, inserts as a draft entry, links the attachment.
 *
 * All AI routing/quota/usage-logging/heuristic lives in _shared/extract.ts.
 */
import { getCurrentUserId, getUserClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import { extractFromImage, insertExtractedEntry } from '../_shared/extract.ts';

interface RequestBody {
  workspaceId: string;
  storagePath: string; // e.g., "<workspace_id>/<uuid>/receipt.jpg"
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.workspaceId || !body.storagePath) {
      return errorResponse('workspaceId and storagePath are required');
    }

    const supabase = getUserClient(req);
    const userId = await getCurrentUserId(supabase);

    // Download the file (RLS lets workspace members read)
    const { data: file, error: dlErr } = await supabase.storage
      .from('receipts')
      .download(body.storagePath);
    if (dlErr || !file) return errorResponse('Cannot read receipt', 403, dlErr);

    const arrayBuf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
    const mimeType = file.type || 'image/jpeg';

    const extracted = await extractFromImage(
      supabase,
      body.workspaceId,
      base64,
      mimeType,
      { fn: 'ocr-receipt', createdBy: userId },
    );

    const entry = await insertExtractedEntry(supabase, {
      workspaceId: body.workspaceId,
      createdBy: userId,
      source: 'ocr',
      extracted,
      autoConfirm: false, // OCR always needs human confirm
    });

    // Link the attachment
    const { error: attErr } = await supabase.from('attachments').insert({
      entry_id: entry.id,
      storage_path: body.storagePath,
      mime_type: mimeType,
      ocr_text: JSON.stringify(extracted),
    });
    if (attErr) {
      return json({ entry, ai: extracted, warning: 'attachment link failed' });
    }

    return json({ entry, ai: extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('QUOTA_EXCEEDED') ? 429 : 500;
    return errorResponse(msg, status);
  }
});
