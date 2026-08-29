MVP TRAINER PRO - R41 AI TODAY POLISH ONLY

This patch requires R40 AI Today to already be installed.

WHAT R41 CHANGES
- Desktop AI Today control is centered horizontally in the real gap between artwork and DSP.
- Mobile AI Today control is centered at the bottom of the hero between artwork and DSP.
- High-depth floating 3D/glass/cyan AI styling.
- PLAYING FOR TODAY is bolder.
- Mood text such as Tired is the bright AI accent.
- Direction text is shortened and resized so it stays inside the AI control.
- Change is replaced by TUNE with a cyan control treatment.
- Mobile shows one compact mood word so it does not truncate or wrap.
- Repeat is forced OFF while AI Today is active. Shuffle is also OFF.
- AI Today queues contain unique songs and do not use normal player repeat.
- Song selection is stricter for calm/tired/recovery states.
- High-energy, high-drive, aggressive, overly upbeat tracks are hard-excluded for low-energy moods.
- Adds an Artist DNA layer for major artists plus genre/style fallback.
- Supports future persisted Song DNA fields automatically when the library intelligence scan is added.

NOT CHANGED
- Songs / Artists / Albums / Playlists / Smart Mix / Intelligence / Discover / Audition UI
- DSP / WASM / AudioWorklet
- R2 / Supabase routing
- Workout / Coach / Progress / session systems
- Existing MusicMiniPlayer controls

WINDOWS COMMANDS
If the ZIP is still in Downloads, run these exact commands:

cd /d "C:\Users\PC User\Documents\GitHub\MVPTrainerPro-Personal"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%USERPROFILE%\Downloads\MVP-Trainer-Pro-r41-AI-Today-Polish.zip' -DestinationPath '%USERPROFILE%\Documents\GitHub\MVPTrainerPro-Personal\scripts' -Force"
node "scripts\MVP-Trainer-Pro-r41-AI-Today-Polish\apply-mvp-trainer-r41-ai-today-polish.mjs"
npm run build

If you already manually extracted the R41 folder into scripts, run:

cd /d "C:\Users\PC User\Documents\GitHub\MVPTrainerPro-Personal"
node "scripts\MVP-Trainer-Pro-r41-AI-Today-Polish\apply-mvp-trainer-r41-ai-today-polish.mjs"
npm run build
