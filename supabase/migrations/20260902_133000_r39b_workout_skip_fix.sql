-- MVP Trainer Pro r39b - Skip Session transaction fix
-- September 2, 2026
-- Replaces the original delete-based skip transaction with a status-based
-- atomic queue advance. The skipped scheduled row is preserved for audit/history.

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
  target_pos integer;
  row_count integer := 0;
  i integer;
  current_id uuid;
  replacement_id uuid := null;
  replacement_type text := null;
  previous_date public.scheduled_sessions.date%type;
  previous_queue_index public.scheduled_sessions.queue_index%type;
  current_date public.scheduled_sessions.date%type;
  current_queue_index public.scheduled_sessions.queue_index%type;
  status_type_oid oid;
  status_is_enum boolean := false;
  skip_status text := 'skipped';
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

  select coalesce(array_agg(ss.id order by ss.queue_index asc nulls last, ss.date asc nulls last, ss.created_at asc, ss.id asc), array[]::uuid[])
  into ordered_ids
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

  target_pos := array_position(ordered_ids, p_session_id);
  if target_pos is null then
    raise exception 'The selected session is not in the pending workout queue.';
  end if;

  -- The UI only offers Skip on NEXT, but enforce it at the database too.
  if target_pos <> 1 then
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
  on conflict (user_id, scheduled_session_id)
  do update set
    skipped_at = now(),
    reason = excluded.reason;

  -- Determine whether status is text or an enum. If the enum predates a
  -- dedicated skipped state, use canceled/cancelled as the queue-exclusion
  -- value while trainer_skipped_sessions remains the authoritative SKIPPED log.
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
    if exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'skipped') then
      skip_status := 'skipped';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'canceled') then
      skip_status := 'canceled';
    elsif exists (select 1 from pg_enum e where e.enumtypid = status_type_oid and e.enumlabel = 'cancelled') then
      skip_status := 'cancelled';
    else
      raise exception 'scheduled_sessions.status enum has no skipped/canceled value.';
    end if;

    execute format(
      'update public.scheduled_sessions set status = %L::%s where id = $1 and user_id = $2',
      skip_status,
      status_type_oid::regtype
    ) using p_session_id, uid;
  else
    update public.scheduled_sessions
    set status = skip_status
    where id = p_session_id
      and user_id = uid;
  end if;

  previous_date := target_row.date;
  previous_queue_index := target_row.queue_index;

  -- Vacate the skipped row's queue slot before shifting the live rows.
  -- Keep the skipped row itself for history/audit.
  update public.scheduled_sessions
  set queue_index = case
        when target_row.queue_index is null then null
        else target_row.queue_index + 1000000
      end
  where id = p_session_id
    and user_id = uid;

  if row_count >= 2 then
    for i in 2..row_count loop
      current_id := ordered_ids[i];

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
    'ok', true,
    'skipped_session_id', target_row.id,
    'skipped_session_type', target_row.session_type,
    'skipped_original_date', target_row.date,
    'skip_status', skip_status,
    'next_session_id', replacement_id,
    'next_session_type', replacement_type,
    'advanced_sessions', greatest(row_count - 1, 0)
  );
end;
$function$;

revoke all on function public.rpc_skip_scheduled_session_v1(uuid, text) from public;
grant execute on function public.rpc_skip_scheduled_session_v1(uuid, text) to authenticated;
