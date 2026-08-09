-- MVP Trainer Pro
-- Daily bodyweight, nutrition, pain and recovery metrics for Progress.
-- Run once in Supabase SQL Editor. Safe to run again.

create extension if not exists pgcrypto;

create table if not exists public.trainer_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_block_id uuid not null references public.program_blocks(id) on delete cascade,
  log_date date not null,
  bodyweight_lb numeric(6,2),
  calories_kcal integer,
  protein_g numeric(7,2),
  calorie_target_kcal integer,
  protein_target_g numeric(7,2),
  pain numeric(4,1),
  recovery numeric(4,1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_daily_metrics_user_program_date_key unique (user_id, program_block_id, log_date),
  constraint trainer_daily_metrics_bodyweight_check check (bodyweight_lb is null or bodyweight_lb > 0),
  constraint trainer_daily_metrics_calories_check check (calories_kcal is null or calories_kcal >= 0),
  constraint trainer_daily_metrics_protein_check check (protein_g is null or protein_g >= 0),
  constraint trainer_daily_metrics_pain_check check (pain is null or (pain >= 0 and pain <= 10)),
  constraint trainer_daily_metrics_recovery_check check (recovery is null or (recovery >= 1 and recovery <= 5))
);

create index if not exists trainer_daily_metrics_user_date_idx
  on public.trainer_daily_metrics(user_id, log_date desc);

alter table public.trainer_daily_metrics enable row level security;

drop policy if exists "trainer_daily_metrics_select_own" on public.trainer_daily_metrics;
create policy "trainer_daily_metrics_select_own"
  on public.trainer_daily_metrics for select
  using (auth.uid() = user_id);

drop policy if exists "trainer_daily_metrics_insert_own" on public.trainer_daily_metrics;
create policy "trainer_daily_metrics_insert_own"
  on public.trainer_daily_metrics for insert
  with check (auth.uid() = user_id);

drop policy if exists "trainer_daily_metrics_update_own" on public.trainer_daily_metrics;
create policy "trainer_daily_metrics_update_own"
  on public.trainer_daily_metrics for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainer_daily_metrics_delete_own" on public.trainer_daily_metrics;
create policy "trainer_daily_metrics_delete_own"
  on public.trainer_daily_metrics for delete
  using (auth.uid() = user_id);
