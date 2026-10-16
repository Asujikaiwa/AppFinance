-- ============================================================================
-- Schedule the filing-reminders function via pg_cron + pg_net.
-- Requires the project to have these extensions enabled (Supabase: Database →
-- Extensions). On hosted Supabase, set the service role key as a DB setting.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the function URL + service key as DB settings (set these once per env):
--   alter database postgres set app.functions_url = 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.service_role_key = '<service-role-key>';

-- Daily at 01:00 UTC (08:00 ICT)
select cron.schedule(
  'filing-reminders-daily',
  '0 1 * * *',
  $$
  select net.http_post(
    url := current_setting('app.functions_url') || '/filing-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To remove later: select cron.unschedule('filing-reminders-daily');
