/**
 * POST /functions/v1/chat-log
 * Body: { workspaceId, message }
 *
 * Parses a free-text message ("จ่ายค่าน้ำมัน 1,200 บาท ที่ปตท ใบเสร็จ A123")
 * into a structured entry, inserts it, and returns the saved row.
 *
 * All AI routing/quota/usage-logging/heuristic lives in _shared/extract.ts.
 */
import { getCurrentUserId, getUserClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import { extractFromText, insertExtractedEntry } from '../_shared/extract.ts';

interface RequestBody {
  workspaceId: string;
  message: string;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.workspaceId || !body.message) {
      return errorResponse('workspaceId and message are required');
    }

    const supabase = getUserClient(req);
    const userId = await getCurrentUserId(supabase);

    const extracted = await extractFromText(supabase, body.workspaceId, body.message, {
      fn: 'chat-log',
      createdBy: userId,
    });

    if (extracted.confidence < 0.3) {
      return json({ entry: null, ai: extracted, needsClarification: true });
    }

    const entry = await insertExtractedEntry(supabase, {
      workspaceId: body.workspaceId,
      createdBy: userId,
      source: 'chat',
      extracted,
      autoConfirm: true,
    });

    return json({ entry, ai: extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('QUOTA_EXCEEDED') ? 429 : 500;
    return errorResponse(msg, status);
  }
});
