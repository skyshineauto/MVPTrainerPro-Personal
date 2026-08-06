-- MVP Trainer Pro
-- Performance Audio + Smart Mix metadata upgrade
--
-- Safe to run more than once.
-- Supabase: SQL Editor -> New query -> paste this file -> Run.

begin;

alter table public.trainer_music_tracks
  add column if not exists favorite boolean,
  add column if not exists energy_level text,
  add column if not exists play_count integer,
  add column if not exists skip_count integer,
  add column if not exists last_played_at timestamptz;

update public.trainer_music_tracks
set
  favorite = coalesce(favorite, false),
  energy_level = case
    when energy_level in ('low', 'medium', 'high') then energy_level
    else 'medium'
  end,
  play_count = greatest(coalesce(play_count, 0), 0),
  skip_count = greatest(coalesce(skip_count, 0), 0)
where
  favorite is null
  or energy_level is null
  or energy_level not in ('low', 'medium', 'high')
  or play_count is null
  or play_count < 0
  or skip_count is null
  or skip_count < 0;

alter table public.trainer_music_tracks
  alter column favorite set default false,
  alter column favorite set not null,
  alter column energy_level set default 'medium',
  alter column energy_level set not null,
  alter column play_count set default 0,
  alter column play_count set not null,
  alter column skip_count set default 0,
  alter column skip_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trainer_music_tracks_energy_level_check'
      and conrelid = 'public.trainer_music_tracks'::regclass
  ) then
    alter table public.trainer_music_tracks
      add constraint trainer_music_tracks_energy_level_check
      check (energy_level in ('low', 'medium', 'high'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'trainer_music_tracks_play_count_check'
      and conrelid = 'public.trainer_music_tracks'::regclass
  ) then
    alter table public.trainer_music_tracks
      add constraint trainer_music_tracks_play_count_check
      check (play_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'trainer_music_tracks_skip_count_check'
      and conrelid = 'public.trainer_music_tracks'::regclass
  ) then
    alter table public.trainer_music_tracks
      add constraint trainer_music_tracks_skip_count_check
      check (skip_count >= 0);
  end if;
end
$$;

create index if not exists trainer_music_tracks_smart_mix_idx
  on public.trainer_music_tracks (
    user_id,
    favorite desc,
    energy_level,
    last_played_at desc nulls last,
    play_count,
    skip_count
  );

create index if not exists trainer_music_tracks_user_energy_idx
  on public.trainer_music_tracks (
    user_id,
    energy_level,
    sort_order
  );

comment on column public.trainer_music_tracks.favorite is
  'User-selected favorite flag used by MVP Trainer Smart Mix.';

comment on column public.trainer_music_tracks.energy_level is
  'User-selected training energy category: low, medium, or high.';

comment on column public.trainer_music_tracks.play_count is
  'Number of recorded playback starts used by Smart Mix.';

comment on column public.trainer_music_tracks.skip_count is
  'Number of early skips used by Smart Mix.';

comment on column public.trainer_music_tracks.last_played_at is
  'Most recent recorded playback start used to improve queue variety.';

commit;
