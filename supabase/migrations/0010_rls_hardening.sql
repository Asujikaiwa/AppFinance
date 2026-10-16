-- ============================================================================
-- RLS hardening — closes holes found while writing the RLS integration tests
-- (packages/db-tests). Each fix has a matching test.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Workspace takeover: "user can self-join as owner on create" let ANY
--    authenticated user insert themselves as owner of ANY workspace whose id
--    they knew. Workspace creation now goes through create_workspace() (0009),
--    which inserts the owner row as security definer, so the policy is dropped.
-- ----------------------------------------------------------------------------
drop policy if exists "user can self-join as owner on create" on public.workspace_members;

-- ----------------------------------------------------------------------------
-- 2. Billing bypass: owners could `update workspaces set plan = 'unlimited'`
--    (and direct inserts could pick any plan). Restrict client writes to the
--    user-editable columns; `plan` / `email_token` change only via service role.
-- ----------------------------------------------------------------------------
revoke insert, update on public.workspaces from anon, authenticated;
grant update (name, kind, tax_id, vat_registered, fiscal_year_start)
  on public.workspaces to authenticated;

drop policy if exists "anyone can create workspace" on public.workspaces;

-- ----------------------------------------------------------------------------
-- 3. Cross-tenant write via LINE: a user could point their line_identities
--    .default_workspace at someone else's workspace; line-webhook (service role)
--    would then insert entries there. Require membership of the target.
-- ----------------------------------------------------------------------------
drop policy if exists "user updates own line identity" on public.line_identities;

create policy "user updates own line identity"
  on public.line_identities for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (default_workspace is null or public.is_workspace_member(default_workspace))
  );

-- ----------------------------------------------------------------------------
-- 4. Usage view leak: views run with the owner's rights by default, so
--    ai_usage_month exposed every workspace's usage to any user.
-- ----------------------------------------------------------------------------
alter view public.ai_usage_month set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 5. Quota bypass: writers insert their own ai_usage rows (user-JWT functions),
--    so a negative cost row could cancel out the monthly quota.
-- ----------------------------------------------------------------------------
alter table public.ai_usage
  add constraint ai_usage_non_negative check (
    input_tokens >= 0 and output_tokens >= 0 and estimated_cost_satang >= 0
  );
