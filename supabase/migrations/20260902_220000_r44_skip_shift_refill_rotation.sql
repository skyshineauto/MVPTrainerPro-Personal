-- MVP Trainer Pro r44
-- Skip one CURRENT occurrence inside the active program only.
-- Do NOT move the skipped workout to the tail manually.
-- Shift the remaining live rows forward one slot, archive only the skipped occurrence,
-- then let rpc_queue_dashboard refill the empty tail from the program's real rotation.

begin;

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
  reason text
);

alter table public.trainer_skipped_sessions
  drop constraint if exists trainer_skipped_sessions_user_id_scheduled_session_id_key;

drop index if exists public.trainer_skipped_sessions_user_id_scheduled_session_id_key;

create unique index if not exists trainer_skipped_sessions_occurrence_unique
  on public.trainer_skipped_sessions(user_id, program_block_id, scheduled_session_id, original_date);

create index if not exists trainer_skipped_sessions_user_time_idx
  on public.trainer_skipped_sessions(user_id, skipped_at desc);

create index if not exists trainer_skipped_sessions_program_idx
  on public.trainer_skipped_sessions(user_id, program_block_id, skipped_at desc);

alter table public.trainer_skipped_sessions enable row level security;

drop policy if exists "trainer_skipped_sessions_select_own" on public.trainer_skipped_sessions;
create policy "trainer_skipped_sessions_select_own"
  on public.trainer_skipped_sessions for select
  using (auth.uid() = user_id);

grant select on public.trainer_skipped_sessions to authenticated;
revoke insert, update, delete on public.trainer_skipped_sessions from anon;
revoke insert, update, delete on public.trainer_skipped_sessions from authenticated;

-- Brand-new RPC name so no previous skip implementation can be resolved accidentally.
drop function if exists public.rpc_skip_scheduled_session_v3(uuid, text);

create function public.rpc_skip_scheduled_session_v3(
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
  ordered_queues integer[] := array[]::integer[];
  row_count integer := 0;
  i integer;
  replacement_id uuid := null;
  replacement_type text := null;
  temp_date_base date;
  temp_queue_base integer;
  archive_date date;
  archive_queue integer;
  status_type_oid oid;
  status_is_enum boolean := false;
  normal_status text := 'scheduled';
  archive_status text := 'skipped';
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
    raise exception 'Only the current session in the active program can be skipped.';
  end if;

  -- Work ONLY inside this active program's visible/live queue.
  select
    coalesce(array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.date order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::date[]),
    coalesce(array_agg(coalesce(x.queue_index, 0) order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::integer[])
  into ordered_ids, ordered_dates, ordered_queues
  from (
    select ss.id, ss.date, ss.queue_index, ss.created_at
    from public.scheduled_sessions ss
    where ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text, 'scheduled')) not in ('skipped','canceled','cancelled')
    order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
    limit 7
  ) x;

  row_count := coalesce(array_length(ordered_ids, 1), 0);
  if row_count = 0 then
    raise exception 'No active workout rotation was found.';
  end if;

  if ordered_ids[1] is distinct from p_session_id then
    raise exception 'Only the current scheduled workout in this program can be skipped.';
  end if;

  if row_count >= 2 then
    replacement_id := ordered_ids[2];
  end if;

  -- Snapshot this exact occurrence. Old completed rotations are irrelevant.
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
  on conflict (user_id, program_block_id, scheduled_session_id, original_date)
  do update set
    skipped_at = excluded.skipped_at,
    reason = excluded.reason,
    template_id = excluded.template_id,
    session_type = excluded.session_type;

  -- Discard only unfinished data tied to THIS current occurrence.
  -- Completed historical workouts are preserved.
  delete from public.workout_sets ws
  using public.workout_exercises we, public.workouts w
  where ws.workout_exercise_id = we.id
    and we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.completed_at is null;

  delete from public.workout_exercises we
  using public.workouts w
  where we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.completed_at is null;

  delete from public.workouts w
  where w.user_id = uid
    and w.scheduled_session_id = p_session_id
    and w.completed_at is null;

  -- Detect valid status values for this installation.
  select a.atttypid
  into status_type_oid
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'scheduled_sessions'
    and a.attname = 'status'
    and a.attnum > 0
    and not a.attisdropped;

  if status_type_oid is null then
    raise exception 'scheduled_sessions.status column was not found.';
  end if;

  select (t.typtype = 'e')
  into status_is_enum
  from pg_type t
  where t.oid = status_type_oid;

  if status_is_enum then
    if exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'scheduled') then
      normal_status := 'scheduled';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'pending') then
      normal_status := 'pending';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'planned') then
      normal_status := 'planned';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'ready') then
      normal_status := 'ready';
    else
      raise exception 'scheduled_sessions.status has no normal schedulable value.';
    end if;

    if exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'skipped') then
      archive_status := 'skipped';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'canceled') then
      archive_status := 'canceled';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'cancelled') then
      archive_status := 'cancelled';
    else
      raise exception 'scheduled_sessions.status has no skipped/canceled value for archiving one skipped occurrence.';
    end if;
  end if;

  -- Lock only this program's live rows.
  perform 1
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and ss.id = any(ordered_ids)
  for update;

  -- Vacate real slots first so the program/date unique constraint cannot collide.
  select coalesce(max(ss.date), current_date) + 366
  into temp_date_base
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id;

  select coalesce(max(ss.queue_index), 0) + 1000000
  into temp_queue_base
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id;

  for i in 1..row_count loop
    update public.scheduled_sessions
    set date = temp_date_base + (i - 1),
        queue_index = temp_queue_base + i
    where id = ordered_ids[i]
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end loop;

  -- Shift rows 2..N forward one existing slot. Do NOT append the skipped workout.
  if row_count >= 2 then
    for i in 2..row_count loop
      update public.scheduled_sessions
      set date = ordered_dates[i - 1],
          queue_index = ordered_queues[i - 1]
      where id = ordered_ids[i]
        and user_id = uid
        and program_block_id = target_row.program_block_id;
    end loop;
  end if;

  -- Normalize the remaining live rows so the queue engine can use them.
  if row_count >= 2 then
    if status_is_enum then
      execute format(
        'update public.scheduled_sessions set status = %L::%s where user_id = $1 and program_block_id = $2 and id = any($3)',
        normal_status,
        status_type_oid::regtype
      ) using uid, target_row.program_block_id, ordered_ids[2:row_count];
    else
      update public.scheduled_sessions
      set status = normal_status
      where user_id = uid
        and program_block_id = target_row.program_block_id
        and id = any(ordered_ids[2:row_count]);
    end if;
  end if;

  -- Archive ONLY the skipped occurrence outside the live queue.
  -- rpc_queue_dashboard will refill the now-empty tail from the program's REAL
  -- rotation, which is the generic behavior required for every program.
  archive_date := temp_date_base + row_count + 366;
  archive_queue := temp_queue_base + row_count + 1000000;

  if status_is_enum then
    execute format(
      'update public.scheduled_sessions set date = $1, queue_index = $2, status = %L::%s where id = $3 and user_id = $4 and program_block_id = $5',
      archive_status,
      status_type_oid::regtype
    ) using archive_date, archive_queue, p_session_id, uid, target_row.program_block_id;
  else
    update public.scheduled_sessions
    set date = archive_date,
        queue_index = archive_queue,
        status = archive_status
    where id = p_session_id
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end if;

  if replacement_id is not null then
    select ss.session_type
    into replacement_type
    from public.scheduled_sessions ss
    where ss.id = replacement_id
      and ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rpc_version', 'r44_shift_then_program_refill',
    'program_block_id', target_row.program_block_id,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'skipped_original_date', target_row.date,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'live_rows_shifted', greatest(row_count - 1, 0),
    'tail_refill_required', true,
    'rotation_source', 'rpc_queue_dashboard',
    'other_programs_touched', false
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v3(uuid, text) from public;
grant execute on function public.rpc_skip_scheduled_session_v3(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verification: r44_installed must be TRUE.
select
  p.oid::regprocedure::text as installed_signature,
  position('r44_shift_then_program_refill' in pg_get_functiondef(p.oid)) > 0 as r44_installed,
  position('rpc_queue_dashboard' in pg_get_functiondef(p.oid)) > 0 as rotation_refill_is_delegated_to_program_queue,
  position('other_programs_touched' in pg_get_functiondef(p.oid)) > 0 as program_isolation_marker_present
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_skip_scheduled_session_v3';
