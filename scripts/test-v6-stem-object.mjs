import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const engine = read("src/lib/audio/mvpStemObjectEngine.ts");
const stems = read("src/lib/musicStems.ts");
const player = read("src/lib/musicPlayer.ts");
const ui = read("src/features/music/MusicMiniPlayer.tsx");
const api = read("functions/api/music-stems.js");

assert.match(engine, /panningModel = "HRTF"/);
assert.match(engine, /createChannelSplitter\(2\)/);
assert.match(engine, /vocals:[\s\S]*leftX:[\s\S]*rightX:/);
assert.match(engine, /bass:[\s\S]*leftX:[\s\S]*rightX:/);
assert.match(engine, /drums:[\s\S]*stage/);
assert.match(engine, /other:[\s\S]*stage/);
assert.match(engine, /mode === "arena"/);
assert.match(engine, /mode === "live"/);
assert.match(engine, /roomDelay/);
assert.match(engine, /Math\.abs\(delta\) > 0\.055/);

assert.match(stems, /ensureMusicStemBundle/);
assert.match(stems, /action: "probe"/);
assert.match(stems, /action: "start"/);
assert.match(stems, /action: "status"/);

assert.match(api, /REPLICATE_API_TOKEN/);
assert.match(api, /htdemucs/);
assert.match(api, /output_format: "mp3"/);
assert.match(api, /mp3_bitrate: 320/);
assert.match(api, /vocals/);
assert.match(api, /drums/);
assert.match(api, /bass/);
assert.match(api, /other/);
assert.match(api, /mvp-trainer-music-stream\.autodetail\.workers\.dev/);

assert.match(player, /MVP_V6_STEM_OBJECT_AUDIO/);
assert.match(player, /ensureMusicStemBundle/);
assert.match(player, /createMvpStemObjectEngine/);
assert.match(player, /stemObjectRouteRequested/);
assert.match(player, /broadcastSpatialEnabled: state\.broadcastSpatialEnabled && !stemObjectRouteRequested\(\)/);
assert.match(player, /studioDirectInputGain[\s\S]*linearRampToValueAtTime/);
assert.match(player, /syncMvpStemObjectRoute/);

assert.match(ui, /OBJECT AUDIO/);
assert.match(ui, /PREPARING STEMS/);
assert.match(ui, /STEMS ACTIVE/);

console.log("V6 stem/object audio contract: PASS");
