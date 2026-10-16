-- ============================================================================
-- Workspace creation + member invite as security-definer RPCs.
--
-- create_workspace solves an RLS chicken-and-egg problem: a plain INSERT ...
-- RETURNING can't read the row back because the caller isn't a member yet.
-- This function inserts the workspace AND the owner membership atomically.
-- ============================================================================

create or replace function public.create_workspace(
  p_name text,
  p_kind text,
  p_vat boolean default false,
  p_tax_id text default null,
  p_fiscal_year_start smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('personal', 'corporate') then
    raise exception 'invalid kind';
  end if;

  insert into public.workspaces (name, kind, vat_registered, tax_id, fiscal_year_start)
    values (p_name, p_kind, coalesce(p_vat, false), p_tax_id, coalesce(p_fiscal_year_start, 1))
    returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, auth.uid(), 'owner');

  -- default categories are seeded by the workspaces_after_insert trigger
  return ws_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- invite_member_by_email — owner adds an existing user to the workspace.
-- Returns: 'ok' | 'not_owner' | 'user_not_found'
-- (Inviting users who don't yet have an account is a future email-invite flow.)
-- ----------------------------------------------------------------------------
create or replace function public.invite_member_by_email(
  p_workspace uuid,
  p_email text,
  p_role text default 'accountant'
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target uuid;
begin
  if public.workspace_role(p_workspace) <> 'owner' then
    return 'not_owner';
  end if;
  if p_role not in ('owner', 'accountant', 'viewer') then
    return 'invalid_role';
  end if;

  select id into target from auth.users where lower(email) = lower(p_email) limit 1;
  if target is null then
    return 'user_not_found';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace, target, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;

  return 'ok';
end;
$$;

grant execute on function public.create_workspace(text, text, boolean, text, smallint) to authenticated;
grant execute on function public.invite_member_by_email(uuid, text, text) to authenticated;
