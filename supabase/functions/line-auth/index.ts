/**
 * POST /functions/v1/line-auth
 * Deploy with --no-verify-jwt (called before the user has a Supabase session).
 *
 * Two modes:
 *   { mode: 'code',    code, redirectUri }  — LINE Login web redirect flow
 *   { mode: 'idToken', idToken }            — LIFF in-app flow
 *
 * Resolves the LINE profile, upserts line_identities, ensures a Supabase user,
 * and returns a Supabase session (access + refresh tokens) for the client.
 */
import { getAdminClient } from '../_shared/auth.ts';
import { errorResponse, handleCorsPreflight, json } from '../_shared/cors.ts';
import {
  exchangeCodeForProfile,
  verifyIdToken,
  type LineProfile,
} from '../_shared/line.ts';

interface Body {
  mode: 'code' | 'idToken';
  code?: string;
  redirectUri?: string;
  idToken?: string;
  lineUserId?: string; // optional hint when linking from rich menu
}

// We synthesize a deterministic email so a LINE user maps to one Supabase user.
function lineEmail(lineUserId: string): string {
  return `line_${lineUserId}@line.appfinance.app`;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  try {
    const body = (await req.json()) as Body;
    const admin = getAdminClient();

    let profile: LineProfile;
    if (body.mode === 'code') {
      if (!body.code || !body.redirectUri) {
        return errorResponse('code and redirectUri required');
      }
      profile = await exchangeCodeForProfile(body.code, body.redirectUri);
    } else if (body.mode === 'idToken') {
      if (!body.idToken) return errorResponse('idToken required');
      profile = await verifyIdToken(body.idToken);
    } else {
      return errorResponse('invalid mode');
    }

    const email = lineEmail(profile.userId);

    // Find the existing Supabase user via our own mapping table (O(1), reliable
    // at any scale — unlike paginating auth.admin.listUsers()).
    const { data: mapped } = await admin
      .from('line_identities')
      .select('user_id')
      .eq('line_user_id', profile.userId)
      .maybeSingle();

    let userId: string | null = mapped?.user_id ?? null;

    if (!userId) {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            line_user_id: profile.userId,
            display_name: profile.displayName,
            provider: 'line',
          },
        });
      if (createErr || !created.user) {
        // Most likely cause: the user already exists (race / re-link). Surface clearly.
        return errorResponse('Failed to create user', 500, createErr);
      }
      userId = created.user.id;
    }

    // Upsert the line_identities row.
    await admin.from('line_identities').upsert(
      {
        line_user_id: profile.userId,
        display_name: profile.displayName,
        picture_url: profile.pictureUrl ?? null,
        user_id: userId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: 'line_user_id' },
    );

    // Generate a session for the client. We use a magic-link generation then
    // exchange — simplest admin path to mint tokens without a password.
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkErr || !linkData) {
      return errorResponse('Failed to mint session', 500, linkErr);
    }

    // The client should call verifyOtp with this token_hash to get a session,
    // OR we can return the hashed token for the client to exchange.
    return json({
      user_id: userId,
      line_user_id: profile.userId,
      display_name: profile.displayName,
      // Client exchanges this via supabase.auth.verifyOtp({ type:'magiclink', token_hash })
      token_hash: linkData.properties?.hashed_token,
      email,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
