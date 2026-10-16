import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DB_TEST_URL, max: 4 });

export type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult['rows']>;

/** Create an auth user directly (as the migration owner). */
export async function createUser(label = 'u'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `${label}-${id.slice(0, 8)}@test.local`],
  );
  return id;
}

/**
 * Run `fn` exactly like a PostgREST request from a signed-in user: role
 * `authenticated`, RLS on, JWT claims set. Commits on success.
 */
export async function asUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  return asRole('authenticated', userId, fn);
}

/** Same, as the service role (edge functions using the admin client). */
export async function asService<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return asRole('service_role', null, fn);
}

async function asRole<T>(role: string, sub: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true),
                               set_config('request.jwt.claim.role', $2, true),
                               set_config('request.jwt.claims', $3, true)`,
      [sub ?? '', role, JSON.stringify({ sub, role })]);
    await client.query(`set local role ${role}`);
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Create a workspace owned by `ownerId` via the real onboarding RPC. */
export async function createWorkspace(ownerId: string, taxId: string | null = null): Promise<string> {
  return asUser(ownerId, async (q) => {
    const [row] = await q(`select public.create_workspace($1, 'corporate', true, $2) as id`, [
      `ws-${randomUUID().slice(0, 6)}`,
      taxId,
    ]);
    return row.id as string;
  });
}

/** Add a member directly (bypasses RLS — test fixture only). */
export async function addMember(workspaceId: string, userId: string, role: string): Promise<void> {
  await pool.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
    [workspaceId, userId, role],
  );
}

export async function insertEntry(
  userId: string,
  workspaceId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const cols = {
    workspace_id: workspaceId,
    direction: 'expense',
    entry_date: '2026-10-01',
    doc_type: 'tax_invoice_full',
    description: 'test entry',
    amount_excl_vat: 10000,
    vat_amount: 700,
    source: 'manual',
    created_by: userId,
    ...extra,
  };
  const keys = Object.keys(cols);
  return asUser(userId, async (q) => {
    const [row] = await q(
      `insert into public.entries (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(cols),
    );
    return row.id as string;
  });
}

/** Expect a promise to reject with a Postgres error (RLS / privilege / check). */
export async function rejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected the query to be rejected, but it succeeded');
}
