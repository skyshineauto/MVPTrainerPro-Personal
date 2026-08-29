MVP TRAINER PRO R40 - AI TODAY ONLY
==================================

SCOPE
-----
This is the one-issue patch we approved: AI Today in the music player.
It does NOT replace the My Music tabs, Audition, Intelligence, Smart Mix, DSP/WASM,
storage routing, workouts, Coach, Progress, or Session HUD.

WHAT R40 DOES
-------------
- Adds a slim AI Today command bar to the expanded desktop player, immediately left of DSP.
- Adds the compact mobile AI Today control beside the album-art area with a dedicated mobile sheet.
- Accepts natural-language state/mood input.
- Builds a fresh temporary MVP Today queue from the CURRENT prompt only.
- Does not use Likes, Play Less, play counts, skips, completion history, or last-played history to rank AI Today.
- Automatically starts the best matching song as soon as the prompt is submitted.
- Change rebuilds the queue and immediately switches to the new best match.
- Existing Heavier / Harder / Faster / Melodic / Darker / Like This / Surprise Me steering is intercepted while MVP Today is active and rebuilds that Today queue live.
- AI Today forces shuffle OFF and repeat ALL while active. The generated queue contains unique song IDs, so songs do not repeat until that generated queue has been exhausted.
- Playing From identifies the queue as MVP Today · <current state>.

FILES
-----
NEW:
  src/lib/musicToday.ts
  src/features/music/premium/MusicTodayAi.tsx
  src/features/music/premium/MusicTodayAi.css

SURGICALLY PATCHED:
  src/features/music/MusicMiniPlayer.tsx

INSTALL
-------
1. Extract this entire folder. Keep the payload folder beside the installer.
2. Open Command Prompt / PowerShell in your MVPTrainerPro repository root.
3. Run:

   node <path-to-extracted-folder>\apply-mvp-trainer-r40-ai-today-only.mjs

   Or copy this entire extracted R40 folder inside the repo and run the installer from there.

4. Then run:

   npm run build

5. If the build passes, commit/push normally and let Cloudflare deploy.

SAFETY
------
- The installer refuses to guess if the current player does not contain the approved modern tr-playerHero + tr-dspPlayerCornerDock + Neural steering anchors.
- It refuses a partial/legacy Today integration.
- It backs up MusicMiniPlayer.tsx before changing it.
- If an install verification fails, it rolls the R40 changes back.
- Re-running an already installed R40 is idempotent.
