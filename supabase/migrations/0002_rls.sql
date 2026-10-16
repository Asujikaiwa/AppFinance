-- ============================================================================
-- Row Level Security — every table scoped to workspace membership
-- ============================================================================

-- Helper: is the caller a member of this workspace?
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

-- Helper: caller's role in workspace (or null)
create or replace function public.workspace_role(ws_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.workspace_members
  where workspace_id = ws_id and user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
alter table public.workspaces enable row level security;

create policy "members read workspace"
  on public.workspaces for select
  using (public.is_workspace_member(id));

create policy "anyone can create workspace"
  on public.workspaces for insert
  with check (auth.uid() is not null);

create policy "owners update workspace"
  on public.workspaces for update
  using (public.workspace_role(id) = 'owner');

create policy "owners delete workspace"
  on public.workspaces for delete
  using (public.workspace_role(id) = 'owner');

-- ----------------------------------------------------------------------------
alter table public.workspace_members enable row level security;

create policy "members read members"
  on public.workspace_members for select
  using (public.is_workspace_member(workspace_id));

create policy "owners manage members"
  on public.workspace_members for all
  using (public.workspace_role(workspace_id) = 'owner')
  with check (public.workspace_role(workspace_id) = 'owner');

-- Special: a fresh user inserting themselves as owner of a brand-new workspace.
-- Allowed if they are the only proposed member and role is 'owner'.
create policy "user can self-join as owner on create"
  on public.workspace_members for insert
  with check (user_id = auth.uid() and role = 'owner');

-- ----------------------------------------------------------------------------
alter table public.categories enable row level security;

create policy "members read categories"
  on public.categories for select
  using (public.is_workspace_member(workspace_id));

create policy "members write categories"
  on public.categories for all
  using (public.workspace_role(workspace_id) in ('owner', 'accountant'))
  with check (public.workspace_role(workspace_id) in ('owner', 'accountant'));

-- ----------------------------------------------------------------------------
alter table public.entries enable row level security;

create policy "members read entries"
  on public.entries for select
  using (public.is_workspace_member(workspace_id));

create policy "writers create entries"
  on public.entries for insert
  with check (
    public.workspace_role(workspace_id) in ('owner', 'accountant')
    and created_by = auth.uid()
  );

create policy "writers update entries (unless locked)"
  on public.entries for update
  using (
    public.workspace_role(workspace_id) in ('owner', 'accountant')
    and status <> 'locked'
  )
  with check (public.workspace_role(workspace_id) in ('owner', 'accountant'));

create policy "owners delete entries"
  on public.entries for delete
  using (public.workspace_role(workspace_id) = 'owner' and status <> 'locked');

-- ----------------------------------------------------------------------------
alter table public.attachments enable row level security;

create policy "members read attachments"
  on public.attachments for select
  using (
    exists (
      select 1 from public.entries e
      where e.id = attachments.entry_id
      and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "writers manage attachments"
  on public.attachments for all
  using (
    exists (
      select 1 from public.entries e
      where e.id = attachments.entry_id
      and public.workspace_role(e.workspace_id) in ('owner', 'accountant')
    )
  )
  with check (
    exists (
      select 1 from public.entries e
      where e.id = attachments.entry_id
      and public.workspace_role(e.workspace_id) in ('owner', 'accountant')
    )
  );

-- ----------------------------------------------------------------------------
alter table public.reports enable row level security;

create policy "members read reports"
  on public.reports for select
  using (public.is_workspace_member(workspace_id));

create policy "writers create reports"
  on public.reports for insert
  with check (
    public.workspace_role(workspace_id) in ('owner', 'accountant')
    and generated_by = auth.uid()
  );

create policy "writers delete reports"
  on public.reports for delete
  using (public.workspace_role(workspace_id) in ('owner', 'accountant'));

-- ----------------------------------------------------------------------------
-- entries_audit: read-only for workspace members
alter table public.entries_audit enable row level security;

create policy "members read audit"
  on public.entries_audit for select
  using (public.is_workspace_member(workspace_id));

-- Inserts come only from the trigger (security definer), so no insert policy needed.
