import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "v5-r6-music-intelligence-suite";
const MARKER = "MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE";

const FILES = {
  intelligence: path.join(ROOT, "src", "lib", "musicIntelligence.ts"),
  panel: path.join(ROOT, "src", "features", "music", "MusicIntelligencePanel.tsx"),
  player: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
  page: path.join(ROOT, "src", "features", "music", "MusicPage.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
};

const INTELLIGENCE_SOURCE = "import type { MusicTrack } from \"./musicStorage\";\nimport {\n  createMusicPlaylist,\n  listMusicPlaylists,\n  replaceMusicPlaylistTracks,\n} from \"./playlistStorage\";\n\nexport const LIKED_SONGS_PLAYLIST_NAME = \"Liked Songs\";\n\nexport type MusicRadioMode =\n  | \"more_like_this\"\n  | \"harder\"\n  | \"heavier\"\n  | \"faster\"\n  | \"melodic\";\n\nexport type WorkoutMusicStage =\n  | \"off\"\n  | \"warmup\"\n  | \"working\"\n  | \"heavy\"\n  | \"finisher\";\n\nexport type SongDna = {\n  energy: number;\n  heavy: number;\n  melodic: number;\n  dark: number;\n  drive: number;\n  workoutFit: number;\n};\n\nexport type PrSoundtrackRecord = {\n  id: string;\n  trackId: string;\n  title: string;\n  artist: string;\n  exerciseName: string;\n  setNumber: number;\n  records: string[];\n  createdAt: string;\n};\n\nconst KEYS = {\n  radio: \"mvp_music_neural_radio_v2\",\n  recent: \"mvp_music_neural_recent_v2\",\n  stage: \"mvp_music_workout_stage_v2\",\n  autoMix: \"mvp_music_automix_v2\",\n  prSoundtrack: \"mvp_music_pr_soundtrack_v2\",\n};\n\ntype RadioState = {\n  seedTrackId: string;\n  mode: MusicRadioMode;\n  startedAt: string;\n};\n\nfunction clamp(value: number) {\n  return Math.max(0, Math.min(100, Math.round(value)));\n}\n\nfunction readJson<T>(key: string, fallback: T): T {\n  if (typeof window === \"undefined\") return fallback;\n  try {\n    const raw = window.localStorage.getItem(key);\n    return raw ? (JSON.parse(raw) as T) : fallback;\n  } catch {\n    return fallback;\n  }\n}\n\nfunction writeJson(key: string, value: unknown) {\n  if (typeof window === \"undefined\") return;\n  try {\n    window.localStorage.setItem(key, JSON.stringify(value));\n  } catch {\n    // Intelligence memory is best effort only.\n  }\n}\n\nfunction trackText(track: MusicTrack) {\n  return `${track.artist || \"\"} ${track.album || \"\"} ${track.title || \"\"} ${track.genre || \"\"}`.toLowerCase();\n}\n\nfunction containsAny(value: string, words: string[]) {\n  return words.some((word) => value.includes(word));\n}\n\nfunction normalizedArtist(track: MusicTrack) {\n  return (track.artist || \"Unknown Artist\").trim().toLowerCase();\n}\n\nexport function getSongDna(track: MusicTrack): SongDna {\n  const text = trackText(track);\n  const energy =\n    track.energy_level === \"high\"\n      ? 88\n      : track.energy_level === \"medium\"\n        ? 62\n        : 34;\n\n  let heavy = 34 + (energy - 50) * 0.38;\n  if (\n    containsAny(text, [\n      \"metal\",\n      \"hard rock\",\n      \"metalcore\",\n      \"hardcore\",\n      \"industrial\",\n      \"nu metal\",\n      \"post-hardcore\",\n    ])\n  ) {\n    heavy += 31;\n  }\n  if (containsAny(text, [\"acoustic\", \"soft rock\", \"pop\"])) heavy -= 14;\n\n  let melodic = 50;\n  if (\n    containsAny(text, [\n      \"melodic\",\n      \"alternative\",\n      \"post-grunge\",\n      \"rock\",\n      \"anthem\",\n      \"acoustic\",\n    ])\n  ) {\n    melodic += 22;\n  }\n\n  let dark = 34;\n  if (\n    containsAny(text, [\n      \"dark\",\n      \"doom\",\n      \"goth\",\n      \"industrial\",\n      \"death\",\n      \"grave\",\n      \"pain\",\n      \"dead\",\n    ])\n  ) {\n    dark += 28;\n  }\n\n  let drive = energy * 0.77 + 12;\n  if (\n    containsAny(text, [\"punk\", \"thrash\", \"speed\", \"hardcore\", \"metalcore\"])\n  ) {\n    drive += 15;\n  }\n  if (track.favorite) drive += 5;\n  if (track.play_less) drive -= 25;\n\n  const completionRate = track.play_count\n    ? Math.min(\n        1,\n        track.completed_play_count / Math.max(1, track.play_count),\n      )\n    : 0.45;\n  const skipRate = track.play_count\n    ? Math.min(1, track.skip_count / Math.max(1, track.play_count))\n    : 0;\n\n  const workoutFit =\n    energy * 0.54 +\n    clamp(heavy) * 0.18 +\n    clamp(drive) * 0.17 +\n    completionRate * 18 -\n    skipRate * 24 +\n    (track.favorite ? 10 : 0) -\n    (track.play_less ? 40 : 0);\n\n  return {\n    energy: clamp(energy),\n    heavy: clamp(heavy),\n    melodic: clamp(melodic),\n    dark: clamp(dark),\n    drive: clamp(drive),\n    workoutFit: clamp(workoutFit),\n  };\n}\n\nexport function radioModeLabel(mode: MusicRadioMode) {\n  if (mode === \"harder\") return \"Harder\";\n  if (mode === \"heavier\") return \"Heavier\";\n  if (mode === \"faster\") return \"Faster\";\n  if (mode === \"melodic\") return \"More Melodic\";\n  return \"More Like This\";\n}\n\nexport function adaptiveRadioQueueName(\n  seed: MusicTrack,\n  mode: MusicRadioMode,\n) {\n  return `MVP Neural \u2022 ${radioModeLabel(mode)} \u2022 ${seed.title}`;\n}\n\nexport function isAdaptiveRadioName(name: string | null | undefined) {\n  return Boolean(\n    name &&\n      (name.startsWith(\"MVP Neural \u2022\") ||\n        name.startsWith(\"Like Radio \u2022\")),\n  );\n}\n\nexport function setWorkoutMusicContext(\n  activeIndex: number,\n  totalExercises: number,\n  doneCount = 0,\n) {\n  let stage: WorkoutMusicStage = \"off\";\n\n  if (totalExercises > 0) {\n    const progress =\n      Math.max(activeIndex, doneCount) /\n      Math.max(1, totalExercises - 1);\n\n    if (progress <= 0.12) stage = \"warmup\";\n    else if (progress >= 0.82) stage = \"finisher\";\n    else if (progress >= 0.48) stage = \"heavy\";\n    else stage = \"working\";\n  }\n\n  writeJson(KEYS.stage, stage);\n  return stage;\n}\n\nexport function getWorkoutMusicStage(): WorkoutMusicStage {\n  if (typeof window !== \"undefined\") {\n    try {\n      if (!window.localStorage.getItem(\"mvp_active_session_id\")) return \"off\";\n    } catch {\n      // Fall through.\n    }\n  }\n  return readJson<WorkoutMusicStage>(KEYS.stage, \"off\");\n}\n\nfunction recentIds() {\n  return readJson<string[]>(KEYS.recent, []).slice(0, 24);\n}\n\nfunction rememberTrack(trackId: string) {\n  writeJson(\n    KEYS.recent,\n    [trackId, ...recentIds().filter((id) => id !== trackId)].slice(0, 24),\n  );\n}\n\nfunction stageBias(dna: SongDna, stage: WorkoutMusicStage) {\n  if (stage === \"warmup\") {\n    return 22 - Math.abs(dna.energy - 64) * 0.35;\n  }\n  if (stage === \"working\") {\n    return dna.workoutFit * 0.23 + dna.drive * 0.12;\n  }\n  if (stage === \"heavy\") {\n    return dna.heavy * 0.2 + dna.energy * 0.18 + dna.drive * 0.16;\n  }\n  if (stage === \"finisher\") {\n    return dna.workoutFit * 0.28 + dna.energy * 0.2 + dna.drive * 0.2;\n  }\n  return dna.workoutFit * 0.08;\n}\n\nfunction dnaDistance(a: SongDna, b: SongDna, mode: MusicRadioMode) {\n  const weights =\n    mode === \"heavier\"\n      ? [0.8, 1.9, 0.5, 0.7, 0.9]\n      : mode === \"faster\"\n        ? [1.1, 0.6, 0.5, 0.4, 2]\n        : mode === \"melodic\"\n          ? [0.7, 0.5, 2, 0.5, 0.7]\n          : mode === \"harder\"\n            ? [1.6, 1.4, 0.4, 0.5, 1.5]\n            : [1, 1, 1, 0.7, 1];\n\n  const values = [\n    Math.abs(a.energy - b.energy),\n    Math.abs(a.heavy - b.heavy),\n    Math.abs(a.melodic - b.melodic),\n    Math.abs(a.dark - b.dark),\n    Math.abs(a.drive - b.drive),\n  ];\n\n  return (\n    values.reduce(\n      (sum, value, index) => sum + value * weights[index],\n      0,\n    ) / weights.reduce((sum, value) => sum + value, 0)\n  );\n}\n\nfunction candidateScore(\n  seed: MusicTrack,\n  current: MusicTrack,\n  candidate: MusicTrack,\n  mode: MusicRadioMode,\n  recent: Set<string>,\n  recentArtists: Set<string>,\n) {\n  if (\n    candidate.id === current.id ||\n    candidate.id === seed.id ||\n    candidate.play_less\n  ) {\n    return -99999;\n  }\n\n  const seedDna = getSongDna(seed);\n  const candidateDna = getSongDna(candidate);\n\n  let score = 100 - dnaDistance(seedDna, candidateDna, mode);\n\n  if (normalizedArtist(seed) === normalizedArtist(candidate)) score += 20;\n  if (normalizedArtist(current) === normalizedArtist(candidate)) score -= 34;\n\n  if (recent.has(candidate.id)) score -= 130;\n  if (recentArtists.has(normalizedArtist(candidate))) score -= 24;\n\n  if (mode === \"harder\") {\n    score += Math.max(0, candidateDna.energy - seedDna.energy) * 0.7;\n    score += Math.max(0, candidateDna.heavy - seedDna.heavy) * 0.5;\n  } else if (mode === \"heavier\") {\n    score += Math.max(0, candidateDna.heavy - seedDna.heavy) * 1.05;\n  } else if (mode === \"faster\") {\n    score += Math.max(0, candidateDna.drive - seedDna.drive) * 1.05;\n  } else if (mode === \"melodic\") {\n    score +=\n      Math.max(0, candidateDna.melodic - seedDna.melodic) * 1.05;\n  }\n\n  score += stageBias(candidateDna, getWorkoutMusicStage());\n  score += candidate.favorite ? 10 : 0;\n  score += Math.min(12, candidate.completed_play_count * 0.8);\n  score -= Math.min(26, candidate.skip_count * 3.2);\n\n  if (candidate.last_played_at) {\n    const hours =\n      (Date.now() - new Date(candidate.last_played_at).getTime()) /\n      3600000;\n\n    if (hours < 6) score -= 45;\n    else if (hours < 24) score -= 22;\n    else if (hours < 72) score -= 9;\n    else if (hours > 336) score += 8;\n  } else {\n    score += 12;\n  }\n\n  return score + Math.random() * 4;\n}\n\nexport function startRadioSession(\n  seed: MusicTrack,\n  library: MusicTrack[],\n  mode: MusicRadioMode = \"more_like_this\",\n) {\n  const radio: RadioState = {\n    seedTrackId: seed.id,\n    mode,\n    startedAt: new Date().toISOString(),\n  };\n\n  writeJson(KEYS.radio, radio);\n  rememberTrack(seed.id);\n\n  const recent = new Set(recentIds());\n  const recentArtists = new Set<string>();\n\n  const ranked = library\n    .filter((track) => track.id !== seed.id && !track.play_less)\n    .map((track) => ({\n      track,\n      score: candidateScore(\n        seed,\n        seed,\n        track,\n        mode,\n        recent,\n        recentArtists,\n      ),\n    }))\n    .sort((a, b) => b.score - a.score)\n    .slice(0, 50)\n    .map((entry) => entry.track);\n\n  return [seed, ...ranked];\n}\n\nexport function chooseAdaptiveNextTrack(\n  current: MusicTrack,\n  library: MusicTrack[],\n) {\n  const radio = readJson<RadioState | null>(KEYS.radio, null);\n  if (!radio) return null;\n\n  const seed =\n    library.find((track) => track.id === radio.seedTrackId) ?? current;\n  const recentList = recentIds();\n  const recent = new Set(recentList);\n  const recentArtists = new Set(\n    recentList\n      .map((id) => library.find((track) => track.id === id))\n      .filter((track): track is MusicTrack => Boolean(track))\n      .map(normalizedArtist),\n  );\n\n  const next =\n    library\n      .filter((track) => track.id !== current.id && !track.play_less)\n      .map((track) => ({\n        track,\n        score: candidateScore(\n          seed,\n          current,\n          track,\n          radio.mode,\n          recent,\n          recentArtists,\n        ),\n      }))\n      .sort((a, b) => b.score - a.score)[0]?.track ?? null;\n\n  if (next) rememberTrack(next.id);\n  return next;\n}\n\nexport function isAutoMixEnabled() {\n  const stored = readJson<boolean | null>(KEYS.autoMix, null);\n  return stored == null ? true : stored;\n}\n\nexport function setAutoMixEnabled(enabled: boolean) {\n  writeJson(KEYS.autoMix, Boolean(enabled));\n}\n\nexport async function syncLikedSongsPlaylist(library: MusicTrack[]) {\n  const playlists = await listMusicPlaylists();\n\n  let playlist =\n    playlists.find(\n      (item) =>\n        item.name.trim().toLowerCase() ===\n        LIKED_SONGS_PLAYLIST_NAME.toLowerCase(),\n    ) ?? null;\n\n  if (!playlist) {\n    playlist = await createMusicPlaylist(LIKED_SONGS_PLAYLIST_NAME);\n  }\n\n  const ids = library\n    .filter((track) => track.favorite)\n    .sort(\n      (a, b) =>\n        new Date(b.updated_at).getTime() -\n        new Date(a.updated_at).getTime(),\n    )\n    .map((track) => track.id);\n\n  await replaceMusicPlaylistTracks(playlist.id, ids);\n\n  if (typeof window !== \"undefined\") {\n    window.dispatchEvent(new Event(\"mvp:music-playlists-changed\"));\n  }\n\n  return playlist;\n}\n\nfunction staleHours(track: MusicTrack) {\n  if (!track.last_played_at) return Number.POSITIVE_INFINITY;\n  return Math.max(\n    0,\n    (Date.now() - new Date(track.last_played_at).getTime()) / 3600000,\n  );\n}\n\nexport function buildDiscoveryRadar(library: MusicTrack[]) {\n  const available = library.filter((track) => !track.play_less);\n\n  return [\n    {\n      id: \"forgotten\",\n      title: \"Forgotten Favorites\",\n      subtitle: \"Liked songs you have not heard lately\",\n      tracks: [...available]\n        .filter((track) => track.favorite && staleHours(track) > 336)\n        .sort((a, b) => staleHours(b) - staleHours(a))\n        .slice(0, 16),\n    },\n    {\n      id: \"deep\",\n      title: \"Deep Cuts\",\n      subtitle: \"Low-play tracks with strong workout potential\",\n      tracks: [...available]\n        .filter(\n          (track) => track.play_count <= 4 && track.skip_count <= 1,\n        )\n        .sort(\n          (a, b) =>\n            getSongDna(b).workoutFit - getSongDna(a).workoutFit,\n        )\n        .slice(0, 16),\n    },\n    {\n      id: \"rare\",\n      title: \"Rarely Played\",\n      subtitle: \"Hidden corners of your library\",\n      tracks: [...available]\n        .sort((a, b) => a.play_count - b.play_count)\n        .slice(0, 16),\n    },\n    {\n      id: \"energy\",\n      title: \"High-Energy Rediscovery\",\n      subtitle: \"Hard-driving tracks that have cooled off\",\n      tracks: [...available]\n        .filter(\n          (track) =>\n            track.energy_level === \"high\" &&\n            staleHours(track) > 168,\n        )\n        .sort(\n          (a, b) =>\n            getSongDna(b).workoutFit - getSongDna(a).workoutFit,\n        )\n        .slice(0, 16),\n    },\n  ];\n}\n\nexport function buildTasteMap(library: MusicTrack[]) {\n  const available = library.filter((track) => !track.play_less);\n\n  const definitions = [\n    {\n      id: \"heavy\",\n      label: \"HEAVY\",\n      subtitle: \"Weight, impact, aggression\",\n      score: (dna: SongDna) => dna.heavy,\n    },\n    {\n      id: \"drive\",\n      label: \"HIGH DRIVE\",\n      subtitle: \"Forward motion and workout pace\",\n      score: (dna: SongDna) => dna.drive,\n    },\n    {\n      id: \"melodic\",\n      label: \"MELODIC\",\n      subtitle: \"Hooks and melodic pull\",\n      score: (dna: SongDna) => dna.melodic,\n    },\n    {\n      id: \"dark\",\n      label: \"DARK\",\n      subtitle: \"Darker tonal character\",\n      score: (dna: SongDna) => dna.dark,\n    },\n    {\n      id: \"workout\",\n      label: \"WORKOUT CORE\",\n      subtitle: \"Highest overall training fit\",\n      score: (dna: SongDna) => dna.workoutFit,\n    },\n  ];\n\n  return definitions.map((definition) => {\n    const tracks = [...available]\n      .sort(\n        (a, b) =>\n          definition.score(getSongDna(b)) -\n          definition.score(getSongDna(a)),\n      )\n      .slice(0, 18);\n\n    const score = tracks.length\n      ? Math.round(\n          tracks.reduce(\n            (sum, track) =>\n              sum + definition.score(getSongDna(track)),\n            0,\n          ) / tracks.length,\n        )\n      : 0;\n\n    return {\n      id: definition.id,\n      label: definition.label,\n      subtitle: definition.subtitle,\n      score,\n      tracks,\n    };\n  });\n}\n\nexport function recordPrSoundtrack(\n  track: MusicTrack,\n  details: {\n    exerciseName: string;\n    setNumber: number;\n    records: string[];\n  },\n) {\n  const previous = readJson<PrSoundtrackRecord[]>(\n    KEYS.prSoundtrack,\n    [],\n  );\n\n  const record: PrSoundtrackRecord = {\n    id: `${Date.now()}:${track.id}`,\n    trackId: track.id,\n    title: track.title,\n    artist: track.artist || \"Unknown Artist\",\n    exerciseName: details.exerciseName,\n    setNumber: details.setNumber,\n    records: details.records,\n    createdAt: new Date().toISOString(),\n  };\n\n  writeJson(KEYS.prSoundtrack, [record, ...previous].slice(0, 100));\n  return record;\n}\n\nexport function listPrSoundtracks() {\n  return readJson<PrSoundtrackRecord[]>(KEYS.prSoundtrack, []);\n}\n";
const PANEL_SOURCE = "import { useMemo, useState } from \"react\";\nimport type { MusicTrack } from \"../../lib/musicStorage\";\nimport {\n  playMusicAdHocQueue,\n  playMusicTrack,\n  startMvpNeuralRadio,\n  useMusicPlayer,\n} from \"../../lib/musicPlayer\";\nimport {\n  buildDiscoveryRadar,\n  buildTasteMap,\n  getSongDna,\n  getWorkoutMusicStage,\n  isAutoMixEnabled,\n  listPrSoundtracks,\n  radioModeLabel,\n  setAutoMixEnabled,\n  type MusicRadioMode,\n} from \"../../lib/musicIntelligence\";\n\nexport function MusicIntelligencePanel({\n  tracks,\n}: {\n  tracks: MusicTrack[];\n}) {\n  const player = useMusicPlayer();\n  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());\n  const [message, setMessage] = useState(\"\");\n\n  const likedTracks = useMemo(\n    () =>\n      tracks\n        .filter((track) => track.favorite)\n        .sort(\n          (a, b) =>\n            new Date(b.updated_at).getTime() -\n            new Date(a.updated_at).getTime(),\n        ),\n    [tracks],\n  );\n\n  const dna = useMemo(\n    () => (player.currentTrack ? getSongDna(player.currentTrack) : null),\n    [\n      player.currentTrack?.id,\n      player.currentTrack?.updated_at,\n      player.currentTrack?.favorite,\n      player.currentTrack?.play_less,\n    ],\n  );\n\n  const radar = useMemo(() => buildDiscoveryRadar(tracks), [tracks]);\n  const tasteMap = useMemo(() => buildTasteMap(tracks), [tracks]);\n  const prSoundtracks = listPrSoundtracks();\n  const stage = getWorkoutMusicStage();\n\n  const startRadio = (mode: MusicRadioMode) => {\n    if (!player.currentTrack) {\n      setMessage(\"Play a song first, then choose a Neural direction.\");\n      return;\n    }\n\n    try {\n      const queue = startMvpNeuralRadio(player.currentTrack.id, mode);\n      setMessage(\n        `${radioModeLabel(mode)} \u2022 ${queue.length} library matches ready`,\n      );\n    } catch (error) {\n      setMessage(\n        error instanceof Error\n          ? error.message\n          : \"Could not start Neural Radio.\",\n      );\n    }\n  };\n\n  const toggleAutoMix = () => {\n    const next = !autoMix;\n    setAutoMix(next);\n    setAutoMixEnabled(next);\n    setMessage(next ? \"AutoMix Flow enabled.\" : \"AutoMix Flow disabled.\");\n  };\n\n  return (\n    <section className=\"mvp-v5-intel\">\n      <header className=\"mvp-v5-hero\">\n        <div>\n          <span>MVP MUSIC INTELLIGENCE</span>\n          <h2>Neural Radio</h2>\n          <p>\n            Your uploaded library reshaped around the current song,\n            your listening history, and the stage of your workout.\n          </p>\n        </div>\n\n        <div className=\"mvp-v5-live\">\n          <small>WORKOUT STAGE</small>\n          <strong>{stage.toUpperCase()}</strong>\n          <button\n            type=\"button\"\n            className={autoMix ? \"is-on\" : \"\"}\n            onClick={toggleAutoMix}\n          >\n            AUTOMIX {autoMix ? \"ON\" : \"OFF\"}\n          </button>\n        </div>\n      </header>\n\n      {message ? <div className=\"mvp-v5-message\">{message}</div> : null}\n\n      <div className=\"mvp-v5-modes\">\n        {(\n          [\n            \"more_like_this\",\n            \"harder\",\n            \"heavier\",\n            \"faster\",\n            \"melodic\",\n          ] as MusicRadioMode[]\n        ).map((mode) => (\n          <button\n            type=\"button\"\n            key={mode}\n            disabled={!player.currentTrack}\n            onClick={() => startRadio(mode)}\n          >\n            <small>MVP NEURAL</small>\n            <strong>{radioModeLabel(mode).toUpperCase()}</strong>\n          </button>\n        ))}\n      </div>\n\n      <section className=\"mvp-v5-block\">\n        <header>\n          <div>\n            <span>PERMANENT COLLECTION</span>\n            <h3>Liked Songs</h3>\n            <p>\n              Every Like is synchronized here. Your manual playlists\n              are never edited.\n            </p>\n          </div>\n          <b>{likedTracks.length}</b>\n        </header>\n\n        <div className=\"mvp-v5-actions\">\n          <button\n            type=\"button\"\n            disabled={!likedTracks.length}\n            onClick={() =>\n              void playMusicAdHocQueue(\"Liked Songs\", likedTracks)\n            }\n          >\n            \u25b6 PLAY LIKED\n          </button>\n\n          <button\n            type=\"button\"\n            disabled={!likedTracks.length}\n            onClick={() => {\n              const seed = likedTracks[0];\n              if (!seed) return;\n              const queue = startMvpNeuralRadio(\n                seed.id,\n                \"more_like_this\",\n              );\n              setMessage(\n                `Liked Radio \u2022 ${queue.length} library matches ready`,\n              );\n            }}\n          >\n            \u221e LIKED RADIO\n          </button>\n        </div>\n      </section>\n\n      <section className=\"mvp-v5-block\">\n        <header>\n          <div>\n            <span>LIVE ANALYSIS</span>\n            <h3>Song DNA</h3>\n            <p>\n              {player.currentTrack\n                ? `${player.currentTrack.title} \u2022 ${\n                    player.currentTrack.artist || \"Unknown Artist\"\n                  }`\n                : \"Play a song to expose its intelligence profile.\"}\n            </p>\n          </div>\n        </header>\n\n        {dna ? (\n          <div className=\"mvp-v5-dna\">\n            {(\n              [\n                [\"ENERGY\", dna.energy],\n                [\"HEAVY\", dna.heavy],\n                [\"MELODIC\", dna.melodic],\n                [\"DARK\", dna.dark],\n                [\"DRIVE\", dna.drive],\n                [\"WORKOUT FIT\", dna.workoutFit],\n              ] as Array<[string, number]>\n            ).map(([label, value]) => (\n              <div key={label}>\n                <span>{label}</span>\n                <strong>{String(value).padStart(2, \"0\")}</strong>\n                <i>\n                  <b style={{ width: `${value}%` }} />\n                </i>\n              </div>\n            ))}\n          </div>\n        ) : (\n          <div className=\"mvp-v5-empty\">NO ACTIVE SONG</div>\n        )}\n      </section>\n\n      <section className=\"mvp-v5-block\">\n        <header>\n          <div>\n            <span>DISCOVERY RADAR</span>\n            <h3>Bring your library back to life</h3>\n            <p>\n              Forgotten favorites, deep cuts, rarely played tracks,\n              and high-energy rediscovery.\n            </p>\n          </div>\n        </header>\n\n        <div className=\"mvp-v5-radar\">\n          {radar.map((lane) => (\n            <article key={lane.id}>\n              <small>{lane.tracks.length} TRACKS</small>\n              <h4>{lane.title}</h4>\n              <p>{lane.subtitle}</p>\n              <button\n                type=\"button\"\n                disabled={!lane.tracks.length}\n                onClick={() =>\n                  void playMusicAdHocQueue(\n                    `Radar \u2022 ${lane.title}`,\n                    lane.tracks,\n                  )\n                }\n              >\n                \u25b6 PLAY\n              </button>\n            </article>\n          ))}\n        </div>\n      </section>\n\n      <section className=\"mvp-v5-block\">\n        <header>\n          <div>\n            <span>SONIC TERRITORY</span>\n            <h3>Taste Map</h3>\n            <p>Explore your library by musical character.</p>\n          </div>\n        </header>\n\n        <div className=\"mvp-v5-taste\">\n          {tasteMap.map((cluster) => (\n            <button\n              type=\"button\"\n              key={cluster.id}\n              disabled={!cluster.tracks.length}\n              onClick={() =>\n                void playMusicAdHocQueue(\n                  `Taste Map \u2022 ${cluster.label}`,\n                  cluster.tracks,\n                )\n              }\n            >\n              <span>{cluster.label}</span>\n              <strong>{cluster.score}</strong>\n              <small>{cluster.subtitle}</small>\n            </button>\n          ))}\n        </div>\n      </section>\n\n      <section className=\"mvp-v5-block\">\n        <header>\n          <div>\n            <span>PERFORMANCE MEMORY</span>\n            <h3>PR Soundtrack</h3>\n            <p>Songs playing when you hit personal records.</p>\n          </div>\n          <b>{prSoundtracks.length}</b>\n        </header>\n\n        {prSoundtracks.length ? (\n          <div className=\"mvp-v5-pr\">\n            {prSoundtracks.slice(0, 12).map((record) => (\n              <article key={record.id}>\n                <strong>{record.title}</strong>\n                <span>{record.artist}</span>\n                <small>\n                  {record.exerciseName} \u2022 SET {record.setNumber} \u2022{\" \"}\n                  {record.records.join(\" + \")}\n                </small>\n                <button\n                  type=\"button\"\n                  onClick={() => void playMusicTrack(record.trackId, 0)}\n                >\n                  \u25b6\n                </button>\n              </article>\n            ))}\n          </div>\n        ) : (\n          <div className=\"mvp-v5-empty\">\n            PR songs will appear automatically when a PR is detected\n            while music is playing.\n          </div>\n        )}\n      </section>\n\n      <style>{`\n        .mvp-v5-intel{padding:11px;display:grid;gap:10px;background:radial-gradient(circle at 15% 0%,rgba(28,116,145,.13),transparent 34%),#03090d}\n        .mvp-v5-hero{padding:17px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;border:1px solid rgba(84,196,231,.22);border-radius:13px;background:linear-gradient(135deg,#081b24,#051016 58%,#071820)}\n        .mvp-v5-hero span,.mvp-v5-block>header span{color:#5dd8fa;font-size:7px;font-weight:1000;letter-spacing:.15em}\n        .mvp-v5-hero h2{margin:4px 0;font-size:27px;color:#f5fcff}.mvp-v5-hero p,.mvp-v5-block>header p{margin:0;color:#8aa4ae;font-size:9px}\n        .mvp-v5-live{min-width:150px;padding:10px;border:1px solid rgba(105,184,210,.14);border-radius:10px;background:#061117;display:grid;gap:5px}\n        .mvp-v5-live small{font-size:6px;color:#718993;font-weight:1000}.mvp-v5-live strong{font-size:14px}\n        .mvp-v5-live button{height:31px;border:1px solid rgba(116,156,170,.18);border-radius:7px;background:#071219;color:#a7bac1;font-size:8px;font-weight:1000}.mvp-v5-live button.is-on{border-color:rgba(61,210,245,.46);color:#baf1ff;background:#0a2b36}\n        .mvp-v5-message{padding:9px 11px;border:1px solid rgba(76,204,244,.18);border-radius:8px;background:#07151c;color:#9ee9fb;font-size:8px;font-weight:850}\n        .mvp-v5-modes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}.mvp-v5-modes button{min-height:62px;padding:9px;border:1px solid rgba(80,179,214,.16);border-radius:10px;background:linear-gradient(180deg,#081820,#051016);color:#fff;text-align:left}.mvp-v5-modes button:hover:not(:disabled){border-color:rgba(72,212,250,.48);background:#092430}.mvp-v5-modes button:disabled{opacity:.32}.mvp-v5-modes small{display:block;color:#5b8594;font-size:6px;font-weight:1000}.mvp-v5-modes strong{display:block;margin-top:6px;font-size:8px;letter-spacing:.03em}\n        .mvp-v5-block{border:1px solid rgba(94,165,190,.12);border-radius:12px;background:#050e13;overflow:hidden}.mvp-v5-block>header{padding:12px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(91,160,185,.09)}.mvp-v5-block>header h3{margin:3px 0;font-size:16px;color:#f4fbfe}.mvp-v5-block>header>b{font-size:25px;color:#67daf9}\n        .mvp-v5-actions{padding:10px;display:flex;gap:7px}.mvp-v5-actions button,.mvp-v5-radar button{height:35px;padding:0 12px;border:1px solid rgba(61,204,244,.28);border-radius:8px;background:#08242e;color:#eafaff;font-size:8px;font-weight:1000}.mvp-v5-actions button:disabled,.mvp-v5-radar button:disabled{opacity:.3}\n        .mvp-v5-dna{padding:10px;display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.mvp-v5-dna>div{padding:9px;border:1px solid rgba(102,163,184,.1);border-radius:9px;background:#071218}.mvp-v5-dna span{display:block;color:#79939d;font-size:6px;font-weight:1000}.mvp-v5-dna strong{display:block;margin:4px 0 6px;color:#fff;font-size:18px}.mvp-v5-dna i{height:3px;display:block;background:#02070a;border-radius:4px;overflow:hidden}.mvp-v5-dna i b{height:100%;display:block;background:linear-gradient(90deg,#2584a3,#61daf8)}\n        .mvp-v5-radar{padding:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.mvp-v5-radar article{padding:10px;border:1px solid rgba(92,160,184,.1);border-radius:9px;background:#071219}.mvp-v5-radar small{color:#54c9ec;font-size:6px;font-weight:1000}.mvp-v5-radar h4{margin:5px 0 3px;color:#fff;font-size:11px}.mvp-v5-radar p{min-height:27px;margin:0 0 8px;color:#78919b;font-size:7px}\n        .mvp-v5-taste{padding:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.mvp-v5-taste button{min-height:112px;padding:12px;border:1px solid rgba(85,177,209,.15);border-radius:50%;background:radial-gradient(circle,rgba(52,178,218,.17),#061219 68%);color:#fff}.mvp-v5-taste span,.mvp-v5-taste strong,.mvp-v5-taste small{display:block}.mvp-v5-taste span{font-size:7px;font-weight:1000}.mvp-v5-taste strong{margin:5px 0;font-size:21px}.mvp-v5-taste small{font-size:6px;color:#8ba4ad}\n        .mvp-v5-pr{padding:9px;display:grid;gap:5px}.mvp-v5-pr article{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:8px 9px;border:1px solid rgba(101,166,188,.09);border-radius:8px;background:#071218}.mvp-v5-pr span,.mvp-v5-pr small{grid-column:1;color:#8da4ad;font-size:7px}.mvp-v5-pr button{grid-column:2;grid-row:1/4;width:34px;height:34px;align-self:center;border:1px solid rgba(66,205,245,.27);border-radius:50%;background:#082630;color:#fff}\n        .mvp-v5-empty{padding:18px;color:#8099a3;font-size:8px;text-align:center}\n        @media(max-width:760px){.mvp-v5-intel{padding:7px}.mvp-v5-hero{grid-template-columns:1fr;padding:12px}.mvp-v5-hero h2{font-size:23px}.mvp-v5-modes{grid-template-columns:repeat(2,1fr)}.mvp-v5-modes button:first-child{grid-column:1/-1}.mvp-v5-dna{grid-template-columns:repeat(3,1fr)}.mvp-v5-radar{grid-template-columns:1fr 1fr}.mvp-v5-taste{grid-template-columns:repeat(2,1fr)}.mvp-v5-taste button:last-child{grid-column:1/-1;border-radius:12px;min-height:84px}}\n      `}</style>\n    </section>\n  );\n}\n";

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V5 R6 stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

for (const key of ["player", "page", "workout"]) {
  if (!fs.existsSync(FILES[key])) {
    stop(`${key} source file was not found. Run this from the repo root.`);
  }
}

const original = {
  player: fs.readFileSync(FILES.player, "utf8"),
  page: fs.readFileSync(FILES.page, "utf8"),
  workout: fs.readFileSync(FILES.workout, "utf8"),
};

if (
  original.player.includes(MARKER) ||
  original.page.includes(MARKER) ||
  original.workout.includes(MARKER)
) {
  console.log("MVP Trainer V5 R6 Music Intelligence Suite is already installed.");
  process.exit(0);
}

let player = original.player;
let page = original.page;
let workout = original.workout;

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let mode = "code";
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === "line") {
      if (ch === "\n") mode = "code";
      continue;
    }

    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 1;
      }
      continue;
    }

    if (mode === "single" || mode === "double" || mode === "template") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (
        (mode === "single" && ch === "'") ||
        (mode === "double" && ch === '"') ||
        (mode === "template" && ch === "`")
      ) {
        mode = "code";
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      mode = "line";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      i += 1;
      continue;
    }
    if (ch === "'") {
      mode = "single";
      continue;
    }
    if (ch === '"') {
      mode = "double";
      continue;
    }
    if (ch === "`") {
      mode = "template";
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function replaceFunction(text, token, replacement, label) {
  const start = text.indexOf(token);
  if (start < 0) stop(`${label} declaration was not found.`);

  const open = text.indexOf("{", start + token.length);
  if (open < 0) stop(`${label} opening brace was not found.`);

  const close = findMatchingBrace(text, open);
  if (close < 0) stop(`${label} closing brace was not found.`);

  return text.slice(0, start) + replacement + text.slice(close + 1);
}

function insertAfterLastImport(text, addition, label) {
  const importRx = /^import[\s\S]*?;\s*$/gm;
  const matches = [...text.matchAll(importRx)];
  if (!matches.length) stop(`${label}: no import statements were found.`);

  const last = matches[matches.length - 1];
  const end = (last.index ?? 0) + last[0].length;

  return text.slice(0, end) + "\n" + addition + "\n" + text.slice(end);
}

// -----------------------------------------------------------------------------
// musicPlayer.ts
// -----------------------------------------------------------------------------
if (!player.includes('from "./musicIntelligence"')) {
  const playlistImportRx =
    /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/playlistStorage["']\s*;/m;
  const match = player.match(playlistImportRx);

  if (!match || match.index == null) {
    stop("musicPlayer playlistStorage import module was not found.");
  }

  const importBlock = `import {
  adaptiveRadioQueueName,
  chooseAdaptiveNextTrack,
  isAdaptiveRadioName,
  isAutoMixEnabled,
  startRadioSession,
  syncLikedSongsPlaylist,
  type MusicRadioMode,
} from "./musicIntelligence";`;

  const insertAt = match.index + match[0].length;
  player =
    player.slice(0, insertAt) +
    "\n" +
    importBlock +
    player.slice(insertAt);
}

player = replaceFunction(
  player,
  "export async function nextMusicTrack(",
`/* ${MARKER}: ADAPTIVE NEXT */
export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();

  if (!fromEnded && shouldRecordSkip() && state.currentTrack) {
    void recordMusicTrackSkipped(state.currentTrack.id).catch(() => undefined);
  }

  if (
    state.currentTrack &&
    isAdaptiveRadioName(state.activePlaylistName)
  ) {
    const adaptive = chooseAdaptiveNextTrack(
      state.currentTrack,
      state.libraryTracks,
    );

    if (adaptive) {
      if (!fromEnded && isAutoMixEnabled() && musicGain && audioContext) {
        const originalGain = Math.max(0.0001, musicGain.gain.value || 1);
        await fadeOutputTo(Math.min(originalGain, 0.06), 120);
        await playMusicTrack(adaptive.id, 0);
        await fadeOutputTo(originalGain, 240);
      } else {
        await playMusicTrack(adaptive.id, 0);
      }
      return;
    }
  }

  const index = state.shuffle
    ? nextShuffleIndex()
    : nextSequentialIndex(1);

  if (index < 0) {
    if (fromEnded) stopMusic();
    return;
  }

  const track = state.tracks[index];
  if (track) await playMusicTrack(track.id, 0);
}`,
  "musicPlayer nextMusicTrack",
);

player = replaceFunction(
  player,
  "export async function setPlayerMusicPreference(",
`/* ${MARKER}: LIKE RADIO + LIKED SONGS */
export async function setPlayerMusicPreference(
  trackId: string,
  preference: "neutral" | "like" | "play_less",
) {
  const wasCurrent = state.currentTrack?.id === trackId;
  const updated = await setMusicTrackPreference(trackId, preference);
  const patchTrack = (track: MusicTrack) =>
    track.id === trackId ? updated : track;

  const nextLibrary = state.libraryTracks.map(patchTrack);
  const nextQueue = state.tracks.map(patchTrack);

  emit({
    libraryTracks: nextLibrary,
    tracks: nextQueue,
    currentTrack: wasCurrent ? updated : state.currentTrack,
  });

  void syncLikedSongsPlaylist(nextLibrary).catch((error) => {
    console.warn("Could not synchronize Liked Songs.", error);
  });

  if (preference === "like" && wasCurrent) {
    const radio = startRadioSession(
      updated,
      nextLibrary,
      "more_like_this",
    );

    activateMusicAdHocQueue(
      \`Like Radio • \${updated.title}\`,
      radio,
    );
  }

  return updated;
}

export function startMvpNeuralRadio(
  seedTrackId: string,
  mode: MusicRadioMode = "more_like_this",
) {
  const seed = state.libraryTracks.find(
    (track) => track.id === seedTrackId,
  );

  if (!seed) {
    throw new Error("Song not found in your music library.");
  }

  const queue = startRadioSession(
    seed,
    state.libraryTracks,
    mode,
  );

  activateMusicAdHocQueue(
    adaptiveRadioQueueName(seed, mode),
    queue,
  );

  return queue;
}

export function getMusicPlayerSnapshot() {
  return state;
}`,
  "musicPlayer setPlayerMusicPreference",
);

// -----------------------------------------------------------------------------
// MusicPage.tsx
// -----------------------------------------------------------------------------
if (!page.includes('from "./MusicIntelligencePanel"')) {
  page = insertAfterLastImport(
    page,
    `import { MusicIntelligencePanel } from "./MusicIntelligencePanel";`,
    "MusicPage intelligence import",
  );
}

const musicTabRx = /type\s+MusicTab\s*=\s*([^;]+);/m;
const musicTabMatch = page.match(musicTabRx);
if (!musicTabMatch) stop("MusicPage MusicTab type was not found.");

if (!musicTabMatch[1].includes('"intelligence"')) {
  const replacement = musicTabMatch[0].replace(
    '"discover"',
    '"intelligence" | "discover"',
  );
  page = page.replace(musicTabRx, replacement);
}

const tabNeedle =
  '["smart","SMART MIX"], ["discover","DISCOVER"]';

if (!page.includes(tabNeedle)) {
  stop("MusicPage navigation tab list was not found.");
}

page = page.replace(
  tabNeedle,
  '["smart","SMART MIX"], ["intelligence","INTELLIGENCE"], ["discover","DISCOVER"]',
);

const discoverNeedle =
  '        {tab === "discover" ? <section className="tr10-discover">';

if (!page.includes(discoverNeedle)) {
  stop("MusicPage Discover section insertion point was not found.");
}

page = page.replace(
  discoverNeedle,
`        {/* ${MARKER}: INTELLIGENCE PANEL */}
        {tab === "intelligence" ? (
          <MusicIntelligencePanel tracks={tracks} />
        ) : null}
${discoverNeedle}`,
);

const styleClose = "      `}</style>";
if (!page.includes(styleClose)) {
  stop("MusicPage final style closing anchor was not found.");
}

page = page.replace(
  styleClose,
`        /* ${MARKER}: 7-TAB NAV */
        .tr10-tabs{grid-template-columns:repeat(7,minmax(0,1fr))!important}
        @media(max-width:650px){
          .tr10-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .tr10-tabs button:last-child{grid-column:auto!important}
        }
${styleClose}`,
);

// -----------------------------------------------------------------------------
// WorkoutPlayerPage.tsx
// -----------------------------------------------------------------------------
if (!workout.includes('from "../../lib/musicIntelligence"')) {
  const assetAnchor = 'import icoDumbbell from "../../assets/dumbbell.png";';
  const assetIndex = workout.indexOf(assetAnchor);

  if (assetIndex < 0) {
    stop("WorkoutPlayer asset import insertion point was not found.");
  }

  const importBlock =
`import { getMusicPlayerSnapshot } from "../../lib/musicPlayer";
import {
  recordPrSoundtrack,
  setWorkoutMusicContext,
} from "../../lib/musicIntelligence";

`;

  workout =
    workout.slice(0, assetIndex) +
    importBlock +
    workout.slice(assetIndex);
}

if (!workout.includes(`${MARKER}: WORKOUT-AWARE QUEUE`)) {
  const currentRx =
    /(\s*const doneCount = useMemo\(\(\) => items\.filter\(\(x\) => !!x\.completed_at\)\.length, \[items\]\);\s*\n\s*const current = items\[activeIdx\];)/m;

  const match = workout.match(currentRx);

  if (!match) {
    stop("WorkoutPlayer doneCount/current block was not found.");
  }

  workout = workout.replace(
    currentRx,
`${match[1]}

  /* ${MARKER}: WORKOUT-AWARE QUEUE */
  useEffect(() => {
    setWorkoutMusicContext(
      activeIdx,
      items.length,
      doneCount,
    );
  }, [activeIdx, items.length, doneCount]);`,
  );
}

if (!workout.includes(`${MARKER}: PR SOUNDTRACK`)) {
  const prStart = workout.indexOf(
    "const prDetails = buildPersonalRecordDetails(",
  );

  if (prStart < 0) {
    stop("WorkoutPlayer PR detail block was not found.");
  }

  const ifStart = workout.indexOf(
    "if (prDetails.length)",
    prStart,
  );

  if (ifStart < 0) {
    stop("WorkoutPlayer PR condition was not found.");
  }

  const elseNeedle = "    } else if (hasNextSet) {";
  const elseIndex = workout.indexOf(elseNeedle, ifStart);

  if (elseIndex < 0) {
    stop("WorkoutPlayer PR else boundary was not found.");
  }

  const prHook =
`      /* ${MARKER}: PR SOUNDTRACK */
      const prTrack = getMusicPlayerSnapshot().currentTrack;
      if (prTrack) {
        recordPrSoundtrack(prTrack, {
          exerciseName: item?.name ?? "Exercise",
          setNumber: Number(row.set_index),
          records: prDetails.map((record) => record.label),
        });
      }
`;

  workout =
    workout.slice(0, elseIndex) +
    prHook +
    workout.slice(elseIndex);
}

// -----------------------------------------------------------------------------
// VALIDATE ALL CORE FEATURES BEFORE WRITING ANYTHING.
// -----------------------------------------------------------------------------
const checks = [
  [player.includes(`${MARKER}: ADAPTIVE NEXT`), "adaptive next"],
  [player.includes(`${MARKER}: LIKE RADIO + LIKED SONGS`), "Like Radio"],
  [player.includes("startMvpNeuralRadio"), "Neural Radio export"],
  [player.includes("getMusicPlayerSnapshot"), "player snapshot"],
  [page.includes('"intelligence","INTELLIGENCE"'), "Intelligence tab"],
  [page.includes("<MusicIntelligencePanel tracks={tracks} />"), "Intelligence panel"],
  [workout.includes(`${MARKER}: WORKOUT-AWARE QUEUE`), "workout-aware queue"],
  [workout.includes(`${MARKER}: PR SOUNDTRACK`), "PR soundtrack"],
  [INTELLIGENCE_SOURCE.includes("syncLikedSongsPlaylist"), "Liked Songs engine"],
  [INTELLIGENCE_SOURCE.includes("candidateScore"), "anti-repetition engine"],
  [PANEL_SOURCE.includes("Song DNA"), "Song DNA UI"],
  [PANEL_SOURCE.includes("DISCOVERY RADAR"), "Discovery Radar UI"],
  [PANEL_SOURCE.includes("Taste Map"), "Taste Map UI"],
  [PANEL_SOURCE.includes("PR Soundtrack"), "PR Soundtrack UI"],
];

for (const [ok, label] of checks) {
  if (!ok) stop(`validation failed: ${label}`);
}

// -----------------------------------------------------------------------------
// BACKUP + WRITE ONLY AFTER EVERY VALIDATION ABOVE PASSES.
// -----------------------------------------------------------------------------
for (const file of [FILES.player, FILES.page, FILES.workout]) {
  fs.copyFileSync(
    file,
    `${file}.pre-${VERSION}.bak`,
  );
}

if (fs.existsSync(FILES.intelligence)) {
  fs.copyFileSync(
    FILES.intelligence,
    `${FILES.intelligence}.pre-${VERSION}.bak`,
  );
}

if (fs.existsSync(FILES.panel)) {
  fs.copyFileSync(
    FILES.panel,
    `${FILES.panel}.pre-${VERSION}.bak`,
  );
}

fs.writeFileSync(FILES.intelligence, INTELLIGENCE_SOURCE, "utf8");
fs.writeFileSync(FILES.panel, PANEL_SOURCE, "utf8");
fs.writeFileSync(FILES.player, player, "utf8");
fs.writeFileSync(FILES.page, page, "utf8");
fs.writeFileSync(FILES.workout, workout, "utf8");

console.log("");
console.log("MVP Trainer V5 R6 Music Intelligence Suite applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("INSTALLED:");
console.log("  ✓ Permanent Liked Songs playlist");
console.log("  ✓ Like Radio");
console.log("  ✓ MVP Neural Radio");
console.log("  ✓ More Like This / Harder / Heavier / Faster / More Melodic");
console.log("  ✓ Workout-aware queueing");
console.log("  ✓ Song DNA");
console.log("  ✓ Discovery Radar");
console.log("  ✓ Anti-repetition intelligence");
console.log("  ✓ AutoMix Flow");
console.log("  ✓ PR Soundtrack Memory");
console.log("  ✓ Taste Map");
console.log("  ✓ No voice / microphone features");
console.log("");
console.log("NEXT: npm run build");
