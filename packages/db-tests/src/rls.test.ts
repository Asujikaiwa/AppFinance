import { afterAll, describe, expect, it } from 'vitest';
import { addMember, asService, asUser, createUser, createWorkspace, insertEntry, pool, rejects } from './db';

afterAll(() => pool.end());

describe('workspace isolation', () => {
  it('a user only sees workspaces, entries and categories they belong to', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const wsA = await createWorkspace(alice);
    const wsB = await createWorkspace(bob);
    await insertEntry(alice, wsA);
    await insertEntry(bob, wsB);

    await asUser(alice, async (q) => {
      expect((await q('select id from workspaces')).map((r) => r.id)).toEqual([wsA]);
      const entries = await q('select workspace_id from entries');
      expect(entries.length).toBe(1);
      expect(entries[0].workspace_id).toBe(wsA);
      expect(await q('select 1 from categories where workspace_id = $1', [wsB])).toEqual([]);
      expect(await q('select 1 from entries_audit where workspace_id = $1', [wsB])).toEqual([]);
    });
  });

  it('create_workspace seeds the owner membership and default categories', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    await asUser(u, async (q) => {
      const [m] = await q('select role from workspace_members where workspace_id = $1', [ws]);
      expect(m.role).toBe('owner');
      const [c] = await q('select count(*)::int as n from categories where workspace_id = $1', [ws]);
      expect(c.n).toBeGreaterThan(10);
    });
  });

  it('a non-member cannot insert entries into another workspace', async () => {
    const alice = await createUser();
    const mallory = await createUser('mallory');
    const wsA = await createWorkspace(alice);
    const msg = await rejects(insertEntry(mallory, wsA));
    expect(msg).toMatch(/row-level security/);
  });

  it('a non-member cannot update or delete another workspace\'s entries (0 rows)', async () => {
    const alice = await createUser();
    const mallory = await createUser();
    const wsA = await createWorkspace(alice);
    const id = await insertEntry(alice, wsA);
    await asUser(mallory, async (q) => {
      expect(await q(`update entries set description = 'pwned' where id = $1 returning id`, [id])).toEqual([]);
      expect(await q(`delete from entries where id = $1 returning id`, [id])).toEqual([]);
    });
  });
});

describe('roles', () => {
  it('viewer can read but not write entries', async () => {
    const owner = await createUser();
    const viewer = await createUser('viewer');
    const ws = await createWorkspace(owner);
    const id = await insertEntry(owner, ws);
    await addMember(ws, viewer, 'viewer');

    await asUser(viewer, async (q) => {
      expect((await q('select id from entries')).map((r) => r.id)).toEqual([id]);
      expect(await q(`update entries set description = 'x' where id = $1 returning id`, [id])).toEqual([]);
    });
    expect(await rejects(insertEntry(viewer, ws))).toMatch(/row-level security/);
  });

  it('accountant can write entries but not delete them or manage members', async () => {
    const owner = await createUser();
    const acct = await createUser('acct');
    const ws = await createWorkspace(owner);
    await addMember(ws, acct, 'accountant');
    const id = await insertEntry(acct, ws);

    await asUser(acct, async (q) => {
      expect(await q(`update entries set description = 'fixed' where id = $1 returning id`, [id])).toHaveLength(1);
      expect(await q(`delete from entries where id = $1 returning id`, [id])).toEqual([]);
    });
    const outsider = await createUser();
    expect(await rejects(asUser(acct, (q) =>
      q(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [ws, outsider]),
    ))).toMatch(/row-level security/);
  });

  it('locked entries cannot be edited or deleted, even by the owner', async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner);
    const id = await insertEntry(owner, ws, { status: 'locked' });
    await asUser(owner, async (q) => {
      expect(await q(`update entries set amount_excl_vat = 1 where id = $1 returning id`, [id])).toEqual([]);
      expect(await q(`delete from entries where id = $1 returning id`, [id])).toEqual([]);
    });
  });

  it('a writer cannot spoof created_by', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ws = await createWorkspace(owner);
    expect(await rejects(asUser(owner, (q) =>
      q(`insert into entries (workspace_id, direction, entry_date, doc_type, description, amount_excl_vat, source, created_by)
         values ($1, 'expense', '2026-10-01', 'receipt', 'x', 1, 'manual', $2)`, [ws, other]),
    ))).toMatch(/row-level security/);
  });
});

describe('invite_member_by_email', () => {
  it('only an owner can invite', async () => {
    const owner = await createUser();
    const acct = await createUser();
    const target = await createUser('target');
    const ws = await createWorkspace(owner);
    await addMember(ws, acct, 'accountant');
    const [{ email }] = (await pool.query('select email from auth.users where id = $1', [target])).rows;

    const res = await asUser(acct, (q) => q(`select public.invite_member_by_email($1, $2) as r`, [ws, email]));
    expect(res[0].r).toBe('not_owner');

    const ok = await asUser(owner, (q) => q(`select public.invite_member_by_email($1, $2) as r`, [ws, email]));
    expect(ok[0].r).toBe('ok');
    await asUser(target, async (q) => {
      expect((await q('select id from workspaces')).map((r) => r.id)).toEqual([ws]);
    });
  });
});

describe('hardening (0010)', () => {
  it('a user cannot self-join someone else\'s workspace as owner', async () => {
    const victim = await createUser();
    const attacker = await createUser('attacker');
    const ws = await createWorkspace(victim);
    expect(await rejects(asUser(attacker, (q) =>
      q(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws, attacker]),
    ))).toMatch(/row-level security/);
  });

  it('an owner cannot upgrade their own plan', async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner);
    expect(await rejects(asUser(owner, (q) =>
      q(`update workspaces set plan = 'unlimited' where id = $1`, [ws]),
    ))).toMatch(/permission denied/);
    // ...but can still edit their profile fields
    await asUser(owner, async (q) => {
      expect(await q(`update workspaces set name = 'Renamed' where id = $1 returning id`, [ws])).toHaveLength(1);
    });
  });

  it('workspaces cannot be inserted directly (must use create_workspace)', async () => {
    const u = await createUser();
    expect(await rejects(asUser(u, (q) =>
      q(`insert into workspaces (name, kind, plan) values ('x', 'personal', 'unlimited')`),
    ))).toMatch(/permission denied/);
  });

  it('LINE default_workspace can only point at a workspace the user belongs to', async () => {
    const victim = await createUser();
    const attacker = await createUser();
    const wsVictim = await createWorkspace(victim);
    const wsOwn = await createWorkspace(attacker);
    const lineId = `U${attacker.replace(/-/g, '')}`;
    await asService((q) => q(`insert into line_identities (line_user_id, user_id) values ($1, $2)`, [lineId, attacker]));

    expect(await rejects(asUser(attacker, (q) =>
      q(`update line_identities set default_workspace = $1 where line_user_id = $2`, [wsVictim, lineId]),
    ))).toMatch(/row-level security/);
    await asUser(attacker, async (q) => {
      expect(await q(`update line_identities set default_workspace = $1 where line_user_id = $2 returning 1`, [wsOwn, lineId]))
        .toHaveLength(1);
    });
  });

  it('ai_usage_month only shows the caller\'s workspaces', async () => {
    const a = await createUser();
    const b = await createUser();
    const wsA = await createWorkspace(a);
    const wsB = await createWorkspace(b);
    await asUser(a, (q) => q(`insert into ai_usage (workspace_id, estimated_cost_satang) values ($1, 5)`, [wsA]));
    await asUser(b, (q) => q(`insert into ai_usage (workspace_id, estimated_cost_satang) values ($1, 7)`, [wsB]));
    await asUser(a, async (q) => {
      const rows = await q('select workspace_id from ai_usage_month');
      expect(rows.map((r) => r.workspace_id)).toEqual([wsA]);
    });
  });

  it('negative ai_usage cost (quota bypass) is rejected', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    expect(await rejects(asUser(u, (q) =>
      q(`insert into ai_usage (workspace_id, estimated_cost_satang) values ($1, -100000)`, [ws]),
    ))).toMatch(/ai_usage_non_negative/);
  });

  it('service-only tables are invisible to users', async () => {
    const u = await createUser();
    await asService((q) => q(`insert into processed_line_events (event_id) values ($1)`, [`evt-${u}`]));
    await asUser(u, async (q) => {
      expect(await q('select * from processed_line_events')).toEqual([]);
    });
  });
});

describe('storage policies', () => {
  it('receipts are readable only by members of the workspace folder', async () => {
    const a = await createUser();
    const b = await createUser();
    const wsA = await createWorkspace(a);
    await asService((q) => q(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${wsA}/e1/r.jpg`]));
    await asUser(a, async (q) => {
      expect(await q(`select name from storage.objects where bucket_id = 'receipts' and name like $1`, [`${wsA}/%`])).toHaveLength(1);
    });
    await asUser(b, async (q) => {
      expect(await q(`select name from storage.objects where bucket_id = 'receipts' and name like $1`, [`${wsA}/%`])).toEqual([]);
    });
  });
});
