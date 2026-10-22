-- Every 15 minutes: ask the inventory function to send any consignment emails still waiting.
-- The anon key only gets past the gateway; the function checks the private cron token.
select cron.schedule(
  'inventory-consignment-email-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://sxyeasllycwzioskvswn.supabase.co/functions/v1/inventory',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4eWVhc2xseWN3emlvc2t2c3duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDI0NjAsImV4cCI6MjEwMTY3ODQ2MH0.mn_zqB4HFfFWo0_niEwJ44WzVRAT5p_dgMdOLYoJsFI',
      'x-cron-token', (select value from inventory.app_config where key = 'cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
