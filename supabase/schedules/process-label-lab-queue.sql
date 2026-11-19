create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'process-label-lab-queue';

select cron.schedule(
  'process-label-lab-queue',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'package-cleanup-project-url'
      ) || '/functions/v1/process-label-lab-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'label-lab-worker-secret'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
