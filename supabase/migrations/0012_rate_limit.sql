-- ============================================================================
-- Per-minute AI rate limit (roadmap item 7). The monthly quota (0007) caps
-- spend; this caps bursts — a script hammering chat-log/ocr-receipt, or a
-- LINE/email loop — before they hit the model provider.
--
-- Fixed one-minute windows per workspace, counted atomically with an upsert.
-- Called by enforceQuota() in supabase/functions/_shared/usage.ts.
-- ============================================================================

create table private.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

create index rate_limits_window_idx on private.rate_limits(window_start);

-- Calls per minute per workspace, by plan.
create or replace function private.ai_rate_limit_for(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'unlimited' then 120 when 'pro' then 60 else 20 end;
$$;

-- Returns true if the call is allowed (and counts it), false if over the limit.
create or replace function public.consume_ai_rate_limit(p_workspace uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_hits integer;
  v_window timestamptz := date_trunc('minute', now());
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(p_workspace)) then
    raise exception 'not a member of this workspace';
  end if;

  select plan into v_plan from public.workspaces where id = p_workspace;

  insert into private.rate_limits as r (key, window_start, hits)
    values ('ai:' || p_workspace, v_window, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;

  -- Opportunistic cleanup of old windows (~1% of calls).
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 hour';
  end if;

  return v_hits <= private.ai_rate_limit_for(v_plan);
end;
$$;

revoke execute on function public.consume_ai_rate_limit(uuid) from public, anon;
grant execute on function public.consume_ai_rate_limit(uuid) to authenticated, service_role;
