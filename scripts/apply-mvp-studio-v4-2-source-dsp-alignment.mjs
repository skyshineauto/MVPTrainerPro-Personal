import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "features", "music", "MusicMiniPlayer.tsx");
const MARKER = "MVP_STUDIO_V4_2_SOURCE_DSP_EXACT_ALIGNMENT";

function fail(message) {
  console.error(`MVP Studio V4.2 alignment installer stopped: ${message}`);
  console.error("Nothing was committed.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  fail("src/features/music/MusicMiniPlayer.tsx was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");

if (original.includes(MARKER)) {
  console.log("MVP Studio V4.2 source/DSP exact alignment is already installed.");
  process.exit(0);
}

const required = [
  "tr-playerSourceTools",
  "tr-audioQueueSelectorField",
  "tr-dspStatusToggle",
  "PLAYING FROM",
];

for (const anchor of required) {
  if (!original.includes(anchor)) {
    fail(`required baseline anchor was not found: ${anchor}`);
  }
}

const styleClose = "      `}</style>";
const closeCount = original.split(styleClose).length - 1;
if (closeCount !== 1) {
  fail(`expected exactly one style closing anchor but found ${closeCount}.`);
}

const nl = original.includes("\r\n") ? "\r\n" : "\n";

const css = [
  "",
  `        /* ${MARKER}`,
  "           Root-cause fix: an older broad >span rule gives the visible",
  "           Playing From field a 5px bottom margin. That margin makes the",
  "           field look 5px higher than DSP/EQ even when the grid items align.",
  "           Keep spacing on the PLAYING FROM label, but remove it from the field. */",
  "        @media(min-width:901px){",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{",
  "            align-items:end!important;",
  "          }",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector > span:first-child{",
  "            margin:0 0 5px 2px!important;",
  "          }",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector > .tr-audioQueueSelectorField{",
  "            margin:0!important;",
  "            box-sizing:border-box!important;",
  "            height:44px!important;",
  "            min-height:44px!important;",
  "            max-height:44px!important;",
  "          }",
  "          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{",
  "            position:relative!important;",
  "            top:0!important;",
  "            margin:0!important;",
  "            align-self:end!important;",
  "            box-sizing:border-box!important;",
  "            height:44px!important;",
  "            min-height:44px!important;",
  "            max-height:44px!important;",
  "          }",
  "        }",
].join(nl);

const updated = original.replace(styleClose, `${css}${nl}${styleClose}`);

const backup = `${FILE}.pre-studio-v4-2-source-dsp-alignment.bak`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("MVP Studio V4.2 source/DSP exact alignment applied successfully.");
console.log("(v4-2-source-dsp-exact-alignment-r1)");
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Root cause fixed: removed the 5px bottom margin from the visible Playing From field.");
console.log("Desktop: All Uploaded Songs and DSP/EQ now share the same 44px visible top/bottom edges.");
console.log("Mobile: untouched.");
console.log("Backup: src/features/music/MusicMiniPlayer.tsx.pre-studio-v4-2-source-dsp-alignment.bak");
console.log("NEXT: run npm run build");
