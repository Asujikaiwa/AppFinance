import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../../supabase/migrations');

/**
 * The bare supabase/postgres image ships the *initial* storage schema; on a real
 * project the storage-api service migrates it forward. Shim what 0004 needs.
 */
const STORAGE_SHIM = `
  alter table storage.buckets add column if not exists public boolean default false;
  alter table storage.buckets add column if not exists file_size_limit bigint;
  alter table storage.buckets add column if not exists allowed_mime_types text[];
`;

/** Apply every migration, in order, to the (fresh) database at DB_TEST_URL. */
export default async function setup(): Promise<void> {
  const url = process.env.DB_TEST_URL;
  if (!url) throw new Error('DB_TEST_URL not set — run via `pnpm test:db`');

  // The shim needs the storage tables' owner; migrations run as `postgres`, like `supabase db push`.
  const adminUrl = process.env.DB_TEST_ADMIN_URL ?? url.replace('//postgres:', '//supabase_admin:');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(STORAGE_SHIM);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      try {
        await client.query(readFileSync(join(migrationsDir, f), 'utf8'));
      } catch (e) {
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}
