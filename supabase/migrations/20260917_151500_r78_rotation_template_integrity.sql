-- MVP Trainer Pro r78
-- Stable four-slot rotation + program-scoped future-template saves.
-- 2026-09-17
--
-- Goals:
--   * Rotation identity is the workout slot/type, never a template UUID.
--   * Every current program uses exactly: Upper 1 -> Lower 1 -> Upper 2 -> Lower 2.
--   * Editing/replacing a workout template cannot create extra rotation slots.
--   * "Save to All Future Sessions" is isolated to one program and updates the
--     canonical slot so later queue refills keep the edit.
--   * Skip advances one occurrence and refills the tail from the canonical slot.
--   * Existing completed workout history is never deleted or rewritten.
--   * One-time repair below keeps the real active program's current pointer at
--     Lower 1 and fixes only live/future schedule identity fields.

begin;

create extension if not exists pgcrypto;

create table if not exists public.program_rotation_slots (
  program_block_id uuid not null references public.program_blocks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_index integer not null check (slot_index > 0),
  session_type text not null,
  template_id uuid references public.workout_templates(id) on delete set null,
  checklist jsonb,
  coach_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (program_block_id, slot_index)
);

create index if not exists program_rotation_slots_user_program_idx
  on public.program_rotation_slots(user_id, program_block_id, slot_index);

alter table public.program_rotation_slots enable row level security;

drop policy if exists "program_rotation_slots_select_own" on public.program_rotation_slots;
create policy "program_rotation_slots_select_own"
  on public.program_rotation_slots for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.program_rotation_slots from anon;
revoke insert, update, delete on public.program_rotation_slots from authenticated;
grant select on public.program_rotation_slots to authenticated;

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

create unique index if not exists trainer_skipped_sessions_occurrence_unique
  on public.trainer_skipped_sessions(user_id, program_block_id, scheduled_session_id, original_date);

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

-- ---------------------------------------------------------------------------
-- CANONICAL ROTATION NORMALIZER
-- ---------------------------------------------------------------------------
-- If a program already has the exact four canonical slots, leave it alone.
-- Otherwise rebuild only the rotation metadata using the best current source
-- for each logical workout type. Template UUIDs are CONTENT references only.
create or replace function public.mvp_ensure_program_rotation_v2(
  p_program_block_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  total_count integer := 0;
  valid_count integer := 0;
  inserted_count integer := 0;
begin
  if p_program_block_id is null or p_user_id is null then
    raise exception 'Program and user are required.';
  end if;

  if not exists (
    select 1
    from public.program_blocks pb
    where pb.id = p_program_block_id
      and pb.user_id = p_user_id
  ) then
    raise exception 'Program was not found for this user.';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where (prs.slot_index = 1 and lower(trim(prs.session_type)) = 'upper 1')
         or (prs.slot_index = 2 and lower(trim(prs.session_type)) = 'lower 1')
         or (prs.slot_index = 3 and lower(trim(prs.session_type)) = 'upper 2')
         or (prs.slot_index = 4 and lower(trim(prs.session_type)) = 'lower 2')
    )::integer
  into total_count, valid_count
  from public.program_rotation_slots prs
  where prs.program_block_id = p_program_block_id
    and prs.user_id = p_user_id;

  if total_count = 4 and valid_count = 4 then
    return 4;
  end if;

  -- Snapshot one source row for each logical workout before replacing malformed
  -- rotation metadata. Prefer the current live schedule; fall back to existing
  -- rotation metadata if a live occurrence is not presently available.
  with wanted(slot_index, session_key, canonical_name) as (
    values
      (1, 'upper 1'::text, 'Upper 1'::text),
      (2, 'lower 1'::text, 'Lower 1'::text),
      (3, 'upper 2'::text, 'Upper 2'::text),
      (4, 'lower 2'::text, 'Lower 2'::text)
  ),
  chosen as materialized (
    select
      w.slot_index,
      w.canonical_name as session_type,
      src.template_id,
      src.checklist,
      src.coach_note
    from wanted w
    left join lateral (
      select z.template_id, z.checklist, z.coach_note
      from (
        select
          ss.template_id,
          ss.checklist,
          ss.coach_note,
          0 as source_rank,
          ss.queue_index,
          ss.date,
          ss.created_at,
          ss.id
        from public.scheduled_sessions ss
        where ss.program_block_id = p_program_block_id
          and ss.user_id = p_user_id
          and lower(trim(coalesce(ss.session_type,''))) = w.session_key
          and ss.template_id is not null
          and (ss.queue_index is null or ss.queue_index < 1000000)
          and lower(coalesce(ss.status::text,'scheduled')) not in
              ('skipped','canceled','cancelled','completed')

        union all

        select
          prs.template_id,
          prs.checklist,
          prs.coach_note,
          1 as source_rank,
          prs.slot_index as queue_index,
          null::date as date,
          prs.created_at,
          null::uuid as id
        from public.program_rotation_slots prs
        where prs.program_block_id = p_program_block_id
          and prs.user_id = p_user_id
          and lower(trim(coalesce(prs.session_type,''))) = w.session_key
          and prs.template_id is not null
      ) z
      order by
        z.source_rank,
        z.queue_index asc nulls last,
        z.date asc nulls last,
        z.created_at asc nulls last,
        z.id asc nulls last
      limit 1
    ) src on true
  ),
  removed as (
    delete from public.program_rotation_slots prs
    where prs.program_block_id = p_program_block_id
      and prs.user_id = p_user_id
    returning 1
  )
  insert into public.program_rotation_slots(
    program_block_id,
    user_id,
    slot_index,
    session_type,
    template_id,
    checklist,
    coach_note,
    updated_at
  )
  select
    p_program_block_id,
    p_user_id,
    c.slot_index,
    c.session_type,
    c.template_id,
    c.checklist,
    c.coach_note,
    now()
  from chosen c
  where c.template_id is not null
  order by c.slot_index;

  get diagnostics inserted_count = row_count;

  if inserted_count <> 4 then
    raise exception 'Could not resolve all four canonical workouts for program %. Found % of 4.',
      p_program_block_id, inserted_count;
  end if;

  return 4;
end;
$function$;

revoke all on function public.mvp_ensure_program_rotation_v2(uuid,uuid) from public;

-- ---------------------------------------------------------------------------
-- LIVE ORDER GUARD
-- ---------------------------------------------------------------------------
-- Preserve the first live row as the current pointer (Up Next), then guarantee
-- that every row after it follows the canonical four-slot cycle. Rows already
-- carrying the correct session type are not touched, which preserves a
-- deliberate "Save This Session" one-occurrence template override.
create or replace function public.mvp_enforce_live_rotation_v1(
  p_program_block_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  start_type text;
  start_slot integer;
  changed_count integer := 0;
begin
  perform public.mvp_ensure_program_rotation_v2(p_program_block_id, p_user_id);

  select ss.session_type
  into start_type
  from public.scheduled_sessions ss
  where ss.program_block_id = p_program_block_id
    and ss.user_id = p_user_id
    and (ss.queue_index is null or ss.queue_index < 1000000)
    and lower(coalesce(ss.status::text,'scheduled')) not in
        ('skipped','canceled','cancelled','completed')
  order by
    ss.queue_index asc nulls last,
    ss.date asc nulls last,
    ss.created_at asc,
    ss.id asc
  limit 1;

  if start_type is null then
    return 0;
  end if;

  select prs.slot_index
  into start_slot
  from public.program_rotation_slots prs
  where prs.program_block_id = p_program_block_id
    and prs.user_id = p_user_id
    and lower(trim(prs.session_type)) = lower(trim(start_type))
  limit 1;

  if start_slot is null then
    raise exception 'Current workout type % is not part of the canonical rotation.', start_type;
  end if;

  with ordered as (
    select
      ss.id,
      ss.session_type,
      row_number() over (
        order by
          ss.queue_index asc nulls last,
          ss.date asc nulls last,
          ss.created_at asc,
          ss.id asc
      ) as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
  ),
  expected as (
    select
      o.id,
      o.session_type as current_type,
      (((start_slot - 1 + (o.rn - 1)) % 4) + 1)::integer as expected_slot
    from ordered o
  )
  update public.scheduled_sessions ss
  set
    session_type = prs.session_type,
    template_id = prs.template_id,
    checklist = prs.checklist,
    coach_note = prs.coach_note,
    updated_at = now()
  from expected e
  join public.program_rotation_slots prs
    on prs.program_block_id = p_program_block_id
   and prs.user_id = p_user_id
   and prs.slot_index = e.expected_slot
  where ss.id = e.id
    and ss.user_id = p_user_id
    and ss.program_block_id = p_program_block_id
    and lower(trim(coalesce(e.current_type,''))) <> lower(trim(prs.session_type));

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$function$;

revoke all on function public.mvp_enforce_live_rotation_v1(uuid,uuid) from public;

create or replace function public.rpc_enforce_active_program_rotation_v1(
  p_program_block_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  changed_count integer := 0;
  next_row public.scheduled_sessions%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.program_blocks pb
    where pb.id = p_program_block_id
      and pb.user_id = uid
      and pb.status = 'active'
  ) then
    raise exception 'Active program not found.';
  end if;

  changed_count := public.mvp_enforce_live_rotation_v1(p_program_block_id, uid);

  select ss.*
  into next_row
  from public.scheduled_sessions ss
  where ss.program_block_id = p_program_block_id
    and ss.user_id = uid
    and (ss.queue_index is null or ss.queue_index < 1000000)
    and lower(coalesce(ss.status::text,'scheduled')) not in
        ('skipped','canceled','cancelled','completed')
  order by
    ss.queue_index asc nulls last,
    ss.date asc nulls last,
    ss.created_at asc,
    ss.id asc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'rpc_version', 'r78_live_rotation_guard',
    'program_block_id', p_program_block_id,
    'changed_rows', changed_count,
    'next_session_id', next_row.id,
    'next_session_type', next_row.session_type,
    'canonical_cycle_length', 4
  );
end;
$function$;

revoke all on function public.rpc_enforce_active_program_rotation_v1(uuid) from public;
grant execute on function public.rpc_enforce_active_program_rotation_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- PROGRAM-SCOPED "SAVE TO ALL FUTURE SESSIONS"
-- ---------------------------------------------------------------------------
create or replace function public.rpc_apply_future_template_v1(
  p_session_id uuid,
  p_new_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  target_row public.scheduled_sessions%rowtype;
  slot_row public.program_rotation_slots%rowtype;
  updated_count integer := 0;
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
    raise exception 'This session is not attached to a program.';
  end if;

  if lower(coalesce(target_row.status::text,'scheduled')) in
      ('skipped','canceled','cancelled','completed') then
    raise exception 'A completed/canceled/skipped session cannot update future workouts.';
  end if;

  if not exists (
    select 1
    from public.workout_templates wt
    where wt.id = p_new_template_id
      and wt.user_id = uid
  ) then
    raise exception 'The replacement workout template does not belong to this user.';
  end if;

  perform public.mvp_ensure_program_rotation_v2(target_row.program_block_id, uid);

  select prs.*
  into slot_row
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and lower(trim(prs.session_type)) = lower(trim(target_row.session_type))
  limit 1
  for update;

  if not found then
    raise exception 'Could not locate % in this program''s canonical rotation.', target_row.session_type;
  end if;

  -- Future queue generation must use the new template from now on.
  update public.program_rotation_slots prs
  set template_id = p_new_template_id,
      updated_at = now()
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and prs.slot_index = slot_row.slot_index;

  -- Update this occurrence and every later live occurrence of the same logical
  -- workout in THIS program only. Earlier occurrences stay untouched.
  update public.scheduled_sessions ss
  set template_id = p_new_template_id,
      updated_at = now()
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id
    and lower(trim(coalesce(ss.session_type,''))) = lower(trim(target_row.session_type))
    and (ss.queue_index is null or ss.queue_index < 1000000)
    and lower(coalesce(ss.status::text,'scheduled')) not in
        ('skipped','canceled','cancelled','completed')
    and (
      ss.id = target_row.id
      or (
        target_row.queue_index is not null
        and ss.queue_index is not null
        and ss.queue_index >= target_row.queue_index
      )
      or (
        (target_row.queue_index is null or ss.queue_index is null)
        and ss.date >= target_row.date
      )
    );

  get diagnostics updated_count = row_count;

  if updated_count < 1 then
    raise exception 'No future sessions were updated.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'rpc_version', 'r78_program_scoped_future_template',
    'program_block_id', target_row.program_block_id,
    'session_type', target_row.session_type,
    'canonical_slot', slot_row.slot_index,
    'new_template_id', p_new_template_id,
    'future_rows_updated', updated_count,
    'other_programs_touched', false
  );
end;
$function$;

revoke all on function public.rpc_apply_future_template_v1(uuid,uuid) from public;
grant execute on function public.rpc_apply_future_template_v1(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- SKIP CURRENT OCCURRENCE, KEEP THE FOUR-SLOT ROTATION
-- ---------------------------------------------------------------------------
-- Keep the existing RPC name so the installed app and the updated app both use
-- the corrected behavior immediately after this SQL is run.
create or replace function public.rpc_skip_scheduled_session_v6(
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
  live_ids uuid[] := array[]::uuid[];
  live_dates date[] := array[]::date[];
  live_queues integer[] := array[]::integer[];
  live_types text[] := array[]::text[];
  row_count integer := 0;
  last_slot integer;
  next_slot integer;
  slot_row public.program_rotation_slots%rowtype;
  replacement_id uuid;
  replacement_type text;
  temp_date_base date;
  temp_queue_base integer;
  archive_date date;
  archive_queue integer;
  new_tail_id uuid;
  i integer;
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
    raise exception 'This session is not attached to a program.';
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

  -- Repair only logical order first. The first/current pointer is preserved.
  perform public.mvp_enforce_live_rotation_v1(target_row.program_block_id, uid);

  select
    coalesce(array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.date order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::date[]),
    coalesce(array_agg(coalesce(x.queue_index,0) order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::integer[]),
    coalesce(array_agg(x.session_type order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::text[])
  into live_ids, live_dates, live_queues, live_types
  from (
    select
      ss.id,
      ss.date,
      ss.queue_index,
      ss.session_type,
      ss.created_at
    from public.scheduled_sessions ss
    where ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
    order by
      ss.queue_index asc nulls last,
      ss.date asc nulls last,
      ss.created_at asc,
      ss.id asc
  ) x;

  row_count := coalesce(array_length(live_ids,1),0);

  if row_count = 0 then
    raise exception 'No current scheduled workout rotation was found for this program.';
  end if;

  if live_ids[1] is distinct from p_session_id then
    raise exception 'Only the current workout occurrence can be skipped.';
  end if;

  if row_count < 2 then
    raise exception 'The program needs another scheduled workout before this occurrence can be skipped.';
  end if;

  replacement_id := live_ids[2];
  replacement_type := live_types[2];

  -- Slot identity is SESSION TYPE, never the template UUID. Template changes
  -- therefore cannot mutate or lengthen the program rotation.
  select prs.slot_index
  into last_slot
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and lower(trim(prs.session_type)) = lower(trim(live_types[row_count]))
  limit 1;

  if last_slot is null then
    raise exception 'Could not locate the tail workout type % in the canonical rotation.', live_types[row_count];
  end if;

  next_slot := (last_slot % 4) + 1;

  select prs.*
  into slot_row
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and prs.slot_index = next_slot;

  if slot_row.template_id is null then
    raise exception 'The next workout in this program''s rotation could not be resolved.';
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
    nullif(trim(coalesce(p_reason,'')),'')
  )
  on conflict do nothing;

  -- Only unfinished data for the occurrence being skipped is discarded.
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

  -- Stage this program's live rows away from all real unique date/index keys.
  select coalesce(max(ss.date), current_date) + 730
  into temp_date_base
  from public.scheduled_sessions ss
  where ss.program_block_id = target_row.program_block_id;

  select coalesce(max(ss.queue_index),0) + 5000000
  into temp_queue_base
  from public.scheduled_sessions ss
  where ss.program_block_id = target_row.program_block_id;

  for i in 1..row_count loop
    update public.scheduled_sessions
    set date = temp_date_base + (i - 1),
        queue_index = temp_queue_base + i,
        updated_at = now()
    where id = live_ids[i]
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end loop;

  archive_date := temp_date_base + row_count + 730;
  archive_queue := temp_queue_base + row_count + 5000000;

  update public.scheduled_sessions
  set date = archive_date,
      queue_index = archive_queue,
      status = 'skipped',
      updated_at = now()
  where id = p_session_id
    and user_id = uid
    and program_block_id = target_row.program_block_id;

  -- Remaining occurrences advance into the previous real slot.
  for i in 2..row_count loop
    update public.scheduled_sessions
    set date = live_dates[i - 1],
        queue_index = live_queues[i - 1],
        status = 'scheduled',
        updated_at = now()
    where id = live_ids[i]
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end loop;

  -- Fill the newly empty tail with the true next canonical workout.
  insert into public.scheduled_sessions(
    user_id,
    program_block_id,
    date,
    session_type,
    template_id,
    status,
    checklist,
    coach_note,
    queue_index
  ) values (
    uid,
    target_row.program_block_id,
    live_dates[row_count],
    slot_row.session_type,
    slot_row.template_id,
    'scheduled',
    slot_row.checklist,
    slot_row.coach_note,
    live_queues[row_count]
  )
  returning id into new_tail_id;

  return jsonb_build_object(
    'ok', true,
    'rpc_version', 'r78_skip_stable_four_slot_rotation',
    'program_block_id', target_row.program_block_id,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'new_tail_session_id', new_tail_id,
    'new_tail_session_type', slot_row.session_type,
    'canonical_cycle_length', 4,
    'historical_completed_rows_preserved', true,
    'other_programs_touched', false
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v6(uuid,text) from public;
grant execute on function public.rpc_skip_scheduled_session_v6(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- ONE-TIME REPAIR: REAL ACTIVE PROGRAM ONLY
-- ---------------------------------------------------------------------------
-- Confirmed real program from diagnostics:
--   f46864db-b4cc-4aa1-8d3c-439605459a36
-- Requirement: Lower 1 must remain the current/Up Next workout.
do $repair_real_program$
declare
  target_program constant uuid := 'f46864db-b4cc-4aa1-8d3c-439605459a36'::uuid;
  uid uuid;
  current_type text;
  changed_count integer := 0;
  slot_count integer := 0;
begin
  select pb.user_id
  into uid
  from public.program_blocks pb
  where pb.id = target_program;

  if uid is null then
    raise exception 'r78 repair stopped: real program % was not found.', target_program;
  end if;

  select ss.session_type
  into current_type
  from public.scheduled_sessions ss
  where ss.program_block_id = target_program
    and ss.user_id = uid
    and (ss.queue_index is null or ss.queue_index < 1000000)
    and lower(coalesce(ss.status::text,'scheduled')) not in
        ('skipped','canceled','cancelled','completed')
  order by
    ss.queue_index asc nulls last,
    ss.date asc nulls last,
    ss.created_at asc,
    ss.id asc
  limit 1;

  if lower(trim(coalesce(current_type,''))) <> 'lower 1' then
    raise exception 'r78 repair stopped: expected current Up Next to be Lower 1, but database says %.', coalesce(current_type,'NULL');
  end if;

  -- Never rewrite a schedule underneath a workout that is actively in progress.
  if exists (
    select 1
    from public.workouts w
    join public.scheduled_sessions ss on ss.id = w.scheduled_session_id
    where ss.program_block_id = target_program
      and ss.user_id = uid
      and w.user_id = uid
      and w.completed_at is null
      and w.started_at is not null
  ) then
    raise exception 'r78 repair stopped: an unfinished started workout exists. End/pause that workout before running this repair.';
  end if;

  -- Force a clean rebuild of canonical metadata from the current program's own
  -- workout types. No completed workout/history tables are touched.
  delete from public.program_rotation_slots prs
  where prs.program_block_id = target_program
    and prs.user_id = uid;

  perform public.mvp_ensure_program_rotation_v2(target_program, uid);

  select count(*)::integer
  into slot_count
  from public.program_rotation_slots prs
  where prs.program_block_id = target_program
    and prs.user_id = uid;

  if slot_count <> 4 then
    raise exception 'r78 repair stopped: canonical rotation contains % slots instead of 4.', slot_count;
  end if;

  -- The guard preserves Lower 1 as row #1 and fixes only later live identities.
  changed_count := public.mvp_enforce_live_rotation_v1(target_program, uid);

  raise notice 'r78 repaired real program %. Up Next remained %. Live rows corrected: %.',
    target_program, current_type, changed_count;
end;
$repair_real_program$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICATION ONLY - NO DATA CHANGES BELOW THIS LINE
-- Expected:
--   rotation_slot_count = 4
--   first 8 live types = Lower 1, Upper 2, Lower 2, Upper 1, ...
-- ---------------------------------------------------------------------------
select
  count(*) as rotation_slot_count,
  string_agg(prs.slot_index::text || ':' || prs.session_type, ' -> ' order by prs.slot_index) as canonical_rotation
from public.program_rotation_slots prs
where prs.program_block_id = 'f46864db-b4cc-4aa1-8d3c-439605459a36'::uuid;

select
  x.rn,
  x.session_type,
  x.date,
  x.queue_index,
  x.template_id
from (
  select
    row_number() over (
      order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
    ) as rn,
    ss.session_type,
    ss.date,
    ss.queue_index,
    ss.template_id
  from public.scheduled_sessions ss
  where ss.program_block_id = 'f46864db-b4cc-4aa1-8d3c-439605459a36'::uuid
    and (ss.queue_index is null or ss.queue_index < 1000000)
    and lower(coalesce(ss.status::text,'scheduled')) not in
        ('skipped','canceled','cancelled','completed')
) x
where x.rn <= 8
order by x.rn;

select
  p.oid::regprocedure::text as installed_signature,
  position('r78_skip_stable_four_slot_rotation' in pg_get_functiondef(p.oid)) > 0 as r78_skip_installed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_skip_scheduled_session_v6';

select
  p.oid::regprocedure::text as installed_signature,
  position('r78_program_scoped_future_template' in pg_get_functiondef(p.oid)) > 0 as r78_future_save_installed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_apply_future_template_v1';
