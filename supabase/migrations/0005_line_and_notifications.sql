-- ============================================================================
-- LINE identities, notification reminders, inbound email.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- line_identities — links a LINE user to a Supabase user + default workspace
-- ----------------------------------------------------------------------------
create table public.line_identities (
  line_user_id        text primary key,            -- LINE userId (U...)
  display_name        text,
  picture_url         text,
  user_id             uuid references auth.users(id) on delete set null,
  default_workspace   uuid references public.workspaces(id) on delete set null,
  linked_at           timestamptz,                 -- null until account linked
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index line_identities_user_idx on public.line_identities(user_id);

-- ----------------------------------------------------------------------------
-- reminders — filing obligations we proactively notify about
-- ----------------------------------------------------------------------------
create table public.reminders (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  obligation          text not null check (obligation in (
                        'pp30', 'png1', 'png3', 'png53',
                        'png50', 'png51', 'png90', 'png91'
                      )),
  period_label        text not null,               -- e.g. "2026-05" or "FY2025"
  due_date            date not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'notified', 'done', 'dismissed')),
  created_at          timestamptz not null default now(),
  unique (workspace_id, obligation, period_label)
);

create index reminders_due_idx on public.reminders(due_date) where status = 'pending';
create index reminders_workspace_idx on public.reminders(workspace_id, due_date);

-- ----------------------------------------------------------------------------
-- notification_log — every outbound message (idempotency + audit)
-- ----------------------------------------------------------------------------
create table public.notification_log (
  id                  bigserial primary key,
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  reminder_id         uuid references public.reminders(id) on delete set null,
  channel             text not null check (channel in ('line', 'email', 'push')),
  offset_days         smallint,                    -- e.g. 7, 3, 1 days before due
  recipient           text,                        -- line_user_id or email
  body                text,
  sent_at             timestamptz not null default now(),
  unique (reminder_id, channel, offset_days)       -- never double-send same offset
);

create index notification_log_workspace_idx on public.notification_log(workspace_id, sent_at desc);

-- ----------------------------------------------------------------------------
-- inbound_emails — raw forwarded emails before they become entries
-- ----------------------------------------------------------------------------
create table public.inbound_emails (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid references public.workspaces(id) on delete cascade,
  from_address        text,
  subject             text,
  received_at         timestamptz not null default now(),
  raw_storage_path    text,                        -- full MIME stored in 'reports' bucket
  attachment_count    smallint not null default 0,
  status              text not null default 'received'
                        check (status in ('received', 'processed', 'failed', 'ignored')),
  entries_created     smallint not null default 0,
  error               text
);

create index inbound_emails_workspace_idx on public.inbound_emails(workspace_id, received_at desc);

-- ----------------------------------------------------------------------------
-- workspace email token — for inbox+<token>@in.appfinance.app
-- ----------------------------------------------------------------------------
alter table public.workspaces
  add column email_token text unique default encode(gen_random_bytes(8), 'hex');

-- ----------------------------------------------------------------------------
-- triggers
-- ----------------------------------------------------------------------------
create trigger line_identities_updated_at
  before update on public.line_identities
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

-- line_identities: a user can only see/modify their own identity row
alter table public.line_identities enable row level security;

create policy "user reads own line identity"
  on public.line_identities for select
  using (user_id = auth.uid());

create policy "user updates own line identity"
  on public.line_identities for update
  using (user_id = auth.uid());

-- (inserts/links happen via service role in line-auth function)

-- reminders: workspace members read; writers manage
alter table public.reminders enable row level security;

create policy "members read reminders"
  on public.reminders for select
  using (public.is_workspace_member(workspace_id));

create policy "writers manage reminders"
  on public.reminders for all
  using (public.workspace_role(workspace_id) in ('owner', 'accountant'))
  with check (public.workspace_role(workspace_id) in ('owner', 'accountant'));

-- notification_log: members read only (writes via service role)
alter table public.notification_log enable row level security;

create policy "members read notifications"
  on public.notification_log for select
  using (public.is_workspace_member(workspace_id));

-- inbound_emails: members read only (writes via service role)
alter table public.inbound_emails enable row level security;

create policy "members read inbound emails"
  on public.inbound_emails for select
  using (public.is_workspace_member(workspace_id));
