-- MVP Trainer Pro r45a
-- Canonical rotation repair without queue/date renumber collisions
-- 2026-09-02
--
-- Fixes r45 SQLSTATE 23505 on scheduled_sessions_block_queue_unique.
-- The one-time repair preserves every live row's existing date + queue_index.

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

-- Seed a program's immutable/canonical rotation from the FIRST complete cycle
-- in its original schedule. The cycle ends immediately before the first
-- template repeats. Example: U1,L1,U2,L2,U1 => canonical length 4.
create or replace function public.mvp_seed_program_rotation_v1(
  p_program_block_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  first_template uuid;
  repeat_rn integer;
  cycle_len integer;
begin
  if p_program_block_id is null or p_user_id is null then
    raise exception 'Program and user are required.';
  end if;

  if exists (
    select 1 from public.program_rotation_slots prs
    where prs.program_block_id = p_program_block_id
      and prs.user_id = p_user_id
  ) then
    select count(*)::integer into cycle_len
    from public.program_rotation_slots prs
    where prs.program_block_id = p_program_block_id
      and prs.user_id = p_user_id;
    return cycle_len;
  end if;

  with ordered as (
    select
      ss.id,
      ss.template_id,
      ss.session_type,
      ss.checklist,
      ss.coach_note,
      row_number() over (
        order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled')
  )
  select o.template_id into first_template
  from ordered o
  where o.rn = 1;

  if first_template is null then
    raise exception 'Could not determine this program''s rotation.';
  end if;

  with ordered as (
    select
      ss.template_id,
      row_number() over (
        order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled')
  )
  select min(o.rn) into repeat_rn
  from ordered o
  where o.rn > 1
    and o.template_id = first_template;

  if repeat_rn is not null and repeat_rn > 1 then
    cycle_len := repeat_rn - 1;
  else
    -- Fallback for programs whose generated horizon contains only one cycle.
    with ordered as (
      select
        ss.template_id,
        row_number() over (
          order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
        )::integer as rn
      from public.scheduled_sessions ss
      where ss.program_block_id = p_program_block_id
        and ss.user_id = p_user_id
        and ss.template_id is not null
        and (ss.queue_index is null or ss.queue_index < 1000000)
        and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled')
    )
    select least(count(*)::integer, 14) into cycle_len from ordered;
  end if;

  if cycle_len is null or cycle_len < 1 then
    raise exception 'Could not determine this program''s rotation length.';
  end if;

  insert into public.program_rotation_slots(
    program_block_id,user_id,slot_index,session_type,template_id,checklist,coach_note
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
      ss.template_id,
      ss.session_type,
      ss.checklist,
      ss.coach_note,
      row_number() over (
        order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
      )::integer as rn
    from public.scheduled_sessions ss
    where ss.program_block_id = p_program_block_id
      and ss.user_id = p_user_id
      and ss.template_id is not null
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled')
  ) o
  where o.rn <= cycle_len
  on conflict (program_block_id, slot_index) do nothing;

  return cycle_len;
end;
$function$;

revoke all on function public.mvp_seed_program_rotation_v1(uuid,uuid) from public;

-- Seed the rotation table for every existing active program now. This is read
-- from each program's own original sequence, so programs remain isolated.
do $seed$
declare r record;
begin
  for r in
    select pb.id, pb.user_id
    from public.program_blocks pb
    where pb.status = 'active'
  loop
    begin
      perform public.mvp_seed_program_rotation_v1(r.id, r.user_id);
    exception when others then
      raise notice 'Rotation seed skipped for program %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$seed$;

-- -------------------------------------------------------------------------
-- ONE-TIME REPAIR OF THE CURRENT TEST PROGRAM ONLY
-- IMPORTANT: preserve every existing live row's date + queue_index.
-- We repair only the workout identity in each live slot so the unique
-- program/date and program/queue constraints cannot collide with history.
-- -------------------------------------------------------------------------
do $repair$
declare
  target_program constant uuid := '16d23c39-0056-4e7b-8344-376e475180cc'::uuid;
  uid uuid;
  pending_ids uuid[];
  pending_count integer;
  i integer;
  desired_slot integer;
  slot_row public.program_rotation_slots%rowtype;
begin
  select pb.user_id into uid
  from public.program_blocks pb
  where pb.id = target_program;

  if uid is null then
    raise notice 'r45a test-program repair skipped: program not found.';
    return;
  end if;

  -- For this known test program, seed the canonical cycle explicitly from its
  -- own existing rows: Upper 1 -> Lower 1 -> Upper 2 -> Lower 2.
  delete from public.program_rotation_slots prs
  where prs.program_block_id = target_program;

  insert into public.program_rotation_slots(
    program_block_id,user_id,slot_index,session_type,template_id,checklist,coach_note
  )
  select target_program, uid, v.slot_index,
         s.session_type, s.template_id, s.checklist, s.coach_note
  from (values
    (1, 'upper 1'::text),
    (2, 'lower 1'::text),
    (3, 'upper 2'::text),
    (4, 'lower 2'::text)
  ) as v(slot_index, session_key)
  join lateral (
    select ss.session_type, ss.template_id, ss.checklist, ss.coach_note
    from public.scheduled_sessions ss
    where ss.program_block_id = target_program
      and ss.user_id = uid
      and lower(trim(coalesce(ss.session_type,''))) = v.session_key
      and ss.template_id is not null
    order by
      case when lower(coalesce(ss.status,'scheduled')) = 'scheduled' then 0 else 1 end,
      ss.queue_index asc nulls last,
      ss.date asc nulls last,
      ss.created_at asc,
      ss.id asc
    limit 1
  ) s on true;

  if (select count(*) from public.program_rotation_slots prs
      where prs.program_block_id = target_program and prs.user_id = uid) <> 4 then
    raise exception 'r45a could not resolve all four canonical test-program workouts.';
  end if;

  -- Live/unfinished rows only. Historical completed/skipped rows are untouched.
  select coalesce(
    array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc),
    array[]::uuid[]
  ) into pending_ids
  from (
    select ss.id, ss.queue_index, ss.date, ss.created_at
    from public.scheduled_sessions ss
    where ss.program_block_id = target_program
      and ss.user_id = uid
      and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled','completed')
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and not exists (
        select 1
        from public.workouts w
        where w.user_id = uid
          and w.scheduled_session_id = ss.id
          and w.completed_at is not null
      )
    order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
  ) x;

  pending_count := coalesce(array_length(pending_ids,1),0);
  if pending_count = 0 then
    raise notice 'r45a test-program repair found no live rows.';
    return;
  end if;

  -- Remove only unfinished workout shells attached to rows we are repairing.
  delete from public.workout_sets ws
  using public.workout_exercises we, public.workouts w
  where ws.workout_exercise_id = we.id
    and we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = any(pending_ids)
    and w.completed_at is null;

  delete from public.workout_exercises we
  using public.workouts w
  where we.workout_id = w.id
    and w.user_id = uid
    and w.scheduled_session_id = any(pending_ids)
    and w.completed_at is null;

  delete from public.workouts w
  where w.user_id = uid
    and w.scheduled_session_id = any(pending_ids)
    and w.completed_at is null;

  -- The user has already consumed/skipped Upper 2. The first live slot must be
  -- Lower 2, then U1, L1, U2, and repeat. Preserve each row's existing unique
  -- date and queue_index. Only change its workout identity/status.
  for i in 1..pending_count loop
    desired_slot := ((4 - 1 + i - 1) % 4) + 1;

    select * into slot_row
    from public.program_rotation_slots prs
    where prs.program_block_id = target_program
      and prs.user_id = uid
      and prs.slot_index = desired_slot;

    update public.scheduled_sessions
    set status = 'scheduled',
        session_type = slot_row.session_type,
        template_id = slot_row.template_id,
        checklist = slot_row.checklist,
        coach_note = slot_row.coach_note,
        updated_at = now()
    where id = pending_ids[i]
      and user_id = uid
      and program_block_id = target_program;
  end loop;
end;
$repair$;

create or replace function public.rpc_skip_scheduled_session_v5(
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
  live_ids uuid[];
  live_dates date[];
  live_queues integer[];
  live_templates uuid[];
  live_types text[];
  row_count integer;
  cycle_len integer;
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

  select ss.* into target_row
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
    select 1 from public.program_blocks pb
    where pb.id = target_row.program_block_id
      and pb.user_id = uid
      and pb.status = 'active'
  ) then
    raise exception 'Only the current session in the active program can be skipped.';
  end if;

  -- Ensure this program has a canonical rotation definition.
  cycle_len := public.mvp_seed_program_rotation_v1(target_row.program_block_id, uid);

  -- Live queue = this program only, unfinished occurrences only.
  select
    coalesce(array_agg(x.id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.date order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::date[]),
    coalesce(array_agg(coalesce(x.queue_index,0) order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::integer[]),
    coalesce(array_agg(x.template_id order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::uuid[]),
    coalesce(array_agg(x.session_type order by x.queue_index asc nulls last, x.date asc nulls last, x.created_at asc, x.id asc), array[]::text[])
  into live_ids, live_dates, live_queues, live_templates, live_types
  from (
    select ss.id, ss.date, ss.queue_index, ss.template_id, ss.session_type, ss.created_at
    from public.scheduled_sessions ss
    where ss.user_id = uid
      and ss.program_block_id = target_row.program_block_id
      and lower(coalesce(ss.status,'scheduled')) not in ('skipped','canceled','cancelled','completed')
      and (ss.queue_index is null or ss.queue_index < 1000000)
      and not exists (
        select 1 from public.workouts w
        where w.user_id = uid
          and w.scheduled_session_id = ss.id
          and w.completed_at is not null
      )
    order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc
  ) x;

  row_count := coalesce(array_length(live_ids,1),0);
  if row_count = 0 then
    raise exception 'No live workout rotation was found for this program.';
  end if;

  if live_ids[1] is distinct from p_session_id then
    raise exception 'Only the current workout occurrence can be skipped.';
  end if;

  if row_count >= 2 then
    replacement_id := live_ids[2];
    replacement_type := live_types[2];
  end if;

  -- Permanent event history for this exact occurrence only.
  insert into public.trainer_skipped_sessions(
    user_id,program_block_id,scheduled_session_id,template_id,session_type,original_date,skipped_at,reason
  ) values (
    uid,target_row.program_block_id,target_row.id,target_row.template_id,target_row.session_type,target_row.date,now(),nullif(trim(coalesce(p_reason,'')),'')
  ) on conflict do nothing;

  -- A skipped occurrence may have been opened or partially entered. Its
  -- unfinished data does not count as a completed workout.
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

  -- Determine what must occupy the NEW tail slot from the canonical rotation,
  -- based on the original last live session, NOT the skipped session.
  select prs.slot_index into last_slot
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and (
      (live_templates[row_count] is not null and prs.template_id = live_templates[row_count])
      or (live_templates[row_count] is null and lower(prs.session_type) = lower(live_types[row_count]))
    )
  order by case when prs.template_id = live_templates[row_count] then 0 else 1 end, prs.slot_index
  limit 1;

  if last_slot is null then
    select prs.slot_index into last_slot
    from public.program_rotation_slots prs
    where prs.program_block_id = target_row.program_block_id
      and prs.user_id = uid
      and lower(prs.session_type) = lower(live_types[row_count])
    order by prs.slot_index
    limit 1;
  end if;

  if last_slot is null then
    raise exception 'Could not map the end of this program queue back to its canonical rotation.';
  end if;

  next_slot := (last_slot % cycle_len) + 1;
  select * into slot_row
  from public.program_rotation_slots prs
  where prs.program_block_id = target_row.program_block_id
    and prs.user_id = uid
    and prs.slot_index = next_slot;

  if slot_row.program_block_id is null then
    raise exception 'Could not resolve the next canonical workout.';
  end if;

  -- Vacate all live dates/indexes first to honor scheduled_sessions_block_date_unique.
  select coalesce(max(ss.date),current_date) + 730 into temp_date_base
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id;

  select coalesce(max(ss.queue_index),0) + 3000000 into temp_queue_base
  from public.scheduled_sessions ss
  where ss.user_id = uid
    and ss.program_block_id = target_row.program_block_id;

  for i in 1..row_count loop
    update public.scheduled_sessions
    set date = temp_date_base + (i - 1),
        queue_index = temp_queue_base + i
    where id = live_ids[i]
      and user_id = uid
      and program_block_id = target_row.program_block_id;
  end loop;

  -- Archive exactly the consumed occurrence. It is NOT the future return of
  -- this workout; future returns are ordinary canonical occurrences already
  -- present later in the queue.
  archive_date := temp_date_base + row_count + 730;
  archive_queue := temp_queue_base + row_count + 3000000;
  update public.scheduled_sessions
  set date = archive_date,
      queue_index = archive_queue,
      status = 'skipped',
      updated_at = now()
  where id = p_session_id
    and user_id = uid
    and program_block_id = target_row.program_block_id;

  -- Shift rows 2..N into the immediately preceding real slots.
  if row_count >= 2 then
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
  end if;

  -- Fill the now-empty tail with the NEXT workout in the canonical rotation.
  insert into public.scheduled_sessions(
    user_id,program_block_id,date,session_type,template_id,status,checklist,coach_note,queue_index
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
  ) returning id into new_tail_id;

  return jsonb_build_object(
    'ok',true,
    'rpc_version','r45a_canonical_rotation_skip',
    'program_block_id',target_row.program_block_id,
    'skipped_session_id',target_row.id,
    'skipped_session_type',target_row.session_type,
    'next_session_id',replacement_id,
    'next_session_type',replacement_type,
    'new_tail_session_id',new_tail_id,
    'new_tail_session_type',slot_row.session_type,
    'canonical_cycle_length',cycle_len,
    'other_programs_touched',false
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v5(uuid,text) from public;
grant execute on function public.rpc_skip_scheduled_session_v5(uuid,text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Verification
select
  p.oid::regprocedure::text as installed_signature,
  position('r45a_canonical_rotation_skip' in pg_get_functiondef(p.oid)) > 0 as r45a_installed
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='rpc_skip_scheduled_session_v5';

select
  ss.queue_index,
  ss.date,
  ss.session_type,
  ss.status
from public.scheduled_sessions ss
where ss.program_block_id='16d23c39-0056-4e7b-8344-376e475180cc'::uuid
  and lower(coalesce(ss.status,'scheduled'))='scheduled'
  and (ss.queue_index is null or ss.queue_index < 1000000)
  and not exists (
    select 1 from public.workouts w
    where w.scheduled_session_id=ss.id and w.completed_at is not null
  )
order by ss.queue_index asc nulls last, ss.date asc nulls last
limit 12;
