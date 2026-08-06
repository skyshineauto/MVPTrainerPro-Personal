import { supabase } from "./supabase";

export const PLAYLIST_TABLE = "trainer_music_playlists";
export const PLAYLIST_TRACK_TABLE =
  "trainer_music_playlist_tracks";
export const MUSIC_TRACK_TABLE = "trainer_music_tracks";

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

const PLAYLIST_SELECT =
  "id,user_id,name,created_at,updated_at";

function cleanPlaylistName(name: string) {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);

  if (!cleaned) {
    throw new Error("Enter a playlist name.");
  }

  return cleaned;
}

function uniqueTrackIds(trackIds: string[]) {
  return Array.from(
    new Set(
      trackIds
        .map((trackId) =>
          String(trackId ?? "").trim()
        )
        .filter(Boolean)
    )
  );
}

async function requireUserId() {
  const { data, error } =
    await supabase.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    throw new Error(
      "Sign in before managing playlists."
    );
  }

  return data.user.id;
}

async function requireOwnedPlaylist(
  playlistId: string,
  userId: string
): Promise<MusicPlaylist> {
  const cleanId = String(playlistId ?? "").trim();

  if (!cleanId) {
    throw new Error("Playlist ID is required.");
  }

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select(PLAYLIST_SELECT)
    .eq("id", cleanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "This playlist was not found or is no longer available."
    );
  }

  return data as MusicPlaylist;
}

async function listPlaylistTrackLinksUnchecked(
  playlistId: string
): Promise<MusicPlaylistTrackLink[]> {
  const { data, error } = await supabase
    .from(PLAYLIST_TRACK_TABLE)
    .select(
      "playlist_id,track_id,sort_order,added_at"
    )
    .eq("playlist_id", playlistId)
    .order("sort_order", {
      ascending: true,
    })
    .order("added_at", {
      ascending: true,
    });

  if (error) throw error;

  return (data ??
    []) as MusicPlaylistTrackLink[];
}

async function requireOwnedTrackIds(
  trackIds: string[],
  userId: string
) {
  if (!trackIds.length) return;

  const { data, error } = await supabase
    .from(MUSIC_TRACK_TABLE)
    .select("id")
    .eq("user_id", userId)
    .in("id", trackIds);

  if (error) throw error;

  const ownedIds = new Set(
    (data ?? []).map((row) =>
      String((row as { id: string }).id)
    )
  );

  const missing = trackIds.filter(
    (trackId) => !ownedIds.has(trackId)
  );

  if (missing.length) {
    throw new Error(
      "One or more songs are no longer available in your music library."
    );
  }
}

async function touchPlaylist(
  playlistId: string,
  userId: string
) {
  const { error } = await supabase
    .from(PLAYLIST_TABLE)
    .update({
      updated_at: new Date().toISOString(),
    })
    .eq("id", playlistId)
    .eq("user_id", userId);

  if (error) throw error;
}

async function restorePlaylistLinks(
  links: MusicPlaylistTrackLink[]
) {
  if (!links.length) return;

  const { error } = await supabase
    .from(PLAYLIST_TRACK_TABLE)
    .insert(
      links.map((link, index) => ({
        playlist_id: link.playlist_id,
        track_id: link.track_id,
        sort_order: Number.isFinite(
          Number(link.sort_order)
        )
          ? Number(link.sort_order)
          : index,
      }))
    );

  if (error) {
    console.error(
      "Playlist rollback failed:",
      error.message
    );
  }
}

export async function listMusicPlaylists(): Promise<
  MusicPlaylist[]
> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select(PLAYLIST_SELECT)
    .eq("user_id", userId)
    .order("updated_at", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) throw error;

  return (data ?? []) as MusicPlaylist[];
}

export async function getMusicPlaylist(
  playlistId: string
): Promise<MusicPlaylist | null> {
  const userId = await requireUserId();
  const cleanId = String(playlistId ?? "").trim();

  if (!cleanId) return null;

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select(PLAYLIST_SELECT)
    .eq("id", cleanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return (data as MusicPlaylist | null) ?? null;
}

export async function createMusicPlaylist(
  name: string
): Promise<MusicPlaylist> {
  const userId = await requireUserId();
  const cleanName = cleanPlaylistName(name);

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .insert({
      user_id: userId,
      name: cleanName,
      updated_at: new Date().toISOString(),
    })
    .select(PLAYLIST_SELECT)
    .single();

  if (error) throw error;

  return data as MusicPlaylist;
}

export async function renameMusicPlaylist(
  playlistId: string,
  name: string
): Promise<MusicPlaylist> {
  const userId = await requireUserId();
  const playlist = await requireOwnedPlaylist(
    playlistId,
    userId
  );
  const cleanName = cleanPlaylistName(name);

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .update({
      name: cleanName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", playlist.id)
    .eq("user_id", userId)
    .select(PLAYLIST_SELECT)
    .single();

  if (error) throw error;

  return data as MusicPlaylist;
}

export async function deleteMusicPlaylist(
  playlistId: string
) {
  const userId = await requireUserId();
  const playlist = await requireOwnedPlaylist(
    playlistId,
    userId
  );

  const { error } = await supabase
    .from(PLAYLIST_TABLE)
    .delete()
    .eq("id", playlist.id)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function listMusicPlaylistTrackLinks(
  playlistId: string
): Promise<MusicPlaylistTrackLink[]> {
  const userId = await requireUserId();
  const playlist = await requireOwnedPlaylist(
    playlistId,
    userId
  );

  return listPlaylistTrackLinksUnchecked(
    playlist.id
  );
}

export async function replaceMusicPlaylistTracks(
  playlistId: string,
  trackIds: string[]
) {
  const userId = await requireUserId();
  const playlist = await requireOwnedPlaylist(
    playlistId,
    userId
  );
  const uniqueIds = uniqueTrackIds(trackIds);

  await requireOwnedTrackIds(
    uniqueIds,
    userId
  );

  const previousLinks =
    await listPlaylistTrackLinksUnchecked(
      playlist.id
    );

  const { error: deleteError } =
    await supabase
      .from(PLAYLIST_TRACK_TABLE)
      .delete()
      .eq("playlist_id", playlist.id);

  if (deleteError) throw deleteError;

  if (uniqueIds.length) {
    const { error: insertError } =
      await supabase
        .from(PLAYLIST_TRACK_TABLE)
        .insert(
          uniqueIds.map(
            (trackId, index) => ({
              playlist_id: playlist.id,
              track_id: trackId,
              sort_order: index,
            })
          )
        );

    if (insertError) {
      await restorePlaylistLinks(
        previousLinks
      );

      throw insertError;
    }
  }

  await touchPlaylist(
    playlist.id,
    userId
  );
}

export async function addMusicPlaylistTracks(
  playlistId: string,
  trackIds: string[]
) {
  const existing =
    await listMusicPlaylistTrackLinks(
      playlistId
    );

  const merged = [
    ...existing.map(
      (link) => link.track_id
    ),
    ...trackIds,
  ];

  await replaceMusicPlaylistTracks(
    playlistId,
    merged
  );
}

export async function removeMusicPlaylistTrack(
  playlistId: string,
  trackId: string
) {
  const cleanTrackId = String(
    trackId ?? ""
  ).trim();

  if (!cleanTrackId) return;

  const existing =
    await listMusicPlaylistTrackLinks(
      playlistId
    );

  await replaceMusicPlaylistTracks(
    playlistId,
    existing
      .map((link) => link.track_id)
      .filter(
        (id) => id !== cleanTrackId
      )
  );
}
