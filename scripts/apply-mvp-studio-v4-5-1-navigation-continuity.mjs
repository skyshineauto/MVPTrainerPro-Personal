import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "app", "routes.tsx");
const MARKER = "MVP_STUDIO_V4_5_1_NAVIGATION_CONTINUITY";
const BACKUP_SUFFIX = ".pre-studio-v4-5-1-navigation-continuity.bak";

function fail(message) {
  console.error(`MVP Studio V4.5.1 navigation installer stopped: ${message}`);
  console.error("Nothing was changed.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  fail("src/app/routes.tsx was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");

if (original.includes(MARKER)) {
  console.log("MVP Studio V4.5.1 Navigation Continuity is already installed.");
  process.exit(0);
}

const hardReloadPattern =
  /const\s+goTo\s*=\s*\(to:\s*string\)\s*=>\s*\{\s*window\.location\.pathname\s*=\s*to;\s*\};/m;

const matches = original.match(new RegExp(hardReloadPattern.source, "gm")) ?? [];
if (matches.length !== 1) {
  fail(`expected exactly one hard-reload goTo helper but found ${matches.length}.`);
}

const replacement = `/* ${MARKER}
 * Route wrappers must stay inside the existing React app instance.
 * A full location assignment destroys the singleton HTMLAudioElement / Web Audio graph.
 * pushState + popstate lets App.tsx update its existing route state without reloading.
 */
const goTo = (to: string) => {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
};`;

const updated = original.replace(hardReloadPattern, replacement);

if (updated === original) {
  fail("routes.tsx was not changed.");
}
if (updated.includes("window.location.pathname = to;")) {
  fail("hard-reload route assignment still exists after patch.");
}
if (!updated.includes(MARKER)) {
  fail("post-patch marker missing.");
}

const backup = `${FILE}${BACKUP_SUFFIX}`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("MVP Studio V4.5.1 Navigation Continuity applied successfully.");
console.log("(v4-5-1-navigation-continuity-r1)");
console.log("Updated: src/app/routes.tsx");
console.log("Removed: route-wrapper full page reload navigation.");
console.log("Added: in-app pushState/popstate navigation.");
console.log("Music/Web Audio instance now survives route changes handled by these wrappers.");
console.log(`Backup: src/app/routes.tsx${BACKUP_SUFFIX}`);
console.log("NEXT: run npm run build");
