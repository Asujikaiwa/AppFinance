// Runs the DB integration suite against a throwaway Supabase Postgres container.
//
//   pnpm test:db                      → fresh container on :54339, run, leave it up
//   DB_TEST_URL=postgres://... pnpm test:db  → use an existing EMPTY database (CI)
import { execSync, spawnSync } from 'node:child_process';

const CONTAINER = 'appfinance_testdb';
const IMAGE = 'public.ecr.aws/supabase/postgres:15.8.1.085';
const PORT = 54339;

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
}

if (!process.env.DB_TEST_URL) {
  try {
    sh('docker info --format "{{.ServerVersion}}"');
  } catch {
    console.error('Docker is not running. Start Docker Desktop, or set DB_TEST_URL.');
    process.exit(1);
  }
  try { sh(`docker rm -f ${CONTAINER}`); } catch { /* not running */ }
  console.log(`Starting ${IMAGE} on :${PORT} ...`);
  sh(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -p ${PORT}:5432 ${IMAGE}`);

  // The image restarts postgres once after its init scripts; wait for a stable ready.
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-h', 'localhost']);
    stable = r.status === 0 ? stable + 1 : 0;
    await new Promise((res) => setTimeout(res, 1000));
  }
  if (stable < 3) {
    console.error('Postgres did not become ready.');
    process.exit(1);
  }
  process.env.DB_TEST_URL = `postgresql://postgres:postgres@localhost:${PORT}/postgres`;
}

const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(r.status ?? 1);
