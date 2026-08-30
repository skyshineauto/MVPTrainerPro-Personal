-- MVP Trainer Pro R44
-- Persistent Song DNA + Artist DNA for My Music.
-- Safe/idempotent migration. Existing trainer_music_tracks data is not replaced.

begin;

create table if not exists public.trainer_music_artist_intelligence (
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_key text not null,
  artist_name text not null,
  status text not null default 'complete',
  analysis_version integer not null default 1,
  confidence numeric(5,4) not null default 0,
  source text[] not null default '{}',
  artist_dna jsonb not null default '{}'::jsonb,
  top_tags jsonb not null default '[]'::jsonb,
  genres text[] not null default '{}',
  musicbrainz_artist_id text,
  analyzed_at timestamptz,
  updated_at timestamptz not null default now(),
  error text,
  primary key (user_id, artist_key)
);

create table if not exists public.trainer_music_track_intelligence (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.trainer_music_tracks(id) on delete cascade,
  artist_key text not null default '',
  artist_name text not null default '',
  status text not null default 'pending',
  analysis_version integer not null default 1,
  confidence numeric(5,4) not null default 0,
  source text[] not null default '{}',
  song_dna jsonb not null default '{}'::jsonb,
  artist_dna jsonb not null default '{}'::jsonb,
  bpm numeric(7,2),
  key_signature text,
  tempo_label text,
  main_genres text[] not null default '{}',
  subgenres text[] not null default '{}',
  moods text[] not null default '{}',
  character_tags text[] not null default '{}',
  movement_tags text[] not null default '{}',
  music_for text[] not null default '{}',
  description text,
  musicbrainz_recording_id text,
  musicbrainz_artist_id text,
  lastfm_track_tags jsonb not null default '[]'::jsonb,
  cyanite_track_id text,
  cyanite_status text,
  provider_payload jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz,
  updated_at timestamptz not null default now(),
  error text,
  primary key (user_id, track_id)
);

alter table public.trainer_music_artist_intelligence enable row level security;
alter table public.trainer_music_track_intelligence enable row level security;

-- Re-create policies defensively so this migration can be rerun.
drop policy if exists "music artist intelligence select own" on public.trainer_music_artist_intelligence;
drop policy if exists "music artist intelligence insert own" on public.trainer_music_artist_intelligence;
drop policy if exists "music artist intelligence update own" on public.trainer_music_artist_intelligence;
drop policy if exists "music artist intelligence delete own" on public.trainer_music_artist_intelligence;
create policy "music artist intelligence select own" on public.trainer_music_artist_intelligence for select using (auth.uid() = user_id);
create policy "music artist intelligence insert own" on public.trainer_music_artist_intelligence for insert with check (auth.uid() = user_id);
create policy "music artist intelligence update own" on public.trainer_music_artist_intelligence for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "music artist intelligence delete own" on public.trainer_music_artist_intelligence for delete using (auth.uid() = user_id);

drop policy if exists "music track intelligence select own" on public.trainer_music_track_intelligence;
drop policy if exists "music track intelligence insert own" on public.trainer_music_track_intelligence;
drop policy if exists "music track intelligence update own" on public.trainer_music_track_intelligence;
drop policy if exists "music track intelligence delete own" on public.trainer_music_track_intelligence;
create policy "music track intelligence select own" on public.trainer_music_track_intelligence for select using (auth.uid() = user_id);
create policy "music track intelligence insert own" on public.trainer_music_track_intelligence for insert with check (auth.uid() = user_id);
create policy "music track intelligence update own" on public.trainer_music_track_intelligence for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "music track intelligence delete own" on public.trainer_music_track_intelligence for delete using (auth.uid() = user_id);

create index if not exists trainer_music_track_intelligence_status_idx
  on public.trainer_music_track_intelligence (user_id, status, analysis_version, updated_at desc);
create index if not exists trainer_music_track_intelligence_artist_idx
  on public.trainer_music_track_intelligence (user_id, artist_key);
create index if not exists trainer_music_artist_intelligence_updated_idx
  on public.trainer_music_artist_intelligence (user_id, updated_at desc);

comment on table public.trainer_music_track_intelligence is
  'Persistent per-song Music Intelligence used by AI Today, enrichment, Smart Mix and future music features.';
comment on column public.trainer_music_track_intelligence.song_dna is
  'Normalized 0-100 Song DNA: energy, heaviness, aggression, drive, intensity, melodic, darkness, brightness, atmospheric, reflective, relaxing, uplifting, motivational, chaotic, focus, upbeat and workoutFit.';
comment on table public.trainer_music_artist_intelligence is
  'Cached per-user Artist DNA so repeated songs by one artist do not repeatedly research the same artist.';

commit;
