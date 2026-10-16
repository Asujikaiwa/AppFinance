import { afterAll, describe, expect, it } from 'vitest';
import { addMember, asService, asUser, createUser, createWorkspace, insertEntry, pool, rejects } from './db';

afterAll(() => pool.end());

const TIN = '0105556012345';
const MASK = '*********2345';

describe('tax ID encryption (0011)', () => {
  it('encrypts on insert: column holds only a mask, ciphertext is not plaintext', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });

    const [row] = (await pool.query(
      `select counterparty_tax_id, counterparty_tax_id_enc from entries where id = $1`, [id])).rows;
    expect(row.counterparty_tax_id).toBe(MASK);
    expect(row.counterparty_tax_id_enc).toBeInstanceOf(Buffer);
    expect(row.counterparty_tax_id_enc.toString('latin1')).not.toContain(TIN);
  });

  it('the audit trail never captures the plaintext', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });
    await asUser(u, (q) => q(`update entries set description = 'edited' where id = $1`, [id]));
    const { rows } = await pool.query(`select before::text b, after::text a from entries_audit where entry_id = $1`, [id]);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(`${r.b} ${r.a}`).not.toContain(TIN);
    }
  });

  it('members can reveal; non-members get nothing', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner);
    await addMember(ws, viewer, 'viewer');
    const id = await insertEntry(owner, ws, { counterparty_tax_id: TIN });

    for (const uid of [owner, viewer]) {
      const rows = await asUser(uid, (q) => q(`select * from reveal_entry_tax_ids($1)`, [[id]]));
      expect(rows).toEqual([{ entry_id: id, tax_id: TIN }]);
    }
    expect(await asUser(outsider, (q) => q(`select * from reveal_entry_tax_ids($1)`, [[id]]))).toEqual([]);
  });

  it('service role can reveal (report generation)', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });
    const rows = await asService((q) => q(`select * from reveal_entry_tax_ids($1)`, [[id]]));
    expect(rows).toEqual([{ entry_id: id, tax_id: TIN }]);
  });

  it('echoing the mask back on update keeps the stored value', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });
    await asUser(u, (q) => q(`update entries set counterparty_tax_id = $2, description = 'x' where id = $1`, [id, MASK]));
    const rows = await asUser(u, (q) => q(`select tax_id from reveal_entry_tax_ids($1)`, [[id]]));
    expect(rows[0].tax_id).toBe(TIN);
  });

  it('a client cannot plant its own ciphertext', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });
    await asUser(u, (q) => q(`update entries set counterparty_tax_id_enc = '\\xdeadbeef' where id = $1`, [id]));
    const rows = await asUser(u, (q) => q(`select tax_id from reveal_entry_tax_ids($1)`, [[id]]));
    expect(rows[0].tax_id).toBe(TIN);
  });

  it('changing and clearing the tax ID re-encrypts / nulls both columns', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    const id = await insertEntry(u, ws, { counterparty_tax_id: TIN });
    await asUser(u, (q) => q(`update entries set counterparty_tax_id = '0994000165510' where id = $1`, [id]));
    expect((await asUser(u, (q) => q(`select tax_id from reveal_entry_tax_ids($1)`, [[id]])))[0].tax_id)
      .toBe('0994000165510');

    await asUser(u, (q) => q(`update entries set counterparty_tax_id = '' where id = $1`, [id]));
    const [row] = (await pool.query(
      `select counterparty_tax_id, counterparty_tax_id_enc from entries where id = $1`, [id])).rows;
    expect(row).toEqual({ counterparty_tax_id: null, counterparty_tax_id_enc: null });
  });

  it('inserting a masked value is rejected', async () => {
    const u = await createUser();
    const ws = await createWorkspace(u);
    expect(await rejects(insertEntry(u, ws, { counterparty_tax_id: MASK }))).toMatch(/masked value/);
  });

  it('workspace tax_id from onboarding is encrypted and revealable by members only', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner, TIN);
    const [w] = (await pool.query(`select tax_id from workspaces where id = $1`, [ws])).rows;
    expect(w.tax_id).toBe(MASK);
    expect((await asUser(owner, (q) => q(`select reveal_workspace_tax_id($1) t`, [ws])))[0].t).toBe(TIN);
    expect((await asUser(outsider, (q) => q(`select reveal_workspace_tax_id($1) t`, [ws])))[0].t).toBeNull();
  });

  it('the key and decrypt helpers are not callable by clients', async () => {
    const u = await createUser();
    expect(await rejects(asUser(u, (q) => q(`select private.pii_key()`)))).toMatch(/permission denied/);
    expect(await rejects(asUser(u, (q) => q(`select private.decrypt_pii('\\x00')`)))).toMatch(/permission denied/);
    expect(await rejects(asUser(u, (q) => q(`select decrypted_secret from vault.decrypted_secrets`))))
      .toMatch(/permission denied/);
  });
});
