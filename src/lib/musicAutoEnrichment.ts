/* R29: Automatic resumable foreground worker. No manual Enrich Library repeat
 * required. It runs while the app is open and resumes unfinished tracks when
 * the app reopens. Server-side operation after all browsers close requires a
 * separately configured scheduled worker; do not claim this client does that.
 */
import type { MusicTrack } from "./musicStorage";
import { listMusicTracks } from "./musicStorage";
import { enrichMusicTrack, needsMusicMetadata } from "./musicMetadata";
import {
  analyzeMusicTrackIntelligence,
  hydrateMusicIntelligenceCache,
  isMusicIntelligenceCurrent,
} from "./musicIntelligenceEnrichment";
import { supabase } from "./supabase";

const STORAGE = "mvp_music_auto_enrichment_r30";
type Attempt = { failures: number; retryAt: number; finished?: boolean };
type Saved = { userId: string; attempts: Record<string, Attempt> };
let active = false;
let requested = false;
let timer: number | undefined;
let pauseCheck: (() => boolean) | undefined;
let preferredTrackIds = new Set<string>();

function read(userId: string): Saved {
  try {
    const raw = localStorage.getItem(STORAGE);
    const parsed = raw ? JSON.parse(raw) as Saved : null;
    if (parsed?.userId === userId && parsed.attempts && typeof parsed.attempts === "object") return parsed;
  } catch { /* optional storage; Supabase holds the actual intelligence */ }
  return { userId, attempts: {} };
}
function save(value: Saved) {
  try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch { /* retry on next app visit */ }
}
function delayFor(failures: number) {
  return [0, 60_000, 30 * 60_000, 24 * 3600_000, 3 * 86400_000, 7 * 86400_000, 7 * 86400_000][Math.min(6, failures)];
}
function publish(phase: string, completed: number, total: number, track?: MusicTrack) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mvp:music-auto-enrichment-progress", {
    detail: { phase, completed, total, trackId: track?.id || null },
  }));
}

async function processLibrary() {
  if (active || typeof window === "undefined" || !navigator.onLine) return;
  active = true;
  try {
    if (pauseCheck?.()) { schedule(4000); return; }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return;
    const userId = data.user.id;
    const tracks = await listMusicTracks();
    const intelligence = await hydrateMusicIntelligenceCache(tracks, { fresh: true });
    const saved = read(userId);
    const now = Date.now();
    // Uploaded tracks get priority. Every library entry is still inspected.
    const ordered = [...tracks].sort((a, b) => Number(preferredTrackIds.has(b.id)) - Number(preferredTrackIds.has(a.id)));
    const needed = ordered.filter(track => {
      const result = intelligence.get(track.id);
      if (isMusicIntelligenceCurrent(result) && !needsMusicMetadata(track)) return false;
      const attempt = saved.attempts[track.id];
      // Honor backoff even for partial rows. New R30 storage initializes one
      // targeted recovery pass; subsequent retries do not hammer providers.
      return !attempt || attempt.retryAt <= now || preferredTrackIds.has(track.id);
    });
    let completed = 0;
    publish("running", completed, needed.length);
    for (const original of needed) {
      if (pauseCheck?.()) { publish("paused", completed, needed.length); schedule(4000); break; }
      const latestUser = await supabase.auth.getUser();
      if (latestUser.data.user?.id !== userId) break;
      let track = original;
      const previous = saved.attempts[track.id] || { failures: 0, retryAt: 0 };
      try {
        const before = [track.title, track.artist, track.album, track.release_year, track.genre].join("|");
        if (needsMusicMetadata(track) || track.metadata_status === "unknown" || track.metadata_status === "review") {
          const result = await enrichMusicTrack(track, { autoApplyThreshold: .97, replaceArtwork: true });
          track = result.track;
        }
        const after = [track.title, track.artist, track.album, track.release_year, track.genre].join("|");
        const item = isMusicIntelligenceCurrent(intelligence.get(track.id)) && before === after
          ? intelligence.get(track.id)!
          : await analyzeMusicTrackIntelligence(track, { force: true });
        const complete = isMusicIntelligenceCurrent(item) && !needsMusicMetadata(track);
        const failures = complete ? 0 : previous.failures + 1;
        saved.attempts[track.id] = { failures, retryAt: complete ? Number.MAX_SAFE_INTEGER : Date.now() + delayFor(failures), finished: complete };
      } catch (error) {
        const failures = previous.failures + 1;
        saved.attempts[track.id] = { failures, retryAt: Date.now() + delayFor(failures) };
        console.warn("Automatic Music Intelligence will retry unresolved fields", track.id, error);
      } finally {
        preferredTrackIds.delete(track.id);
        completed += 1;
        save(saved);
        publish("running", completed, needed.length, track);
      }
    }
    const snapshot = await hydrateMusicIntelligenceCache(tracks, { fresh: true }).catch(() => intelligence);
    const remaining = tracks.filter(track => !isMusicIntelligenceCurrent(snapshot.get(track.id)));
    publish(remaining.length ? "partial" : "verified-complete", completed, needed.length);
    if (remaining.length) console.info(`[MVP INTELLIGENCE] ${tracks.length - remaining.length}/${tracks.length} verified; ${remaining.length} partial. Automatic retry is scheduled.`);
  } catch (error) {
    console.warn("Automatic music enrichment deferred until connectivity resumes", error);
  } finally {
    active = false;
    if (requested) { requested = false; schedule(1500); }
  }
}
function schedule(ms: number) {
  if (typeof window === "undefined") return;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = undefined; void processLibrary(); }, ms);
}
export function queueAutomaticMusicEnrichment(trackId: string) {
  if (trackId) preferredTrackIds.add(trackId);
  if (active) requested = true;
  else schedule(1200);
}
let started = false;
export function startAutomaticMusicEnrichment(shouldPause: () => boolean) {
  pauseCheck = shouldPause;
  if (started) { schedule(1200); return; }
  started = true;
  if (typeof window === "undefined") return;
  const resume = () => { if (document.visibilityState === "visible" && navigator.onLine) schedule(1500); };
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  window.setInterval(resume, 12 * 60_000);
  resume();
}
