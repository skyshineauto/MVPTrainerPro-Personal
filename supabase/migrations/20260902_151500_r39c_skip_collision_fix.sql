-- MVP Trainer Pro r39c / r40 - Skip Session collision-safe queue advance
-- September 2, 2026
-- Keeps SKIPPED history in trainer_skipped_sessions, removes the skipped
-- occurrence from the live schedule, vacates future dates, then advances the
-- remaining rotation one slot without violating scheduled_sessions_block_date_unique.

create extension if not exists pgcrypto;

create table if not exists public.trainer_skipped_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_block_id uuid references public.program_blocks(id) on delete cascade,
  scheduled_session_id uuid not null,
  template_id uuid,
  session_type text,
  original_date date,
  skipped_at timestamptz not null default now(),
  reason text,
  unique (user_id, scheduled_session_id)
);

create index if not exists trainer_skipped_sessions_user_time_idx
  on public.trainer_skipped_sessions(user_id, skipped_at desc);

create index if not exists trainer_skipped_sessions_program_idx
  on public.trainer_skipped_sessions(user_id, program_block_id, skipped_at desc);

alter table public.trainer_skipped_sessions enable row level security;

drop policy if exists "trainer_skipped_sessions_select_own" on public.trainer_skipped_sessions;
create policy "trainer_skipped_sessions_select_own"
  on public.trainer_skipped_sessions for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.trainer_skipped_sessions from anon;
revoke insert, update, delete on public.trainer_skipped_sessions from authenticated;
grant select on public.trainer_skipped_sessions to authenticated;

create or replace function public.rpc_skip_scheduled_session_v1(
  p_session_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  target_row public.scheduled_sessions%rowtype;
  ordered_ids uuid[] := array[]::uuid[];
  ordered_dates date[] := array[]::date[];
  row_count integer := 0;
  i integer;
  replacement_id uuid := null;
  replacement_type text := null;
  temp_base date;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select ss.*
  into target_row
  from public.scheduled_sessions ss
  where ss.id = p_session_id
    and ss.user_id = uid
  for update;

  if not found then
    raise exception 'Scheduled session not found.';
  end if;

  if target_row.program_block_id is null then
    raise exception 'This session is not attached to an active program.';
  end if;

  if not exists (
    select 1
    from public.program_blocks pb
    where pb.id = target_row.program_block_id
      and pb.user_id = uid
      and pb.status = 'active'
  ) then
    raise exception 'Only a session in the active program can be skipped.';
  end if;

  if exists (
    select 1
    from public.workouts w
    where w.user_id = uid
      and w.scheduled_session_id = p_session_id
      and (w.started_at is not null or w.completed_at is not null)
  ) then
    raise exception 'This workout has already started and cannot be skipped.';
  end if;

  -- Lock the full pending queue and capture both identity and schedule slots.
  perform 1
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and lower(coalesce(ss.status::text, 'scheduled')) not in ('completed','canceled','cancelled','skipped')
    and not exists (
      select 1
      from public.workouts w
      where w.user_id = uid
        and w.scheduled_session_id = ss.id
        and (w.started_at is not null or w.completed_at is not null)
    )
  for update;

  select
    coalesce(array_agg(ss.id order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc), array[]::uuid[]),
    coalesce(array_agg(ss.date order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc), array[]::date[])
  into ordered_ids, ordered_dates
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and lower(coalesce(ss.status::text, 'scheduled')) not in ('completed','canceled','cancelled','skipped')
    and not exists (
      select 1
      from public.workouts w
      where w.user_id = uid
        and w.scheduled_session_id = ss.id
        and (w.started_at is not null or w.completed_at is not null)
    );

  row_count := coalesce(array_length(ordered_ids, 1), 0);
  if row_count = 0 then
    raise exception 'No pending workout queue was found.';
  end if;

  if ordered_ids[1] is distinct from p_session_id then
    raise exception 'Only the next scheduled workout can be skipped.';
  end if;

  if row_count >= 2 then
    replacement_id := ordered_ids[2];
  end if;

  insert into public.trainer_skipped_sessions(
    user_id,
    program_block_id,
    scheduled_session_id,
    template_id,
    session_type,
    original_date,
    skipped_at,
    reason
  ) values (
    uid,
    target_row.program_block_id,
    target_row.id,
    target_row.template_id,
    target_row.session_type,
    target_row.date,
    now(),
    nullif(trim(coalesce(p_reason, '')), '')
  )
  on conflict (user_id, scheduled_session_id)
  do update set
    skipped_at = excluded.skipped_at,
    reason = excluded.reason,
    original_date = excluded.original_date,
    session_type = excluded.session_type,
    template_id = excluded.template_id,
    program_block_id = excluded.program_block_id;

  -- Remove only untouched pre-workout placeholders. A started workout is
  -- rejected above and can never be silently converted into a skip.
  delete from public.workout_sets ws
  using public.workout_exercises we, public.workouts w
  where ws.workout_exercise_id = we.id
    and we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.started_at is null
    and w.completed_at is null;

  delete from public.workout_exercises we
  using public.workouts w
  where we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.started_at is null
    and w.completed_at is null;

  delete from public.workouts w
  where w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.started_at is null
    and w.completed_at is null;

  -- The live scheduled row must leave the queue. SKIPPED history lives in
  -- trainer_skipped_sessions so the target date is genuinely free.
  delete from public.scheduled_sessions
  where id = p_session_id
    and user_id = uid;

  if row_count >= 2 then
    -- First move every remaining pending row to guaranteed-unused temporary
    -- dates beyond the block's current maximum. This makes the second pass
    -- immune to immediate unique-constraint checks and database triggers.
    select coalesce(max(ss.date), current_date) + 366
    into temp_base
    from public.scheduled_sessions ss
    where ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id;

    for i in 2..row_count loop
      update public.scheduled_sessions
      set date = temp_base + (i - 2)
      where id = ordered_ids[i]
        and user_id = uid;
    end loop;

    -- Advance the exact workout identities into the slots that preceded them.
    -- Queue indexes intentionally stay attached to workout identity; with the
    -- skipped row removed, their relative order remains unchanged and stable.
    for i in 2..row_count loop
      update public.scheduled_sessions
      set date = ordered_dates[i - 1]
      where id = ordered_ids[i]
        and user_id = uid;
    end loop;
  end if;

  if replacement_id is not null then
    select ss.session_type
    into replacement_type
    from public.scheduled_sessions ss
    where ss.id = replacement_id
      and ss.user_id = uid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'skipped_original_date', target_row.date,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'advanced_sessions', greatest(row_count - 1, 0)
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v1(uuid, text) from public;
grant execute on function public.rpc_skip_scheduled_session_v1(uuid, text) to authenticated;
