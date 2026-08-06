import { supabase } from "./supabase";

const PLAYLIST_TABLE = "trainer_music_playlists";
const PLAYLIST_TRACK_TABLE = "trainer_music_playlist_tracks";

export type MusicPlaylist = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type MusicPlaylistTrackLink = {
  playlist_id: string;
  track_id: string;
  sort_order: number;
  added_at: string;
};

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before managing playlists.");
  return data.user.id;
}

export async function listMusicPlaylists(): Promise<MusicPlaylist[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select("id,user_id,name,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MusicPlaylist[];
}

export async function getMusicPlaylist(
  playlistId: string
): Promise<MusicPlaylist | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select("id,user_id,name,created_at,updated_at")
    .eq("id", playlistId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as MusicPlaylist | null) ?? null;
}

export async function createMusicPlaylist(name: string): Promise<MusicPlaylist> {
  const userId = await requireUserId();
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Enter a playlist name.");

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .insert({ user_id: userId, name: cleanName })
    .select("id,user_id,name,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as MusicPlaylist;
}

export async function renameMusicPlaylist(
  playlistId: string,
  name: string
): Promise<MusicPlaylist> {
  const userId = await requireUserId();
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Playlist name cannot be empty.");

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .update({ name: cleanName, updated_at: new Date().toISOString() })
    .eq("id", playlistId)
    .eq("user_id", userId)
    .select("id,user_id,name,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as MusicPlaylist;
}

export async function deleteMusicPlaylist(playlistId: string) {
  const userId = await requireUserId();
  const { error } = await supabase
    .from(PLAYLIST_TABLE)
    .delete()
    .eq("id", playlistId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function listMusicPlaylistTrackLinks(
  playlistId: string
): Promise<MusicPlaylistTrackLink[]> {
  await requireUserId();
  const { data, error } = await supabase
    .from(PLAYLIST_TRACK_TABLE)
    .select("playlist_id,track_id,sort_order,added_at")
    .eq("playlist_id", playlistId)
    .order("sort_order", { ascending: true })
    .order("added_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as MusicPlaylistTrackLink[];
}

export async function replaceMusicPlaylistTracks(
  playlistId: string,
  trackIds: string[]
) {
  await requireUserId();
  const uniqueIds = Array.from(new Set(trackIds.filter(Boolean)));

  const { error: deleteError } = await supabase
    .from(PLAYLIST_TRACK_TABLE)
    .delete()
    .eq("playlist_id", playlistId);
  if (deleteError) throw deleteError;

  if (uniqueIds.length) {
    const { error: insertError } = await supabase
      .from(PLAYLIST_TRACK_TABLE)
      .insert(
        uniqueIds.map((trackId, index) => ({
          playlist_id: playlistId,
          track_id: trackId,
          sort_order: index,
        }))
      );
    if (insertError) throw insertError;
  }

  const { error: touchError } = await supabase
    .from(PLAYLIST_TABLE)
    .update({ updated_at: new Date().toISOString() })
    .eq("id", playlistId);
  if (touchError) throw touchError;
}

export async function addMusicPlaylistTracks(
  playlistId: string,
  trackIds: string[]
) {
  const existing = await listMusicPlaylistTrackLinks(playlistId);
  const merged = [
    ...existing.map((link) => link.track_id),
    ...trackIds,
  ];
  await replaceMusicPlaylistTracks(playlistId, merged);
}

export async function removeMusicPlaylistTrack(
  playlistId: string,
  trackId: string
) {
  const existing = await listMusicPlaylistTrackLinks(playlistId);
  await replaceMusicPlaylistTracks(
    playlistId,
    existing.map((link) => link.track_id).filter((id) => id !== trackId)
  );
}
