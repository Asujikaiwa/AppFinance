-- ============================================================================
-- AppFinance — initial schema
-- All money columns are BIGINT in satang (1 baht = 100 satang).
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- workspaces — a tax-paying entity (personal or company)
-- ----------------------------------------------------------------------------
create table public.workspaces (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  kind                text not null check (kind in ('personal', 'corporate')),
  tax_id              text,        -- 13-digit TIN; validated at app layer
  vat_registered      boolean not null default false,
  fiscal_year_start   smallint not null default 1 check (fiscal_year_start between 1 and 12),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- workspace_members — N:N between auth.users and workspaces with roles
-- ----------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner', 'accountant', 'viewer')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members(user_id);

-- ----------------------------------------------------------------------------
-- categories — chart of accounts per workspace
-- ----------------------------------------------------------------------------
create table public.categories (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  code                text not null,
  name_th             text not null,
  name_en             text,
  direction           text not null check (direction in ('income', 'expense')),
  deductible          boolean not null default true,
  vat_applicable      boolean not null default false,
  default_wht_rate    numeric(5, 4),
  is_system           boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (workspace_id, code)
);

create index categories_workspace_idx on public.categories(workspace_id);

-- ----------------------------------------------------------------------------
-- entries — the transactional record (income or expense)
-- ----------------------------------------------------------------------------
create table public.entries (
  id                      uuid primary key default uuid_generate_v4(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  direction               text not null check (direction in ('income', 'expense')),
  entry_date              date not null,
  doc_type                text not null check (doc_type in (
                            'tax_invoice_full', 'tax_invoice_abbr', 'receipt', 'invoice', 'other'
                          )),
  doc_number              text,
  counterparty_name       text,
  counterparty_tax_id     text,
  description             text not null,
  category_id             uuid references public.categories(id) on delete set null,
  amount_excl_vat         bigint not null check (amount_excl_vat >= 0),
  vat_amount              bigint not null default 0 check (vat_amount >= 0),
  amount_total            bigint generated always as (amount_excl_vat + vat_amount) stored,
  wht_rate                numeric(5, 4),
  wht_amount              bigint not null default 0 check (wht_amount >= 0),
  is_deductible           boolean not null default true,
  source                  text not null check (source in ('manual', 'chat', 'ocr', 'import')),
  ai_confidence           numeric(3, 2) check (ai_confidence between 0 and 1),
  status                  text not null default 'draft'
                            check (status in ('draft', 'confirmed', 'locked')),
  notes                   text,
  created_by              uuid not null references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index entries_workspace_date_idx on public.entries(workspace_id, entry_date desc);
create index entries_category_idx on public.entries(category_id);
create index entries_status_idx on public.entries(workspace_id, status);

-- ----------------------------------------------------------------------------
-- attachments — receipt images / PDFs stored in Supabase Storage
-- ----------------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default uuid_generate_v4(),
  entry_id        uuid not null references public.entries(id) on delete cascade,
  storage_path    text not null,
  mime_type       text not null,
  ocr_text        text,
  created_at      timestamptz not null default now()
);

create index attachments_entry_idx on public.attachments(entry_id);

-- ----------------------------------------------------------------------------
-- reports — generated filings (PND/PP forms, accountant packs)
-- ----------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  kind            text not null check (kind in (
                    'pp30', 'png1', 'png2', 'png3', 'png53', 'png54',
                    'png50', 'png51', 'png90', 'png91',
                    'accountant_pack'
                  )),
  period_start    date not null,
  period_end      date not null,
  storage_path    text,
  meta            jsonb not null default '{}'::jsonb,
  generated_by    uuid not null references auth.users(id),
  created_at      timestamptz not null default now()
);

create index reports_workspace_period_idx on public.reports(workspace_id, period_end desc);

-- ----------------------------------------------------------------------------
-- entries_audit — append-only audit log
-- ----------------------------------------------------------------------------
create table public.entries_audit (
  id              bigserial primary key,
  entry_id        uuid not null,
  workspace_id    uuid not null,
  actor_id        uuid not null,
  action          text not null check (action in ('insert', 'update', 'delete')),
  before          jsonb,
  after           jsonb,
  changed_at      timestamptz not null default now()
);

create index entries_audit_entry_idx on public.entries_audit(entry_id);
create index entries_audit_workspace_idx on public.entries_audit(workspace_id, changed_at desc);

-- ----------------------------------------------------------------------------
-- triggers: updated_at + audit
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger entries_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

create or replace function public.audit_entries()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.entries_audit(entry_id, workspace_id, actor_id, action, after)
      values (new.id, new.workspace_id, new.created_by, 'insert', to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into public.entries_audit(entry_id, workspace_id, actor_id, action, before, after)
      values (new.id, new.workspace_id, coalesce(auth.uid(), new.created_by), 'update',
              to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.entries_audit(entry_id, workspace_id, actor_id, action, before)
      values (old.id, old.workspace_id, coalesce(auth.uid(), old.created_by), 'delete',
              to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

create trigger entries_audit_trg
  after insert or update or delete on public.entries
  for each row execute function public.audit_entries();
