import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Build a Supabase client scoped to the calling user's JWT.
 * RLS is enforced — the function cannot access data the user can't see.
 */
export function getUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Service-role client. ONLY use for trigger-like work that needs to bypass RLS. */
export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getCurrentUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Not authenticated');
  return data.user.id;
}
