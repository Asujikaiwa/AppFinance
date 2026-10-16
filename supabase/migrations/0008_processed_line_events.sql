-- ============================================================================
-- LINE webhook idempotency.
-- LINE redelivers events when our endpoint is slow or errors; without dedupe
-- that creates duplicate entries. We record each webhookEventId once.
-- ============================================================================

create table public.processed_line_events (
  event_id      text primary key,        -- LINE webhookEventId
  processed_at  timestamptz not null default now()
);

-- Written only by the service role (line-webhook). No client access.
alter table public.processed_line_events enable row level security;

-- Optional housekeeping: drop rows older than 30 days (run via pg_cron if desired).
--   delete from public.processed_line_events where processed_at < now() - interval '30 days';
