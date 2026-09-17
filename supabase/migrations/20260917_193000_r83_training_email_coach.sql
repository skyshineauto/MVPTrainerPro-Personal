-- ============================================================
-- MVP TRAINER PRO R83 — TRAINING EMAIL COACH
-- Run once in Supabase SQL Editor.
-- Safe: creates notification preferences/delivery audit only.
-- Does NOT modify workout history, rotation, templates, PRs, or sets.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.training_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  program_block_id uuid null references public.program_blocks(id) on delete set null,
  enabled boolean not null default false,
  workout_ready boolean not null default true,
  include_coach_tip boolean not null default true,
  include_exercise_plan boolean not null default true,
  include_progress_snapshot boolean not null default true,
  email_override text null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_email_override_length check (email_override is null or length(email_override) <= 320)
);

create table if not exists public.training_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_block_id uuid null references public.program_blocks(id) on delete set null,
  scheduled_session_id uuid null references public.scheduled_sessions(id) on delete set null,
  kind text not null default 'workout_ready',
  status text not null default 'pending',
  provider text not null default 'wordpress_wp_mail',
  provider_message_id text null,
  subject text null,
  destination text null,
  trigger_reason text null,
  error_message text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint training_email_delivery_status check (status in ('pending','sent','failed','suppressed'))
);

create unique index if not exists training_email_ready_once_per_session
  on public.training_email_deliveries(user_id, scheduled_session_id, kind)
  where scheduled_session_id is not null and kind = 'workout_ready';

create index if not exists training_email_deliveries_user_created_idx
  on public.training_email_deliveries(user_id, created_at desc);

create or replace function public.mvp_touch_training_email_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_training_email_preferences_touch on public.training_email_preferences;
create trigger trg_training_email_preferences_touch
before update on public.training_email_preferences
for each row execute function public.mvp_touch_training_email_updated_at();

drop trigger if exists trg_training_email_deliveries_touch on public.training_email_deliveries;
create trigger trg_training_email_deliveries_touch
before update on public.training_email_deliveries
for each row execute function public.mvp_touch_training_email_updated_at();

alter table public.training_email_preferences enable row level security;
alter table public.training_email_deliveries enable row level security;

drop policy if exists training_email_preferences_select_own on public.training_email_preferences;
create policy training_email_preferences_select_own
on public.training_email_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists training_email_preferences_insert_own on public.training_email_preferences;
create policy training_email_preferences_insert_own
on public.training_email_preferences
for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    program_block_id is null
    or exists (
      select 1
      from public.program_blocks pb
      where pb.id = program_block_id
        and pb.user_id = auth.uid()
    )
  )
);

drop policy if exists training_email_preferences_update_own on public.training_email_preferences;
create policy training_email_preferences_update_own
on public.training_email_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and (
    program_block_id is null
    or exists (
      select 1
      from public.program_blocks pb
      where pb.id = program_block_id
        and pb.user_id = auth.uid()
    )
  )
);

drop policy if exists training_email_deliveries_select_own on public.training_email_deliveries;
create policy training_email_deliveries_select_own
on public.training_email_deliveries
for select
to authenticated
using (auth.uid() = user_id);

-- Clients may read their delivery history, but only the Edge Function/service role
-- writes delivery audit rows.
revoke insert, update, delete on public.training_email_deliveries from authenticated;
grant select on public.training_email_deliveries to authenticated;
grant select, insert, update on public.training_email_preferences to authenticated;

select
  to_regclass('public.training_email_preferences') is not null as preferences_installed,
  to_regclass('public.training_email_deliveries') is not null as deliveries_installed;


-- Normalize the default if an earlier draft created this table first.
alter table public.training_email_deliveries
  alter column provider set default 'wordpress_wp_mail';

select
  to_regclass('public.training_email_preferences') is not null as preferences_installed,
  to_regclass('public.training_email_deliveries') is not null as deliveries_installed,
  (select column_default from information_schema.columns
   where table_schema='public' and table_name='training_email_deliveries' and column_name='provider') as provider_default;
