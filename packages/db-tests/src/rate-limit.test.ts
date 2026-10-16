import { afterAll, describe, expect, it } from 'vitest';
import { asService, asUser, createUser, createWorkspace, pool, rejects, type Q } from './db';

afterAll(() => pool.end());

/**
 * Consume `n` calls. Runs inside ONE transaction so now() — and therefore the
 * one-minute window — is fixed; otherwise a burst could straddle a minute boundary.
 */
const burst = (ws: string, n: number) => async (q: Q) => {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    out.push((await q(`select public.consume_ai_rate_limit($1) as ok`, [ws]))[0].ok as boolean);
  }
  return out;
};

describe('AI rate limit (0012)', () => {
  it('free plan allows 20 calls per minute, then blocks', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const results = await asUser(u, burst(ws, 22));
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results.slice(20)).toEqual([false, false]);
  });

  it('limits are per workspace', async () => {
    const u = await createUser();
    const ws1 = await createWorkspace(u);
    const ws2 = await createWorkspace(u);
    const [r1, r2] = await asUser(u, async (q) => [await burst(ws1, 21)(q), await burst(ws2, 1)(q)]);
    expect(r1[20]).toBe(false);
    expect(r2).toEqual([true]);
  });

  it('pro plan gets a higher limit', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    await pool.query(`update workspaces set plan = 'pro' where id = $1`, [ws]);
    const results = await asUser(u, burst(ws, 61));
    expect(results.slice(0, 60).every(Boolean)).toBe(true);
    expect(results[60]).toBe(false);
  });

  it('a non-member cannot burn another workspace\'s limit', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const ws = await createWorkspace(owner);
    expect(await rejects(asUser(attacker, burst(ws, 1)))).toMatch(/not a member/);
  });

  it('service role (LINE / email channels) is counted too', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const results = await asService(burst(ws, 21));
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
  });

  it('the counter table is not reachable by clients', async () => {
    const u = await createUser();
    expect(await rejects(asUser(u, (q) => q('select * from private.rate_limits')))).toMatch(/permission denied/);
  });
});
