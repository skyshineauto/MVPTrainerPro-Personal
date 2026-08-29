MVP TRAINER PRO - R42 AI TODAY DEPTH ONLY

REQUIRES
- R41 AI Today Polish already installed.

WHAT R42 CHANGES
- AI Today visual material only.
- Replaces blue-on-blue fill with a deep neutral near-black glass core.
- Stronger floating 3D depth and separation from the player background.
- Brighter electric cyan rim without flooding the entire surface blue.
- Stronger top specular highlight and darker lower edge for physical thickness.
- Deeper suspended shadow and restrained bloom.
- PLAYING FOR TODAY stays bright white and bold.
- Mood text stays cyan and readable.
- Direction text stays inside the AI control.
- TUNE becomes neutral dark glass with a cyan edge instead of another blue-filled control.
- Mobile uses the same high-depth material while remaining compact between artwork and DSP.
- No circuit-board graphics or surrounding background effects.

NOT CHANGED
- AI Today queue logic or song selection
- Repeat / shuffle behavior
- Song, Artist, Album, Playlist, Smart Mix, Intelligence, Discover, Audition UI
- DSP / WASM / AudioWorklet
- R2 / Supabase
- Workout / Coach / Progress
- Music player controls

WINDOWS COMMANDS
cd /d "C:\Users\PC User\Documents\GitHub\MVPTrainerPro-Personal"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%USERPROFILE%\Downloads\MVP-Trainer-Pro-r42-AI-Today-Depth.zip' -DestinationPath '%USERPROFILE%\Documents\GitHub\MVPTrainerPro-Personal\scripts' -Force"
node "scripts\MVP-Trainer-Pro-r42-AI-Today-Depth\apply-mvp-trainer-r42-ai-today-depth.mjs"
npm run build
