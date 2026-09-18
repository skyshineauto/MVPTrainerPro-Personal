-- ============================================================
-- MVP TRAINER PRO R84 — EMAIL COACH PRO + SERVER REMINDERS
-- Run once in the MVP Trainer Supabase SQL Editor.
-- Safe: extends email preferences/delivery audit and installs an
-- hourly reminder scanner. It does NOT modify workout rotation,
-- workout history, exercises, PRs, sets, or completed sessions.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if to_regclass('public.training_email_preferences') is null
     or to_regclass('public.training_email_deliveries') is null then
    raise exception 'R83 email tables are missing. Run the R83 Email Coach SQL first.';
  end if;
end $$;

alter table public.training_email_preferences
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_hours smallint not null default 24,
  add column if not exists reminder_max smallint not null default 2;

do $$ begin
  alter table public.training_email_preferences
    add constraint training_email_reminder_hours_check check (reminder_hours between 6 and 168);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.training_email_preferences
    add constraint training_email_reminder_max_check check (reminder_max between 1 and 3);
exception when duplicate_object then null; end $$;

create unique index if not exists training_email_once_per_session_kind
  on public.training_email_deliveries(user_id, scheduled_session_id, kind)
  where scheduled_session_id is not null;

-- Private-to-clients system token used only between pg_cron and the Edge Function.
-- It is generated automatically; you never need to copy or expose it.
create table if not exists public.training_email_system_config (
  id text primary key,
  cron_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.training_email_system_config(id, cron_secret)
values ('default', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

alter table public.training_email_system_config enable row level security;
revoke all on public.training_email_system_config from anon, authenticated;
grant select on public.training_email_system_config to service_role;

-- Remove an older R84 scanner if the migration is re-run.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'mvp-training-email-reminders-hourly'
  loop
    perform cron.unschedule(jid);
  end loop;
end $$;

-- Hourly server-side scan. Reminder timing is based on elapsed hours since
-- the ready email / last reminder, not the reference dates shown in Training.
select cron.schedule(
  'mvp-training-email-reminders-hourly',
  '17 * * * *',
  $cron$
    select net.http_post(
      url := 'https://cnrcivwkrqqcmokblfwz.supabase.co/functions/v1/training-coach-email',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-mvp-cron-secret',(
          select cron_secret
          from public.training_email_system_config
          where id = 'default'
        )
      ),
      body := '{"action":"scan_reminders","reason":"hourly_cron"}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $cron$
);

select
  reminder_enabled,
  reminder_hours,
  reminder_max
from public.training_email_preferences
limit 5;

select
  jobid,
  jobname,
  schedule,
  active
from cron.job
where jobname = 'mvp-training-email-reminders-hourly';
