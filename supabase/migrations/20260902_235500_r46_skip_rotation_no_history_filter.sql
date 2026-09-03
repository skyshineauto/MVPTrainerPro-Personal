-- MVP Trainer Pro r46
-- Skip one current occurrence, preserve the program's canonical rotation.
-- IMPORTANT: historical completed workouts linked to reusable schedule row ids
-- are deliberately ignored when deciding what is currently live.

begin;

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

-- Seed a cyclic rotation from the program's current ordered schedule when no
-- canonical definition exists yet. Starting mid-cycle is fine because only
-- successor order matters.
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
  existing_count integer;
  first_template uuid;
  repeat_rn integer;
  cycle_len integer;
begin
  select count(*)::integer
  into existing_count
  from public.program_rotation_slots prs
  where prs.program_block_id = p_program_block_id
    and prs.user_id = p_user_id;

  if existing_count > 0 then
    return existing_count;
  end if;

  with ordered as (
    select
      ss.template_id,
      row_number() over (
        order by ss.queue_index asc nulls last,
                 ss.date asc nulls last,
                 ss.created_at asc,
                 ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
  )
  select o.template_id
  into first_template
  from ordered o
  where o.rn = 1;

  if first_template is null then
    raise exception 'No scheduled workout rotation was found for this program.';
  end if;

  with ordered as (
    select
      ss.template_id,
      row_number() over (
        order by ss.queue_index asc nulls last,
                 ss.date asc nulls last,
                 ss.created_at asc,
                 ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
  )
  select min(o.rn)
  into repeat_rn
  from ordered o
  where o.rn > 1
    and o.template_id = first_template;

  if repeat_rn is not null then
    cycle_len := repeat_rn - 1;
  else
    select least(count(*)::integer, 14)
    into cycle_len
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed');
  end if;

  if cycle_len is null or cycle_len < 1 then
    raise exception 'Could not determine this program''s workout rotation.';
  end if;

  insert into public.program_rotation_slots(
    program_block_id,
    user_id,
    slot_index,
    session_type,
    template_id,
    checklist,
    coach_note
  )
  select
    p_program_block_id,
    p_user_id,
    o.rn,
    o.session_type,
    o.template_id,
    o.checklist,
    o.coach_note
  from (
    select
      ss.session_type,
      ss.template_id,
      ss.checklist,
      ss.coach_note,
      row_number() over (
        order by ss.queue_index asc nulls last,
                 ss.date asc nulls last,
                 ss.created_at asc,
                 ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
  ) o
  where o.rn <= cycle_len
  on conflict (program_block_id, slot_index) do nothing;

  return cycle_len;
end;
$function$;

revoke all on function public.mvp_ensure_program_rotation_v2(uuid,uuid) from public;

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
  live_templates uuid[] := array[]::uuid[];
  live_types text[] := array[]::text[];
  row_count integer := 0;
  cycle_len integer := 0;
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

  cycle_len := public.mvp_ensure_program_rotation_v2(target_row.program_block_id, uid);

  -- THIS is the r46 correction: live schedule rows are determined only by
  -- this program's CURRENT scheduled rows/status/index. We DO NOT exclude a
  -- row because an older completed workout happens to reference the same id.
  select
    coalesce(array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.date order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::date[]),
    coalesce(array_agg(coalesce(x.queue_index,0) order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::integer[]),
    coalesce(array_agg(x.template_id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.session_type order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::text[])
  into live_ids, live_dates, live_queues, live_templates, live_types
  from (
    select
      ss.id,
      ss.date,
      ss.queue_index,
      ss.template_id,
      ss.session_type,
      ss.created_at
    from public.scheduled_sessions ss
    where ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status::text,'scheduled')) not in
          ('skipped','canceled','cancelled','completed')
    order by ss.queue_index asc nulls last,
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

  -- Determine the successor of the OLD tail from the canonical cyclic order.
  select prs.slot_index
  into last_slot
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and prs.template_id = live_templates[row_count]
  order by prs.slot_index
  limit 1;

  if last_slot is null then
    -- Canonical seed can be stale only if a program was edited after it was
    -- first seeded. Rebuild it from the currently visible rotation once.
    delete from public.program_rotation_slots prs
    where prs.program_block_id = target_row.program_block_id
      and prs.user_id = uid;

    cycle_len := public.mvp_ensure_program_rotation_v2(target_row.program_block_id, uid);

    select prs.slot_index
    into last_slot
    from public.program_rotation_slots prs
    where prs.program_block_id = target_row.program_block_id
      and prs.user_id = uid
      and prs.template_id = live_templates[row_count]
    order by prs.slot_index
    limit 1;
  end if;

  if last_slot is null then
    raise exception 'Could not locate the current tail workout in this program''s rotation.';
  end if;

  next_slot := (last_slot % cycle_len) + 1;

  select *
  into slot_row
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and prs.slot_index = next_slot;

  if slot_row.template_id is null then
    raise exception 'The next workout in this program''s rotation could not be resolved.';
  end if;

  -- Store the exact skipped occurrence. Historical completed workouts remain.
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

  -- Discard only UNFINISHED data for the skipped current occurrence.
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

  -- Stage the CURRENT live rows outside all real date/index keys. This avoids
  -- both scheduled_sessions_block_date_unique and block_queue_unique.
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

  -- Archive only THIS skipped occurrence. It never re-enters the live queue.
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

  -- Every remaining occurrence advances into the previous real slot.
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

  -- Refill only the now-empty tail with the NEXT canonical workout. The
  -- skipped workout returns later only when the normal rotation reaches it.
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
    'rpc_version', 'r46_skip_rotation_no_history_filter',
    'program_block_id', target_row.program_block_id,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'new_tail_session_id', new_tail_id,
    'new_tail_session_type', slot_row.session_type,
    'canonical_cycle_length', cycle_len,
    'historical_completed_rows_ignored', true,
    'other_programs_touched', false
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v6(uuid,text) from public;
grant execute on function public.rpc_skip_scheduled_session_v6(uuid,text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Verification only. No data is changed below this point.
select
  p.oid::regprocedure::text as installed_signature,
  position('r46_skip_rotation_no_history_filter' in pg_get_functiondef(p.oid)) > 0 as r46_installed,
  position('w.completed_at is not null' in pg_get_functiondef(p.oid)) = 0 as no_history_filter_in_live_queue
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_skip_scheduled_session_v6';
