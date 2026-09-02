-- MVP Trainer Pro r43
-- Skip ONLY the current occurrence in the current active program.
-- Keep the workout in the rotation by moving its reusable scheduled row to the back.
-- Historical completed workouts are never used to decide whether today's occurrence can be skipped.

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

-- New function name on purpose. This avoids every stale v1 overload/cache issue.
drop function if exists public.rpc_skip_scheduled_session_v2(uuid, text);

create function public.rpc_skip_scheduled_session_v2(
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
  target_return_date date := null;
  temp_date_base date;
  temp_queue_base integer;
  queue_base integer;
  status_type_oid oid;
  status_is_enum boolean := false;
  scheduled_status text := 'scheduled';
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Exact row the user pressed Skip on.
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

  -- Absolute program isolation. Nothing outside this block may move.
  if not exists (
    select 1
    from public.program_blocks pb
    where pb.id = target_row.program_block_id
      and pb.user_id = uid
      and pb.status = 'active'
  ) then
    raise exception 'Only the current session in the active program can be skipped.';
  end if;

  /*
   * IMPORTANT:
   * Do NOT block because target_row.status = completed.
   * Do NOT inspect old completed workouts.
   * This app uses rotating scheduled rows, so an Upper 2 row can have many
   * completed workouts in history and still represent today's new occurrence.
   */

  -- Work only with this program's current rotation window. Broken old skip
  -- patches archived rows above 1,000,000 and/or marked them skipped/canceled.
  -- The dashboard keeps seven live rotation slots, so cap the working set at 7.
  select
    coalesce(array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.date order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::date[])
  into ordered_ids, ordered_dates
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

  -- The exact row being skipped must be the head of THIS program's rotation.
  if ordered_ids[1] is distinct from p_session_id then
    raise exception 'Only the current scheduled workout in this program can be skipped.';
  end if;

  if row_count >= 2 then
    replacement_id := ordered_ids[2];
  end if;

  -- Record only this date/occurrence. Same workout may be skipped again in a
  -- later rotation because original_date will be different.
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

  -- Discard only unfinished data from THIS current occurrence. Historical
  -- completed rotations attached to the same scheduled row are preserved.
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

  -- Determine a valid normal/live status for this schema. The recycled row
  -- MUST be returned to a scheduled state or the UI will hide it from rotation.
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
      scheduled_status := 'scheduled';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'pending') then
      scheduled_status := 'pending';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'planned') then
      scheduled_status := 'planned';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'ready') then
      scheduled_status := 'ready';
    else
      raise exception 'scheduled_sessions.status enum has no normal scheduled/pending/planned/ready value.';
    end if;
  end if;

  -- Lock the exact rotation rows we are about to move.
  perform 1
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and ss.id = any(ordered_ids)
  for update;

  -- Stage THIS program's rotation rows away from their real date/queue slots so
  -- the block/date unique constraint cannot collide during the shift.
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

  select coalesce(min(ss.queue_index) filter (where ss.queue_index is not null and ss.queue_index < 1000000), 1)
  into queue_base
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and ss.id = any(ordered_ids);

  for i in 1..row_count loop
    update public.scheduled_sessions
    set date = temp_date_base + (i - 1),
        queue_index = temp_queue_base + i
    where id = ordered_ids[i]
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end loop;

  -- Advance rows 2..N one slot forward.
  if row_count >= 2 then
    for i in 2..row_count loop
      update public.scheduled_sessions
      set date = ordered_dates[i - 1],
          queue_index = queue_base + (i - 2)
      where id = ordered_ids[i]
        and user_id = uid
        and program_block_id = target_row.program_block_id;
    end loop;
  end if;

  -- The skipped workout remains in THIS program by moving to the back slot.
  target_return_date := ordered_dates[row_count];
  update public.scheduled_sessions
  set date = target_return_date,
      queue_index = queue_base + (row_count - 1)
  where id = p_session_id
    and user_id = uid
    and program_block_id = target_row.program_block_id;

  -- Reset the whole live rotation window to a normal schedulable status. This
  -- is what prevents an old 'completed' flag on a reusable row from hiding it.
  if status_is_enum then
    execute format(
      'update public.scheduled_sessions set status = %L::%s where user_id = $1 and program_block_id = $2 and id = any($3)',
      scheduled_status,
      status_type_oid::regtype
    ) using uid, target_row.program_block_id, ordered_ids;
  else
    update public.scheduled_sessions
    set status = scheduled_status
    where user_id = uid
      and program_block_id = target_row.program_block_id
      and id = any(ordered_ids);
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
    'rpc_version', 'r43_current_program_rotation',
    'program_block_id', target_row.program_block_id,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'skipped_original_date', target_row.date,
    'returned_to_rotation_date', target_return_date,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'rotation_size', row_count,
    'rotation_preserved', true,
    'other_programs_touched', false
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v2(uuid, text) from public;
grant execute on function public.rpc_skip_scheduled_session_v2(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verification. Expected all TRUE/FALSE exactly as shown:
-- r43_installed = true
-- v2_does_not_check_completed_history = true
-- v2_does_not_delete_scheduled_row = true
select
  p.oid::regprocedure::text as installed_signature,
  position('r43_current_program_rotation' in pg_get_functiondef(p.oid)) > 0 as r43_installed,
  position('A completed workout cannot be skipped.' in pg_get_functiondef(p.oid)) = 0 as v2_does_not_check_completed_history,
  position('delete from public.scheduled_sessions' in lower(pg_get_functiondef(p.oid))) = 0 as v2_does_not_delete_scheduled_row
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_skip_scheduled_session_v2';
