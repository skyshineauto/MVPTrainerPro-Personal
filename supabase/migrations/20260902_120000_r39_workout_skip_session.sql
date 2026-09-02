-- MVP Trainer Pro r39 - Skip Session queue advance
-- September 2, 2026
-- Records a skipped scheduled workout without creating a completed workout,
-- removes that occurrence from the live queue, and advances every remaining
-- scheduled occurrence by one schedule slot.

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

-- Writes are intentionally routed through the RPC below so the queue move is atomic.
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
  ordered_ids jsonb := '[]'::jsonb;
  target_pos integer := null;
  row_count integer := 0;
  i integer;
  current_id uuid;
  replacement_id uuid := null;
  replacement_type text := null;
  previous_date public.scheduled_sessions.date%type;
  previous_queue_index public.scheduled_sessions.queue_index%type;
  current_date public.scheduled_sessions.date%type;
  current_queue_index public.scheduled_sessions.queue_index%type;
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
    raise exception 'Only the next session in the active program can be skipped.';
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

  -- Capture the current pending order BEFORE removing the skipped occurrence.
  -- Started/completed workouts are never part of the shift set.
  select coalesce(jsonb_agg(to_jsonb(ss.id) order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc), '[]'::jsonb)
  into ordered_ids
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and lower(coalesce(ss.status, 'scheduled')) not in ('completed','canceled','cancelled','skipped')
    and not exists (
      select 1
      from public.workouts w
      where w.user_id = uid
        and w.scheduled_session_id = ss.id
        and (w.started_at is not null or w.completed_at is not null)
    );

  row_count := jsonb_array_length(ordered_ids);
  if row_count = 0 then
    raise exception 'No pending workout queue was found.';
  end if;

  for i in 0..row_count - 1 loop
    if trim(both '"' from ordered_ids->>i) = p_session_id::text then
      target_pos := i;
      exit;
    end if;
  end loop;

  if target_pos is null then
    raise exception 'The selected session is not in the pending workout queue.';
  end if;

  if target_pos + 1 < row_count then
    replacement_id := trim(both '"' from ordered_ids->>(target_pos + 1))::uuid;
  end if;

  insert into public.trainer_skipped_sessions(
    user_id,
    program_block_id,
    scheduled_session_id,
    template_id,
    session_type,
    original_date,
    reason
  ) values (
    uid,
    target_row.program_block_id,
    target_row.id,
    target_row.template_id,
    target_row.session_type,
    target_row.date,
    nullif(trim(coalesce(p_reason, '')), '')
  )
  on conflict (user_id, scheduled_session_id) do nothing;

  -- If the user opened the pre-workout check-in but never started, remove the
  -- untouched placeholder workout so the scheduled row can be safely removed.
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

  previous_date := target_row.date;
  previous_queue_index := target_row.queue_index;

  delete from public.scheduled_sessions
  where id = p_session_id
    and user_id = uid;

  -- Move each remaining occurrence into the slot immediately before it.
  -- Session identity/template stays intact, so the rotation becomes:
  --   Lower 1 (skipped), Upper 1, Upper 2, Lower 2 ...
  -- -> Upper 1, Upper 2, Lower 2 ...
  if target_pos + 1 < row_count then
    for i in target_pos + 1..row_count - 1 loop
      current_id := trim(both '"' from ordered_ids->>i)::uuid;

      select ss.date, ss.queue_index
      into current_date, current_queue_index
      from public.scheduled_sessions ss
      where ss.id = current_id
        and ss.user_id = uid
      for update;

      if found then
        update public.scheduled_sessions
        set date = previous_date,
            queue_index = previous_queue_index
        where id = current_id
          and user_id = uid;

        previous_date := current_date;
        previous_queue_index := current_queue_index;
      end if;
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
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'skipped_original_date', target_row.date,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'advanced_sessions', greatest(row_count - target_pos - 1, 0)
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v1(uuid, text) from public;
grant execute on function public.rpc_skip_scheduled_session_v1(uuid, text) to authenticated;
