import React, { useEffect } from "react";
import {
  cycleMusicRepeat,
  formatMusicTime,
  loadMusicLibrary,
  nextMusicTrack,
  pauseMusic,
  playMusic,
  previousMusicTrack,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
} from "../../lib/musicPlayer";

export function MusicMiniPlayer({
  navigate,
}: {
  navigate: (to: string) => void;
}) {
  const player = useMusicPlayer();

  useEffect(() => {
    void loadMusicLibrary();
  }, []);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Player state displays the useful error.
    }
  };

  const track = player.currentTrack;
  const progressMax = Math.max(1, player.duration || track?.duration_seconds || 1);
  const progressValue = Math.min(progressMax, Math.max(0, player.currentTime));

  return (
    <section className="tr-musicMini" aria-label="MVP Trainer music player">
      <button
        type="button"
        className="tr-musicMiniInfo"
        onClick={() => navigate("/music")}
        title="Open My Music"
      >
        <span className="tr-musicMiniIcon" aria-hidden>♫</span>
        <span className="tr-musicMiniText">
          <span className="tr-musicMiniTitle">
            {track?.title || (player.loading ? "Loading music…" : "My Music")}
          </span>
          <span className="tr-musicMiniArtist">
            {track
              ? track.artist || "MVP Trainer library"
              : "Upload songs and build your workout playlist"}
          </span>
        </span>
      </button>

      <div className="tr-musicMiniProgress" aria-hidden>
        <span
          style={{
            width: `${Math.max(0, Math.min(100, (progressValue / progressMax) * 100))}%`,
          }}
        />
      </div>

      <div className="tr-musicMiniControls">
        <button
          type="button"
          className={`tr-musicControl tr-musicControl--mode ${player.shuffle ? "is-active" : ""}`}
          onClick={() => toggleMusicShuffle()}
          aria-label={`Shuffle ${player.shuffle ? "on" : "off"}`}
          title={`Shuffle ${player.shuffle ? "on" : "off"}`}
        >
          ⇄
        </button>

        <button
          type="button"
          className="tr-musicControl"
          onClick={() => run(previousMusicTrack)}
          aria-label="Previous song"
          title="Previous song"
          disabled={!player.tracks.length}
        >
          ◀◀
        </button>

        <button
          type="button"
          className="tr-musicControl tr-musicControl--primary"
          onClick={() => run(player.playing ? pauseMusic : playMusic)}
          aria-label={player.playing ? "Pause music" : "Play music"}
          title={player.playing ? "Pause" : "Play"}
        >
          {player.playing ? "Ⅱ" : "▶"}
        </button>

        <button
          type="button"
          className="tr-musicControl"
          onClick={() => stopMusic()}
          aria-label="Stop music"
          title="Stop music"
          disabled={!track}
        >
          ■
        </button>

        <button
          type="button"
          className="tr-musicControl"
          onClick={() => run(() => nextMusicTrack())}
          aria-label="Next song"
          title="Next song"
          disabled={!player.tracks.length}
        >
          ▶▶
        </button>

        <button
          type="button"
          className={`tr-musicControl tr-musicControl--mode ${player.repeat !== "off" ? "is-active" : ""}`}
          onClick={() => cycleMusicRepeat()}
          aria-label={`Repeat ${player.repeat}`}
          title={`Repeat: ${player.repeat}`}
        >
          {player.repeat === "one" ? "↻1" : "↻"}
        </button>
      </div>

      <div className="tr-musicMiniStatus">
        <span>{formatMusicTime(player.currentTime)}</span>
        <button type="button" onClick={() => navigate("/music")}>MY MUSIC</button>
        <span>{formatMusicTime(player.duration || track?.duration_seconds || 0)}</span>
      </div>

      {player.error ? <div className="tr-musicMiniError">{player.error}</div> : null}
    </section>
  );
}
