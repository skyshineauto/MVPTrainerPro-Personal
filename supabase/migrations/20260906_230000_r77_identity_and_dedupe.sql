-- MVP Trainer Pro R77: personal exercise display names + recording dedupe.
begin;

create table if not exists public.exercise_name_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
alter table public.exercise_name_overrides enable row level security;

drop policy if exists "exercise name overrides select own" on public.exercise_name_overrides;
drop policy if exists "exercise name overrides insert own" on public.exercise_name_overrides;
drop policy if exists "exercise name overrides update own" on public.exercise_name_overrides;
drop policy if exists "exercise name overrides delete own" on public.exercise_name_overrides;
create policy "exercise name overrides select own" on public.exercise_name_overrides for select using (auth.uid() = user_id);
create policy "exercise name overrides insert own" on public.exercise_name_overrides for insert with check (auth.uid() = user_id);
create policy "exercise name overrides update own" on public.exercise_name_overrides for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exercise name overrides delete own" on public.exercise_name_overrides for delete using (auth.uid() = user_id);

alter table public.trainer_music_tracks add column if not exists audio_hash text;
create unique index if not exists trainer_music_tracks_audio_hash_idx on public.trainer_music_tracks(user_id,audio_hash) where audio_hash is not null;

create or replace function public.rpc_music_merge_duplicate_r77(p_keep_id uuid, p_duplicate_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  uid uuid := auth.uid();
  k public.trainer_music_tracks%rowtype;
  d public.trainer_music_tracks%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_keep_id = p_duplicate_id then return jsonb_build_object('merged',false); end if;
  select * into k from public.trainer_music_tracks where id=p_keep_id and user_id=uid for update;
  select * into d from public.trainer_music_tracks where id=p_duplicate_id and user_id=uid for update;
  if k.id is null or d.id is null then raise exception 'Track not found'; end if;

  if to_regclass('public.trainer_music_playlist_tracks') is not null then
    delete from public.trainer_music_playlist_tracks x
    using public.trainer_music_playlist_tracks y
    where x.track_id=p_duplicate_id and y.track_id=p_keep_id and x.playlist_id=y.playlist_id;
    update public.trainer_music_playlist_tracks set track_id=p_keep_id where track_id=p_duplicate_id;
  end if;

  if to_regclass('public.music_audition_songs') is not null then
    update public.music_audition_songs set library_track_id=p_keep_id, updated_at=now()
    where user_id=uid and library_track_id=p_duplicate_id;
  end if;

  if to_regclass('public.trainer_music_track_intelligence') is not null then
    if exists(select 1 from public.trainer_music_track_intelligence where user_id=uid and track_id=p_keep_id) then
      delete from public.trainer_music_track_intelligence where user_id=uid and track_id=p_duplicate_id;
    else
      update public.trainer_music_track_intelligence set track_id=p_keep_id,updated_at=now() where user_id=uid and track_id=p_duplicate_id;
    end if;
  end if;

  update public.trainer_music_tracks set
    favorite=coalesce(k.favorite,false) or coalesce(d.favorite,false),
    play_less=coalesce(k.play_less,false) or coalesce(d.play_less,false),
    play_count=coalesce(k.play_count,0)+coalesce(d.play_count,0),
    skip_count=coalesce(k.skip_count,0)+coalesce(d.skip_count,0),
    completed_play_count=coalesce(k.completed_play_count,0)+coalesce(d.completed_play_count,0),
    last_played_at=greatest(k.last_played_at,d.last_played_at),
    last_skipped_at=greatest(k.last_skipped_at,d.last_skipped_at),
    last_completed_at=greatest(k.last_completed_at,d.last_completed_at),
    title=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) and nullif(trim(d.title),'') is not null then d.title else k.title end,
    artist=coalesce(nullif(k.artist,''),nullif(d.artist,'')),
    album=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) and nullif(trim(coalesce(d.album,'')),'') is not null then d.album else coalesce(k.album,d.album) end,
    release_year=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) and d.release_year is not null then d.release_year else coalesce(k.release_year,d.release_year) end,
    genre=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) and nullif(trim(coalesce(d.genre,'')),'') is not null then d.genre else coalesce(k.genre,d.genre) end,
    artwork_path=coalesce(k.artwork_path,d.artwork_path),
    external_artwork_url=coalesce(k.external_artwork_url,d.external_artwork_url),
    metadata_status=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) then d.metadata_status else k.metadata_status end,
    metadata_source=case when coalesce(d.metadata_confidence,0) > coalesce(k.metadata_confidence,0) then d.metadata_source else k.metadata_source end,
    metadata_updated_at=greatest(k.metadata_updated_at,d.metadata_updated_at),
    metadata_confidence=greatest(coalesce(k.metadata_confidence,0),coalesce(d.metadata_confidence,0)),
    updated_at=now()
  where id=p_keep_id and user_id=uid;

  delete from public.trainer_music_tracks where id=p_duplicate_id and user_id=uid;
  return jsonb_build_object('merged',true,'keep_id',p_keep_id,'removed_id',p_duplicate_id);
end; $$;
revoke all on function public.rpc_music_merge_duplicate_r77(uuid,uuid) from public;
grant execute on function public.rpc_music_merge_duplicate_r77(uuid,uuid) to authenticated;

commit;
