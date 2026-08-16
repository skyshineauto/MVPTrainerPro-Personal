import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "features", "music", "MusicMiniPlayer.tsx");
const MARKER = "MVP_STUDIO_V4_4_MOBILE_DSP_WORKSPACE";
const REVISION = "v4-4-mobile-dsp-workspace-r1";
const BACKUP_SUFFIX = ".pre-studio-v4-4-mobile-dsp-workspace.bak";

function fail(message) {
  console.error(`MVP Studio V4.4 mobile workspace installer stopped: ${message}`);
  console.error("Nothing was committed.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  fail("src/features/music/MusicMiniPlayer.tsx was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");

if (original.includes(MARKER)) {
  console.log("MVP Studio V4.4 Mobile DSP Workspace is already installed.");
  process.exit(0);
}

const requiredAnchors = [
  'const [eqOpen, setEqOpen] = useState(false);',
  '<section className="tr-audioEqPanel tr-audioEqPanel--pro7">',
  '<div className="tr-outputProfilePanel">',
  '<section className={`tr-sourceQualityPanel is-${sourceQuality.tier}`} aria-label="Source quality">',
  '<section className="tr-preampTrim" aria-label="Preamp trim">',
  '<section className="tr-dspProofPanel tr-dspEnginePanel" aria-label="DSP engine status">',
  '<section className="tr-studioMeterPanel" aria-label="Live Studio DSP metering">',
  '<section className="tr-studioProcessingPanel" aria-label="Studio dynamics processing">',
  '<div className="tr-audioEqHead">',
  '<div className="tr-eqArchitecturePanel">',
  '<div className="tr-audioEqScroll" aria-label="31 band user offset equalizer">',
  '<div className="tr-audioEqFooter tr-audioEqFooter--pro7">',
  '<div className="tr-dspProfileSave">',
  '<section className={`tr-headphoneProcessor ${player.outputProfile !== "headphones" ? "is-disabled" : ""}`}>',
  '/* MVP_STUDIO_V4_MASTERING_REFINEMENT',
  '/* MVP_STUDIO_V4_2_SOURCE_DSP_EXACT_ALIGNMENT',
];

for (const anchor of requiredAnchors) {
  const count = original.split(anchor).length - 1;
  if (count !== 1) fail(`required anchor expected once but matched ${count}: ${anchor}`);
}

const styleClose = "      `}</style>";
const closeCount = original.split(styleClose).length - 1;
if (closeCount !== 1) fail(`expected one style closing anchor but found ${closeCount}.`);

const nl = original.includes("\r\n") ? "\r\n" : "\n";
let updated = original;

// 1) Mobile workspace state.
updated = updated.replace(
  'const [eqOpen, setEqOpen] = useState(false);',
  [
    'const [eqOpen, setEqOpen] = useState(false);',
    '  const [mobileDspTab, setMobileDspTab] = useState<"overview" | "eq" | "processing" | "meters">("overview");',
  ].join(nl)
);

// 2) Mobile workspace header + tab bar.
const panelOpen = '<section className="tr-audioEqPanel tr-audioEqPanel--pro7">';
const workspaceHeader = [
  '<section className="tr-audioEqPanel tr-audioEqPanel--pro7" data-mobile-dsp-tab={mobileDspTab}>',
  '          <div className="tr-mobileDspWorkspace" aria-label="Mobile Studio DSP workspace">',
  '            <div className="tr-mobileDspContext" aria-label="Current Studio DSP context">',
  '              <span className={`tr-mobileDspContextEngine is-${player.dspEngineMode}`}><i aria-hidden />{player.dspEngineMode === "studio_wasm" ? "STUDIO WASM" : player.dspEngineMode === "advanced_worklet" ? "WORKLET" : player.dspEngineMode === "native_fallback" ? "NATIVE" : "DSP"}</span>',
  '              <span>{dspOutputStatus}</span>',
  '              <span>{dspEqStatus}</span>',
  '              <span>{player.eqTopology === "linear_phase" ? "LINEAR" : "MIN PHASE"}</span>',
  '            </div>',
  '            <nav className="tr-mobileDspTabs" role="tablist" aria-label="DSP workspace sections">',
  '              <button type="button" role="tab" aria-selected={mobileDspTab === "overview"} className={mobileDspTab === "overview" ? "is-active" : ""} onClick={() => setMobileDspTab("overview")}><svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg><span>OVERVIEW</span></button>',
  '              <button type="button" role="tab" aria-selected={mobileDspTab === "eq"} className={mobileDspTab === "eq" ? "is-active" : ""} onClick={() => setMobileDspTab("eq")}><svg viewBox="0 0 24 24" aria-hidden><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 15h6M16 10h6" /></svg><span>EQ</span></button>',
  '              <button type="button" role="tab" aria-selected={mobileDspTab === "processing"} className={mobileDspTab === "processing" ? "is-active" : ""} onClick={() => setMobileDspTab("processing")}><svg viewBox="0 0 24 24" aria-hidden><path d="M2 12h3l2.2-6 3.4 12 2.8-9 2.7 7 2-4H22" /></svg><span>PROCESS</span></button>',
  '              <button type="button" role="tab" aria-selected={mobileDspTab === "meters"} className={mobileDspTab === "meters" ? "is-active" : ""} onClick={() => setMobileDspTab("meters")}><svg viewBox="0 0 24 24" aria-hidden><path d="M4 20V11h3v9H4Zm6 0V5h3v15h-3Zm6 0V8h3v12h-3Z" /></svg><span>METERS</span></button>',
  '            </nav>',
  '          </div>',
].join(nl);

updated = updated.replace(panelOpen, workspaceHeader);

// 3) Assign every existing top-level DSP block to one mobile tab.
// Desktop ignores these data attributes.
const replacements = [
  ['<div className="tr-outputProfilePanel">', '<div className="tr-outputProfilePanel" data-mobile-dsp-section="overview">'],
  ['<section className={`tr-sourceQualityPanel is-${sourceQuality.tier}`} aria-label="Source quality">', '<section className={`tr-sourceQualityPanel is-${sourceQuality.tier}`} aria-label="Source quality" data-mobile-dsp-section="overview">'],
  ['<section className="tr-preampTrim" aria-label="Preamp trim">', '<section className="tr-preampTrim" aria-label="Preamp trim" data-mobile-dsp-section="overview">'],
  ['<section className="tr-dspProofPanel tr-dspEnginePanel" aria-label="DSP engine status">', '<section className="tr-dspProofPanel tr-dspEnginePanel" aria-label="DSP engine status" data-mobile-dsp-section="overview">'],
  ['<section className="tr-studioMeterPanel" aria-label="Live Studio DSP metering">', '<section className="tr-studioMeterPanel" aria-label="Live Studio DSP metering" data-mobile-dsp-section="meters">'],
  ['<section className="tr-studioProcessingPanel" aria-label="Studio dynamics processing">', '<section className="tr-studioProcessingPanel" aria-label="Studio dynamics processing" data-mobile-dsp-section="processing">'],
  ['<div className="tr-audioEqHead">', '<div className="tr-audioEqHead" data-mobile-dsp-section="eq">'],
  ['<div className="tr-eqArchitecturePanel">', '<div className="tr-eqArchitecturePanel" data-mobile-dsp-section="eq">'],
  ['<div className="tr-audioEqScroll" aria-label="31 band user offset equalizer">', '<div className="tr-audioEqScroll" aria-label="31 band user offset equalizer" data-mobile-dsp-section="eq">'],
  ['<div className="tr-audioEqFooter tr-audioEqFooter--pro7">', '<div className="tr-audioEqFooter tr-audioEqFooter--pro7" data-mobile-dsp-section="eq">'],
  ['<div className="tr-dspProfileSave">', '<div className="tr-dspProfileSave" data-mobile-dsp-section="eq">'],
  ['<section className={`tr-headphoneProcessor ${player.outputProfile !== "headphones" ? "is-disabled" : ""}`}>', '<section className={`tr-headphoneProcessor ${player.outputProfile !== "headphones" ? "is-disabled" : ""}`} data-mobile-dsp-section="processing">'],
];

for (const [from, to] of replacements) {
  const count = updated.split(from).length - 1;
  if (count !== 1) fail(`section anchor expected once but matched ${count}: ${from}`);
  updated = updated.replace(from, to);
}

// 4) High-end responsive workspace CSS.
// The selected tab keeps each component's ORIGINAL authored display mode.
// Only non-selected direct children are hidden.
const css = [
  '',
  `        /* ${MARKER} — high-end mobile tabbed Studio workspace */`,
  '        .tr-mobileDspWorkspace{display:none}',
  '        @media(max-width:700px){',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="overview"]),',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="eq"]),',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="processing"]),',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="meters"]){',
  '            display:none!important;',
  '          }',
  '          .tr-audioEqPanel--pro7 > [data-mobile-dsp-section]{',
  '            animation:trMobileDspPaneIn .18s cubic-bezier(.2,.8,.2,1) both;',
  '          }',
  '          @keyframes trMobileDspPaneIn{from{opacity:.45;transform:translateY(4px)}to{opacity:1;transform:none}}',
  '',
  '          .tr-mobileDspWorkspace{',
  '            display:block!important;',
  '            position:sticky;',
  '            top:6px;',
  '            z-index:45;',
  '            margin:0 0 12px;',
  '            padding:8px;',
  '            border:1px solid rgba(120,205,229,.20);',
  '            border-radius:15px;',
  '            background:linear-gradient(180deg,rgba(8,24,32,.96),rgba(3,12,17,.97));',
  '            box-shadow:0 12px 30px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.045);',
  '            -webkit-backdrop-filter:blur(18px) saturate(135%);',
  '            backdrop-filter:blur(18px) saturate(135%);',
  '          }',
  '          .tr-mobileDspContext{',
  '            min-width:0;',
  '            display:flex;',
  '            align-items:center;',
  '            gap:7px;',
  '            padding:2px 4px 8px;',
  '            overflow:hidden;',
  '            white-space:nowrap;',
  '          }',
  '          .tr-mobileDspContext>span{',
  '            min-width:0;',
  '            max-width:32%;',
  '            overflow:hidden;',
  '            text-overflow:ellipsis;',
  '            color:#9ab3bd;',
  '            font-size:8px;',
  '            line-height:1;',
  '            font-weight:950;',
  '            letter-spacing:.055em;',
  '            text-transform:uppercase;',
  '          }',
  '          .tr-mobileDspContext>span+span:before{content:"•";margin-right:7px;color:#41606c}',
  '          .tr-mobileDspContext .tr-mobileDspContextEngine{',
  '            flex:0 0 auto;',
  '            max-width:none;',
  '            color:#f2f7f9;',
  '          }',
  '          .tr-mobileDspContextEngine>i{',
  '            display:inline-block;',
  '            width:5px;',
  '            height:5px;',
  '            margin-right:6px;',
  '            border-radius:50%;',
  '            vertical-align:1px;',
  '            background:#d7e2e6;',
  '            box-shadow:0 0 8px rgba(230,241,245,.28);',
  '          }',
  '          .tr-mobileDspContextEngine.is-advanced_worklet>i{background:#ffb545;box-shadow:0 0 8px rgba(255,181,69,.35)}',
  '          .tr-mobileDspContextEngine.is-native_fallback>i,.tr-mobileDspContextEngine.is-unavailable>i{background:#ff675f;box-shadow:0 0 8px rgba(255,103,95,.35)}',
  '',
  '          .tr-mobileDspTabs{',
  '            display:grid;',
  '            grid-template-columns:repeat(4,minmax(0,1fr));',
  '            gap:5px;',
  '            padding:4px;',
  '            border:1px solid rgba(117,186,208,.12);',
  '            border-radius:12px;',
  '            background:rgba(0,5,8,.58);',
  '          }',
  '          .tr-mobileDspTabs button{',
  '            min-width:0;',
  '            height:47px;',
  '            padding:5px 2px 4px;',
  '            display:flex;',
  '            flex-direction:column;',
  '            align-items:center;',
  '            justify-content:center;',
  '            gap:4px;',
  '            border:1px solid transparent;',
  '            border-radius:9px;',
  '            background:transparent;',
  '            color:#718d98;',
  '            box-shadow:none;',
  '          }',
  '          .tr-mobileDspTabs button svg{',
  '            width:16px;',
  '            height:16px;',
  '            fill:none;',
  '            stroke:currentColor;',
  '            stroke-width:1.8;',
  '            stroke-linecap:round;',
  '            stroke-linejoin:round;',
  '          }',
  '          .tr-mobileDspTabs button span{',
  '            font-size:7.4px;',
  '            line-height:1;',
  '            font-weight:1000;',
  '            letter-spacing:.075em;',
  '          }',
  '          .tr-mobileDspTabs button.is-active{',
  '            border-color:rgba(72,202,239,.34);',
  '            background:linear-gradient(180deg,rgba(11,55,70,.88),rgba(5,28,38,.95));',
  '            color:#eaf9fd;',
  '            box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 0 18px rgba(36,190,229,.07);',
  '          }',
  '          .tr-mobileDspTabs button.is-active svg{color:#51d8f5}',
  '',
  '          /* OVERVIEW: remove redundant vertical bulk while keeping the important controls. */',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfilePanel{',
  '            padding:12px!important;',
  '            gap:10px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileIntro p{display:none!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileSelect{display:none!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileTelemetry{display:none!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices{grid-template-columns:repeat(4,minmax(0,1fr))!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices button{min-height:44px!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-sourceQualityPanel,',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-preampTrim,',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-dspEnginePanel{margin-top:9px!important;margin-bottom:0!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-sourceQualityCopy small,',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-preampTrimCopy small{font-size:8px!important;line-height:1.35!important}',
  '',
  '          /* PROCESSING: compact module cards. Headphone controls only appear when relevant. */',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-studioProcessingPanel{',
  '            margin:0!important;',
  '            gap:8px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-studioProcessingPanel button{',
  '            min-height:66px!important;',
  '            padding:10px 11px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-headphoneProcessor{margin:9px 0 0!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-headphoneProcessor.is-disabled{display:none!important}',
  '',
  '          /* METERS: dense real telemetry, two columns even on small phones. */',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterPanel{',
  '            margin:0!important;',
  '            padding:10px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterPanel>header{',
  '            display:flex!important;',
  '            flex-direction:row!important;',
  '            align-items:flex-end!important;',
  '            gap:8px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid{',
  '            grid-template-columns:repeat(2,minmax(0,1fr))!important;',
  '            gap:7px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article{padding:9px!important}',
  '',
  '          /* EQ: dedicated tuning workspace. */',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqHead{',
  '            margin-top:0!important;',
  '            padding-top:0!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqScroll{',
  '            margin-top:10px!important;',
  '            padding-bottom:4px!important;',
  '            overscroll-behavior-x:contain;',
  '            -webkit-overflow-scrolling:touch;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqBand{',
  '            min-width:50px!important;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqBand input[type="range"]{',
  '            touch-action:none;',
  '          }',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-dspProfileSave{margin-bottom:0!important}',
  '',
  '          /* Tabs remove the need for giant vertical spacing between every Studio system. */',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab] > [data-mobile-dsp-section]{',
  '            scroll-margin-top:112px;',
  '          }',
  '        }',
  '',
  '        @media(max-width:430px){',
  '          .tr-mobileDspWorkspace{margin-left:-2px;margin-right:-2px;padding:7px;border-radius:13px}',
  '          .tr-mobileDspContext{gap:5px;padding-left:2px;padding-right:2px}',
  '          .tr-mobileDspContext>span{font-size:7.3px;letter-spacing:.035em}',
  '          .tr-mobileDspContext>span+span:before{margin-right:5px}',
  '          .tr-mobileDspTabs{gap:4px;padding:3px}',
  '          .tr-mobileDspTabs button{height:45px;border-radius:8px}',
  '          .tr-mobileDspTabs button svg{width:15px;height:15px}',
  '          .tr-mobileDspTabs button span{font-size:6.8px;letter-spacing:.045em}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices{grid-template-columns:repeat(2,minmax(0,1fr))!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article>strong{font-size:11px!important}',
  '          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article>small{font-size:6.1px!important}',
  '        }',
].join(nl);

updated = updated.replace(styleClose, `${css}${nl}${styleClose}`);

// Final structural sanity checks before writing.
const expectedMarkers = [
  'data-mobile-dsp-tab={mobileDspTab}',
  'className="tr-mobileDspTabs"',
  'data-mobile-dsp-section="overview"',
  'data-mobile-dsp-section="eq"',
  'data-mobile-dsp-section="processing"',
  'data-mobile-dsp-section="meters"',
  MARKER,
];
for (const marker of expectedMarkers) {
  if (!updated.includes(marker)) fail(`post-patch validation failed: ${marker}`);
}

const backup = `${FILE}${BACKUP_SUFFIX}`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("MVP Studio V4.4 Mobile DSP Workspace applied successfully.");
console.log(`(${REVISION})`);
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Mobile workspace: OVERVIEW / EQ / PROCESS / METERS");
console.log("Desktop DSP layout: preserved.");
console.log("Mobile: sticky Studio context + segmented tab navigation.");
console.log("Overview: output / source / gain / engine.");
console.log("EQ: preset / topology / 31-band EQ / save.");
console.log("Processing: Multiband / Dynamic EQ / Volume Match / Headphone Immersion.");
console.log("Meters: live WASM engine telemetry only.");
console.log(`Backup: src/features/music/MusicMiniPlayer.tsx${BACKUP_SUFFIX}`);
console.log("NEXT: run npm run build");
