import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const repo = path.basename(cwd).toLowerCase() === 'scripts' ? path.dirname(cwd) : cwd;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.mvp-backups' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /TodayPage\.tsx$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const preferred = [
  path.join(repo, 'src/features/today/TodayPage.tsx'),
  path.join(repo, 'src/features/workout/TodayPage.tsx'),
];

let target = preferred.find((p) => fs.existsSync(p));
if (!target) {
  target = walk(path.join(repo, 'src')).find((p) => {
    const text = fs.readFileSync(p, 'utf8');
    return text.includes('export function TodayPage') && text.includes('UPCOMING TRAINING') && text.includes('Coming Up');
  });
}

if (!target) {
  console.error('ERROR: Could not find the Training TodayPage.tsx. No files changed.');
  process.exit(1);
}

const before = fs.readFileSync(target, 'utf8');
let after = before;

// Remove the visible readiness-copy render if present, including common conditional wrappers.
after = after.replace(/\{!activeSessionId\s*\?\s*<p\s+className=["']trp-readinessCopy["']>\{primaryReadiness\.detail\}<\/p>\s*:\s*null\}/g, '');
after = after.replace(/<p\s+className=["']trp-readinessCopy["']>\{primaryReadiness\.detail\}<\/p>/g, '');

// Remove a literal copy render if an older version hard-coded the sentence.
after = after.replace(/\s*<p(?:\s+className=["'][^"']*["'])?>\s*No recent recovery flag is blocking this workout\.\s*<\/p>/g, '');

// The detail value can remain internally, but remove the exact sentence too so it cannot leak from another direct render.
after = after.replace('detail: "No recent recovery flag is blocking this workout."', 'detail: ""');
after = after.replace("detail: 'No recent recovery flag is blocking this workout.'", "detail: ''");

if (after === before) {
  console.log(`No visible recovery sentence found in ${path.relative(repo, target)}.`);
  console.log('The source is already clean. If the website still shows the sentence, the deployed build is older than your local source.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(repo, '.mvp-backups', `r9-4-2-next-workout-text-${stamp}`);
const rel = path.relative(repo, target);
const backup = path.join(backupDir, rel);
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(target, backup);
fs.writeFileSync(target, after, 'utf8');

const verify = fs.readFileSync(target, 'utf8');
if (verify.includes('No recent recovery flag is blocking this workout.') || /trp-readinessCopy["']>\{primaryReadiness\.detail\}/.test(verify)) {
  console.error('ERROR: Verification failed. Restoring backup.');
  fs.copyFileSync(backup, target);
  process.exit(1);
}

console.log(`OK  ${rel}`);
console.log(`Backup: ${path.relative(repo, backupDir)}`);
console.log('R9.4.2 fix complete.');
console.log('Next: run npm run build from the repo root.');
