#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TARGET = path.join("src", "features", "music", "MusicMiniPlayer.tsx");
const NEW_MARKER = "MVP TRAINER V5 R9.0.3 - DESKTOP DSP OUTPUT-FIRST COMPACT WORKSPACE ONLY";
const REQUIRED_MARKER = "MVP TRAINER V5 R9.0.2 - DESKTOP DSP CONTROL CENTER GEOMETRY ONLY";
const INSERT_BEFORE = "        @keyframes trDspLauncherPulse";
const OLD_SAVE = `  useEffect(() => {
    try { window.localStorage.setItem("mvp_music_dsp_control_tab_v1", dspTab); } catch { /* optional */ }
  }, [dspTab]);`;
const NEW_SAVE = `  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches) return;
    try { window.localStorage.setItem("mvp_music_dsp_control_tab_v1", dspTab); } catch { /* optional */ }
  }, [dspTab]);`;
const OLD_OPEN = `          onClick={() => setEqOpen((current) => !current)}`;
const NEW_OPEN = `          onClick={() => {
            if (!eqOpen && typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches) {
              setDspTab("output");
            }
            setEqOpen((current) => !current);
          }}`;
const CSS_BLOCK = Buffer.from("ICAgICAgICAvKiBNVlAgVFJBSU5FUiBWNSBSOS4wLjMgLSBERVNLVE9QIERTUCBPVVRQVVQtRklSU1QgQ09NUEFDVCBXT1JLU1BBQ0UgT05MWQogICAgICAgICAgIERlc2t0b3Agb25seTogT3V0cHV0IGlzIHRoZSBmaXJzdC9kZWZhdWx0IHdvcmtzcGFjZSwgcHJvZmlsZSBzd2l0Y2hpbmcgaXMgaW1tZWRpYXRlLAogICAgICAgICAgIGFuZCBzaG9ydCB0YWJzIHNocmluayB0byB0aGVpciBjb250ZW50IGluc3RlYWQgb2YgbGVhdmluZyBhIGZ1bGwtaGVpZ2h0IGVtcHR5IGRyYXdlci4gKi8KICAgICAgICBAbWVkaWEobWluLXdpZHRoOjc2MXB4KXsKICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyQmFja3sKICAgICAgICAgICAgYWxpZ24taXRlbXM6ZmxleC1zdGFydCFpbXBvcnRhbnQ7CiAgICAgICAgICB9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlci50ci1hdWRpb0VxUGFuZWwtLXBybzd7CiAgICAgICAgICAgIGhlaWdodDphdXRvIWltcG9ydGFudDsKICAgICAgICAgICAgbWluLWhlaWdodDowIWltcG9ydGFudDsKICAgICAgICAgICAgbWF4LWhlaWdodDpjYWxjKDEwMGR2aCAtIDI0cHgpIWltcG9ydGFudDsKICAgICAgICAgICAgYWxpZ24tc2VsZjpmbGV4LXN0YXJ0IWltcG9ydGFudDsKICAgICAgICAgICAgb3ZlcmZsb3cteTphdXRvIWltcG9ydGFudDsKICAgICAgICAgIH0KCiAgICAgICAgICAvKiBEZXNrdG9wIHRhYiBvcmRlcjogT1VUUFVUIGZpcnN0LiBET00vbW9iaWxlIG9yZGVyIGlzIGludGVudGlvbmFsbHkgdW5jaGFuZ2VkLiAqLwogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXIgLnRyLWRzcFRhYnMgYnV0dG9uOm50aC1jaGlsZCg0KXtvcmRlcjoxIWltcG9ydGFudH0KICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyIC50ci1kc3BUYWJzIGJ1dHRvbjpudGgtY2hpbGQoMSl7b3JkZXI6MiFpbXBvcnRhbnR9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlciAudHItZHNwVGFicyBidXR0b246bnRoLWNoaWxkKDIpe29yZGVyOjMhaW1wb3J0YW50fQogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXIgLnRyLWRzcFRhYnMgYnV0dG9uOm50aC1jaGlsZCgzKXtvcmRlcjo0IWltcG9ydGFudH0KCiAgICAgICAgICAvKiBPVVRQVVQ6IGRldmljZSBzd2l0Y2hpbmcgaXMgdGhlIGZpcnN0IGNvbnRyb2wgYW5kIGdldHMgZnVsbC1zaXplIHRhcmdldHMuICovCiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZVBhbmVsewogICAgICAgICAgICBkaXNwbGF5OmZsZXghaW1wb3J0YW50OwogICAgICAgICAgICBmbGV4LWRpcmVjdGlvbjpjb2x1bW4haW1wb3J0YW50OwogICAgICAgICAgICBnYXA6OHB4IWltcG9ydGFudDsKICAgICAgICAgICAgbWFyZ2luOjJweCAwIDlweCFpbXBvcnRhbnQ7CiAgICAgICAgICAgIHBhZGRpbmc6MTJweCFpbXBvcnRhbnQ7CiAgICAgICAgICB9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZUNob2ljZXN7CiAgICAgICAgICAgIG9yZGVyOi0zIWltcG9ydGFudDsKICAgICAgICAgICAgd2lkdGg6MTAwJSFpbXBvcnRhbnQ7CiAgICAgICAgICAgIGRpc3BsYXk6Z3JpZCFpbXBvcnRhbnQ7CiAgICAgICAgICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNCxtaW5tYXgoMCwxZnIpKSFpbXBvcnRhbnQ7CiAgICAgICAgICAgIGdhcDo4cHghaW1wb3J0YW50OwogICAgICAgICAgfQogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXJbZGF0YS1tb2JpbGUtZHNwLXRhYj0ib3V0cHV0Il0gLnRyLW91dHB1dFByb2ZpbGVDaG9pY2VzOmJlZm9yZXsKICAgICAgICAgICAgY29udGVudDoiT1VUUFVUIFBST0ZJTEUiOwogICAgICAgICAgICBncmlkLWNvbHVtbjoxLy0xOwogICAgICAgICAgICBkaXNwbGF5OmJsb2NrOwogICAgICAgICAgICBtYXJnaW46MCAwIDFweDsKICAgICAgICAgICAgY29sb3I6IzYyZGNmYTsKICAgICAgICAgICAgZm9udC1zaXplOjhweDsKICAgICAgICAgICAgZm9udC13ZWlnaHQ6MTAwMDsKICAgICAgICAgICAgbGV0dGVyLXNwYWNpbmc6LjEyZW07CiAgICAgICAgICB9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZUNob2ljZXMgYnV0dG9uewogICAgICAgICAgICBtaW4taGVpZ2h0OjU4cHghaW1wb3J0YW50OwogICAgICAgICAgICBwYWRkaW5nOjhweCA3cHghaW1wb3J0YW50OwogICAgICAgICAgICBib3JkZXItcmFkaXVzOjEwcHghaW1wb3J0YW50OwogICAgICAgICAgICBmb250LXNpemU6OHB4IWltcG9ydGFudDsKICAgICAgICAgIH0KICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9Im91dHB1dCJdIC50ci1vdXRwdXRQcm9maWxlQ2hvaWNlcyBidXR0b24uaXMtYWN0aXZlewogICAgICAgICAgICBib3JkZXItY29sb3I6cmdiYSg3NiwyMTksMjU1LC44MikhaW1wb3J0YW50OwogICAgICAgICAgICBib3gtc2hhZG93OjAgMCAxOHB4IHJnYmEoNTAsMjA4LDI0OCwuMTgpLGluc2V0IDAgMXB4IHJnYmEoMjU1LDI1NSwyNTUsLjEwKSFpbXBvcnRhbnQ7CiAgICAgICAgICB9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZVNlbGVjdHtkaXNwbGF5Om5vbmUhaW1wb3J0YW50fQogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXJbZGF0YS1tb2JpbGUtZHNwLXRhYj0ib3V0cHV0Il0gLnRyLW91dHB1dFByb2ZpbGVJbnRyb3sKICAgICAgICAgICAgb3JkZXI6LTIhaW1wb3J0YW50OwogICAgICAgICAgICBtaW4td2lkdGg6MCFpbXBvcnRhbnQ7CiAgICAgICAgICAgIHBhZGRpbmctdG9wOjJweCFpbXBvcnRhbnQ7CiAgICAgICAgICB9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZUludHJvPnNtYWxse2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnR9CiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItb3V0cHV0UHJvZmlsZVRpdGxle21hcmdpbjowIWltcG9ydGFudH0KICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9Im91dHB1dCJdIC50ci1vdXRwdXRQcm9maWxlVGl0bGVUZXh0e2ZvbnQtc2l6ZToxNHB4IWltcG9ydGFudH0KICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9Im91dHB1dCJdIC50ci1vdXRwdXRQcm9maWxlSW50cm8gcHsKICAgICAgICAgICAgbWFyZ2luOjRweCAwIDAhaW1wb3J0YW50OwogICAgICAgICAgICBtYXgtd2lkdGg6bm9uZSFpbXBvcnRhbnQ7CiAgICAgICAgICAgIGZvbnQtc2l6ZTo4cHghaW1wb3J0YW50OwogICAgICAgICAgICBsaW5lLWhlaWdodDoxLjQhaW1wb3J0YW50OwogICAgICAgICAgfQogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXJbZGF0YS1tb2JpbGUtZHNwLXRhYj0ib3V0cHV0Il0gLnRyLW91dHB1dFByb2ZpbGVUZWxlbWV0cnl7CiAgICAgICAgICAgIG9yZGVyOi0xIWltcG9ydGFudDsKICAgICAgICAgICAgbWFyZ2luLXRvcDowIWltcG9ydGFudDsKICAgICAgICAgIH0KCiAgICAgICAgICAvKiBTaG9ydCBkZXNrdG9wIHRhYnMgc2hvdWxkIGVuZCB3aGVyZSB0aGVpciBjb250ZW50IGVuZHMuICovCiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJpbW1lcnNpb24iXSAudHItaGVhZHBob25lUHJvY2Vzc29yLAogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXJbZGF0YS1tb2JpbGUtZHNwLXRhYj0iZHluYW1pY3MiXSAudHItc3R1ZGlvTWV0ZXJQYW5lbCwKICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9ImR5bmFtaWNzIl0gLnRyLXN0dWRpb1Byb2Nlc3NpbmdQYW5lbCwKICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9Im91dHB1dCJdIC50ci1vdXRwdXRQcm9maWxlUGFuZWwsCiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItc291cmNlUXVhbGl0eVBhbmVsLAogICAgICAgICAgLnRyLWRzcENvbnRyb2xDZW50ZXJbZGF0YS1tb2JpbGUtZHNwLXRhYj0ib3V0cHV0Il0gLnRyLXByZWFtcFRyaW0sCiAgICAgICAgICAudHItZHNwQ29udHJvbENlbnRlcltkYXRhLW1vYmlsZS1kc3AtdGFiPSJvdXRwdXQiXSAudHItaW50ZWxsaWdlbnRUcmFuc2l0aW9ucywKICAgICAgICAgIC50ci1kc3BDb250cm9sQ2VudGVyW2RhdGEtbW9iaWxlLWRzcC10YWI9Im91dHB1dCJdIC50ci1kc3BFbmdpbmVQYW5lbHsKICAgICAgICAgICAgZmxleDpub25lIWltcG9ydGFudDsKICAgICAgICAgIH0KICAgICAgICB9Cg==", "base64").toString("utf8");

function findRepoRoot() {
  const cwd = process.cwd();
  const candidates = [cwd, path.dirname(cwd), path.resolve(cwd, "..", "..")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, TARGET))) return candidate;
  }
  throw new Error(`Could not find ${TARGET} from ${cwd}. Run this from the project root or its scripts folder.`);
}

function atomicWrite(file, content) {
  const tmp = `${file}.r9-0-3.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

try {
  const root = findRepoRoot();
  const file = path.join(root, TARGET);
  const source = fs.readFileSync(file, "utf8");

  if (source.includes(NEW_MARKER)) {
    console.log("MVP Trainer V5 R9.0.3 desktop DSP output-first compact layout is already installed. No changes needed.");
    process.exit(0);
  }
  if (!source.includes(REQUIRED_MARKER)) {
    throw new Error("Refusing to patch because the R9.0.2 desktop DSP layout marker was not found. No files were changed.");
  }
  if (!source.includes(OLD_SAVE)) {
    throw new Error("Refusing to patch because the expected DSP tab persistence block was not found. No files were changed.");
  }
  if (!source.includes(OLD_OPEN)) {
    throw new Error("Refusing to patch because the expected DSP launcher handler was not found. No files were changed.");
  }
  const insertIndex = source.indexOf(INSERT_BEFORE);
  if (insertIndex < 0) {
    throw new Error("Refusing to patch because the expected R9 DSP animation marker was not found. No files were changed.");
  }

  let next = source.replace(OLD_SAVE, NEW_SAVE).replace(OLD_OPEN, NEW_OPEN);
  const cssIndex = next.indexOf(INSERT_BEFORE);
  next = next.slice(0, cssIndex) + CSS_BLOCK + next.slice(cssIndex);

  if (!next.includes(NEW_MARKER)) throw new Error("Internal verification failed before write.");
  if (!next.includes('setDspTab("output")')) throw new Error("Desktop Output default verification failed before write.");
  if (!next.includes('window.matchMedia("(max-width: 760px)").matches')) throw new Error("Mobile tab persistence protection verification failed before write.");

  const backup = `${file}.pre-r9-0-3.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  atomicWrite(file, next);

  const verify = fs.readFileSync(file, "utf8");
  if (!verify.includes(NEW_MARKER) || !verify.includes('setDspTab("output")')) {
    fs.copyFileSync(backup, file);
    throw new Error("Post-write verification failed. The original file was restored.");
  }

  console.log("MVP Trainer V5 R9.0.3 desktop DSP layout applied successfully.");
  console.log(`Updated: ${TARGET}`);
  console.log(`Backup:  ${path.relative(root, backup)}`);
  console.log("Scope: desktop DSP drawer only. Output opens first, output switching is promoted, and empty drawer height is removed.");
  console.log("Mobile layout and audio behavior were not changed.");
  console.log("Next: run npm run build from the project root.");
} catch (error) {
  console.error("\nR9.0.3 installer stopped:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
