-- ============================================================================
-- AI usage logging + per-workspace plan (for quota / freemium).
-- ============================================================================

-- Plan column on workspaces
alter table public.workspaces
  add column plan text not null default 'free'
    check (plan in ('free', 'pro', 'unlimited'));

-- ----------------------------------------------------------------------------
-- ai_usage — one row per AI call, with estimated cost in satang
-- ----------------------------------------------------------------------------
create table public.ai_usage (
  id                      bigserial primary key,
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  fn                      text,            -- which function: chat-log, ocr-receipt, ...
  task_tier               text,            -- text | reason | vision
  provider                text,            -- anthropic | openai
  model                   text,
  input_tokens            integer not null default 0,
  output_tokens           integer not null default 0,
  estimated_cost_satang   bigint not null default 0,
  created_by              uuid references auth.users(id),
  created_at              timestamptz not null default now()
);

create index ai_usage_workspace_month_idx
  on public.ai_usage(workspace_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: members read their workspace usage; writers may insert.
-- (Functions running with the user's JWT insert their own usage rows; functions
--  running with the service role bypass RLS.)
-- ----------------------------------------------------------------------------
alter table public.ai_usage enable row level security;

create policy "members read ai usage"
  on public.ai_usage for select
  using (public.is_workspace_member(workspace_id));

create policy "writers insert ai usage"
  on public.ai_usage for insert
  with check (public.workspace_role(workspace_id) in ('owner', 'accountant'));

-- ----------------------------------------------------------------------------
-- Helper view: current-month cost per workspace (handy for dashboards/admin)
-- ----------------------------------------------------------------------------
create or replace view public.ai_usage_month as
  select
    workspace_id,
    date_trunc('month', created_at) as month,
    sum(input_tokens)              as input_tokens,
    sum(output_tokens)             as output_tokens,
    sum(estimated_cost_satang)     as cost_satang,
    count(*)                       as calls
  from public.ai_usage
  group by workspace_id, date_trunc('month', created_at);
