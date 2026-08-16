import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "features", "music", "MusicMiniPlayer.tsx");
const MARKER = "MVP_STUDIO_V4_1_DSP_EQ_DESKTOP_ALIGNMENT";

function fail(message) {
  console.error(`MVP Studio V4.1 alignment installer stopped: ${message}`);
  console.error("Nothing was committed.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) fail("src/features/music/MusicMiniPlayer.tsx was not found. Run this from the repo root.");

const original = fs.readFileSync(FILE, "utf8");
if (original.includes(MARKER)) {
  console.log("MVP Studio V4.1 DSP/EQ alignment fix is already installed.");
  process.exit(0);
}

const phase4Anchor = 'WASM • BS.1770 TRUE PEAK';
const sourceAnchor = 'className={`tr-audioQueueSelector ${sourcePulse ? "is-changed" : ""}`}';
const dspAnchor = 'className={`tr-audioEqToggle tr-dspStatusToggle ${eqOpen ? "is-active" : ""}`}';

if (!original.includes(phase4Anchor)) fail("Phase 4/V4 Studio baseline marker was not found.");
if (!original.includes(sourceAnchor)) fail("Playing From selector anchor was not found.");
if (!original.includes(dspAnchor)) fail("DSP/EQ desktop button anchor was not found.");

const styleClose = "      `}</style>";
const count = original.split(styleClose).length - 1;
if (count !== 1) fail(`expected exactly one style closing anchor but found ${count}.`);

const nl = original.includes("\r\n") ? "\r\n" : "\n";

const css = [
  "",
  `        /* ${MARKER}`,
  "           Desktop only: hard-lock DSP/EQ to the exact geometry of the",
  "           All Uploaded Songs field. Mobile uses the separate mobile DSP button. */",
  "        @media(min-width:901px){",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{",
  "            align-items:end!important;",
  "          }",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector .tr-audioQueueSelectorField,",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{",
  "            box-sizing:border-box!important;",
  "            height:44px!important;",
  "            min-height:44px!important;",
  "            max-height:44px!important;",
  "          }",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{",
  "            align-self:end!important;",
  "            margin:0!important;",
  "          }",
  "        }",
].join(nl);

const updated = original.replace(styleClose, `${css}${nl}${styleClose}`);

const backup = `${FILE}.pre-studio-v4-1-dsp-eq-alignment.bak`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("MVP Studio V4.1 DSP/EQ desktop alignment applied successfully.");
console.log("(v4-1-dsp-eq-desktop-alignment-r1)");
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Desktop geometry: All Uploaded Songs = 44px; DSP/EQ = 44px; same bottom baseline.");
console.log("Mobile DSP layout: untouched.");
console.log("Backup: src/features/music/MusicMiniPlayer.tsx.pre-studio-v4-1-dsp-eq-alignment.bak");
console.log("NEXT: run npm run build");
