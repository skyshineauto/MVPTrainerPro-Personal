import fs from "node:fs";
import assert from "node:assert/strict";

const read = (file) => fs.readFileSync(file, "utf8");
const engine = read("src/lib/audio/mvpStemObjectEngine.ts");
const stems = read("src/lib/musicStems.ts");
const player = read("src/lib/musicPlayer.ts");
const ui = read("src/features/music/MusicMiniPlayer.tsx");
const api = read("functions/api/music-stems.js");
const workflow = read(".github/workflows/mvp-v6-stems.yml");

assert.match(engine, /panningModel = "HRTF"/);
assert.match(engine, /createChannelSplitter\(2\)/);
assert.match(engine, /vocals:[\s\S]*leftX:[\s\S]*rightX:/);
assert.match(engine, /bass:[\s\S]*leftX:[\s\S]*rightX:/);
assert.match(engine, /drums:[\s\S]*stage/);
assert.match(engine, /other:[\s\S]*stage/);
assert.match(engine, /mode === "arena"/);
assert.match(engine, /mode === "live"/);
assert.match(engine, /roomDelay/);

assert.match(stems, /ensureMusicStemBundle/);
assert.match(stems, /action: "probe"/);
assert.match(stems, /action: "start"/);
assert.match(stems, /action: "status"/);
assert.match(stems, /attempt < 600/);

assert.match(api, /MVP_V61_GITHUB_DEMUCS_QUEUE/);
assert.match(api, /GITHUB_STEM_TOKEN/);
assert.match(api, /mvp-v6-stems\.yml/);
assert.match(api, /actions\/workflows/);
assert.match(api, /workerPutJson/);
assert.doesNotMatch(api, /REPLICATE_API_TOKEN/);
assert.doesNotMatch(api, /api\.replicate\.com/);

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /python -m demucs/);
assert.match(workflow, /htdemucs/);
assert.match(workflow, /--mp3-bitrate 320/);
assert.match(workflow, /R2_ACCESS_KEY_ID/);
assert.match(workflow, /R2_SECRET_ACCESS_KEY/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow, /R2_BUCKET_NAME/);
assert.match(workflow, /vocals drums bass other/);

assert.match(player, /MVP_V6_STEM_OBJECT_AUDIO/);
assert.match(player, /ensureMusicStemBundle/);
assert.match(player, /createMvpStemObjectEngine/);
assert.match(player, /stemObjectRouteRequested/);
assert.match(player, /syncMvpStemObjectRoute/);

assert.match(ui, /OBJECT AUDIO/);
assert.match(ui, /PREPARING STEMS/);
assert.match(ui, /STEMS ACTIVE/);

console.log("V6.1 GitHub Demucs stem/object audio contract: PASS");
