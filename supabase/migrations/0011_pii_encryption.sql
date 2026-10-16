-- ============================================================================
-- At-rest encryption of Thai tax IDs (PDPA) — roadmap item 5.
--
-- Design: keep the API column names stable so clients don't break.
--   * entries.counterparty_tax_id / workspaces.tax_id now hold only a MASK
--     ("*********1234") — enough for "is a TIN present?" checks and display.
--   * The real value lives in *_enc (pgp_sym_encrypt, key in Supabase Vault).
--   * A BEFORE trigger encrypts whatever plaintext a client writes. If a client
--     echoes the mask back unchanged, the stored ciphertext is kept.
--   * Full values are readable only through reveal_* RPCs that re-check
--     workspace membership (or the service role, for report generation).
--   * The key is never reachable from client SQL: private.pii_key() is not
--     executable by anon/authenticated, and the `private` schema isn't exposed.
--
-- KEY: generated once inside the DB on first run (vault secret "pii_key").
-- Losing it means losing every stored TIN — it is covered by Supabase's
-- managed backups together with the vault; never delete/recreate it.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pii_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'pii_key',
      'Symmetric key for tax-ID column encryption (migration 0011)'
    );
  end if;
end;
$$;

create or replace function private.pii_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pii_key' limit 1;
  if k is null then
    raise exception 'pii_key missing from vault';
  end if;
  return k;
end;
$$;

revoke execute on function private.pii_key() from public, anon, authenticated;

-- "1234567890123" -> "*********0123". Masks always start with '*'; real TINs never do.
create or replace function private.mask_tin(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null
              else repeat('*', greatest(length(p) - 4, 0)) || right(p, 4) end;
$$;

create or replace function private.encrypt_pii(p text)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.pgp_sym_encrypt(p, private.pii_key(), 'cipher-algo=aes256');
$$;

create or replace function private.decrypt_pii(p bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p is null then null
              else extensions.pgp_sym_decrypt(p, private.pii_key()) end;
$$;

revoke execute on function private.mask_tin(text) from public, anon, authenticated;
revoke execute on function private.encrypt_pii(text) from public, anon, authenticated;
revoke execute on function private.decrypt_pii(bytea) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Columns
-- ----------------------------------------------------------------------------
alter table public.entries add column counterparty_tax_id_enc bytea;
alter table public.workspaces add column tax_id_enc bytea;

-- Members can technically select the ciphertext (a column-level REVOKE is a no-op
-- under Supabase's table-level grants), but it is useless without the key, which
-- only the security-definer functions below can reach.

-- ----------------------------------------------------------------------------
-- Backfill existing plaintext (triggers off: no audit spam / updated_at churn)
-- ----------------------------------------------------------------------------
alter table public.entries disable trigger entries_audit_trg;
alter table public.entries disable trigger entries_updated_at;

update public.entries
   set counterparty_tax_id_enc = private.encrypt_pii(counterparty_tax_id),
       counterparty_tax_id     = private.mask_tin(counterparty_tax_id)
 where counterparty_tax_id is not null and left(counterparty_tax_id, 1) <> '*';

alter table public.entries enable trigger entries_audit_trg;
alter table public.entries enable trigger entries_updated_at;

alter table public.workspaces disable trigger workspaces_updated_at;

update public.workspaces
   set tax_id_enc = private.encrypt_pii(tax_id),
       tax_id     = private.mask_tin(tax_id)
 where tax_id is not null and left(tax_id, 1) <> '*';

alter table public.workspaces enable trigger workspaces_updated_at;

-- The audit trail captured plaintext TINs in its jsonb snapshots; mask them.
update public.entries_audit
   set before = case when before ->> 'counterparty_tax_id' is not null
                     then jsonb_set(before, '{counterparty_tax_id}',
                                    to_jsonb(private.mask_tin(before ->> 'counterparty_tax_id')))
                     else before end,
       after  = case when after ->> 'counterparty_tax_id' is not null
                     then jsonb_set(after, '{counterparty_tax_id}',
                                    to_jsonb(private.mask_tin(after ->> 'counterparty_tax_id')))
                     else after end
 where left(coalesce(before ->> 'counterparty_tax_id', after ->> 'counterparty_tax_id', '*'), 1) <> '*';

-- ----------------------------------------------------------------------------
-- Encrypt-on-write triggers
-- ----------------------------------------------------------------------------
create or replace function private.entries_encrypt_tin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.counterparty_tax_id is null or btrim(new.counterparty_tax_id) = '' then
    new.counterparty_tax_id := null;
    new.counterparty_tax_id_enc := null;
  elsif left(new.counterparty_tax_id, 1) = '*' then
    -- mask echoed back by a client: keep what is stored (never trust client ciphertext)
    if tg_op = 'INSERT' then
      raise exception 'counterparty_tax_id: masked value cannot be inserted';
    end if;
    new.counterparty_tax_id := old.counterparty_tax_id;
    new.counterparty_tax_id_enc := old.counterparty_tax_id_enc;
  else
    new.counterparty_tax_id_enc := private.encrypt_pii(new.counterparty_tax_id);
    new.counterparty_tax_id := private.mask_tin(new.counterparty_tax_id);
  end if;
  return new;
end;
$$;

create trigger entries_encrypt_tin
  before insert or update on public.entries
  for each row execute function private.entries_encrypt_tin();

create or replace function private.workspaces_encrypt_tin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tax_id is null or btrim(new.tax_id) = '' then
    new.tax_id := null;
    new.tax_id_enc := null;
  elsif left(new.tax_id, 1) = '*' then
    if tg_op = 'INSERT' then
      raise exception 'tax_id: masked value cannot be inserted';
    end if;
    new.tax_id := old.tax_id;
    new.tax_id_enc := old.tax_id_enc;
  else
    new.tax_id_enc := private.encrypt_pii(new.tax_id);
    new.tax_id := private.mask_tin(new.tax_id);
  end if;
  return new;
end;
$$;

create trigger workspaces_encrypt_tin
  before insert or update on public.workspaces
  for each row execute function private.workspaces_encrypt_tin();

-- ----------------------------------------------------------------------------
-- Read path: membership-checked decryption
-- ----------------------------------------------------------------------------
create or replace function public.reveal_entry_tax_ids(p_entry_ids uuid[])
returns table (entry_id uuid, tax_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, private.decrypt_pii(e.counterparty_tax_id_enc)
    from public.entries e
   where e.id = any(p_entry_ids)
     and e.counterparty_tax_id_enc is not null
     and (auth.role() = 'service_role' or public.is_workspace_member(e.workspace_id));
$$;

create or replace function public.reveal_workspace_tax_id(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.decrypt_pii(w.tax_id_enc)
    from public.workspaces w
   where w.id = p_workspace
     and (auth.role() = 'service_role' or public.is_workspace_member(w.id));
$$;

revoke execute on function public.reveal_entry_tax_ids(uuid[]) from public, anon;
revoke execute on function public.reveal_workspace_tax_id(uuid) from public, anon;
grant execute on function public.reveal_entry_tax_ids(uuid[]) to authenticated, service_role;
grant execute on function public.reveal_workspace_tax_id(uuid) to authenticated, service_role;
