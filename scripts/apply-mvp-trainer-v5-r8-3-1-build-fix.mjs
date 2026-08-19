import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const TARGET = path.join(ROOT, 'src', 'features', 'music', 'MusicMiniPlayer.tsx');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPLACEMENT = path.resolve(scriptDir, '..', 'replacement', 'MusicMiniPlayer.tsx');
const EXPECTED_BASE_SHA = '85e18766a19ee6befc40d59a8972cd136db530929dadb8425a010b376b67940b';
const FIXED_SHA = 'b7de692db00df32a2c57d80e683284299c31a4ab00a76d7b6a6f0bc82ad106ad';

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: Could not find src/features/music/MusicMiniPlayer.tsx.');
  console.error('Run this command from the MVPTrainerPro-Personal repository root.');
  process.exit(1);
}
if (!fs.existsSync(REPLACEMENT)) {
  console.error('ERROR: Replacement MusicMiniPlayer.tsx is missing from the R8.3.1 package.');
  process.exit(1);
}

const currentSha = sha256(TARGET);
if (currentSha === FIXED_SHA) {
  console.log('MVP Trainer V5 R8.3.1 is already installed. No changes needed.');
  process.exit(0);
}
if (currentSha !== EXPECTED_BASE_SHA) {
  console.error('ERROR: MusicMiniPlayer.tsx does not match the R8.3 file this hotfix expects.');
  console.error('Current SHA-256:', currentSha);
  console.error('Expected R8.3 SHA-256:', EXPECTED_BASE_SHA);
  console.error('No files were changed.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = TARGET + '.bak-r8-3-1-' + stamp;
fs.copyFileSync(TARGET, backup);
fs.copyFileSync(REPLACEMENT, TARGET);
const installedSha = sha256(TARGET);
if (installedSha !== FIXED_SHA) {
  fs.copyFileSync(backup, TARGET);
  console.error('ERROR: Verification failed after install. Original file restored.');
  process.exit(1);
}

console.log('MVP Trainer V5 R8.3.1 build fix applied successfully.');
console.log('Updated: src\features\music\MusicMiniPlayer.tsx');
console.log('Backup:', path.relative(ROOT, backup));
console.log('SHA-256:', installedSha);
console.log('');
console.log('Fix: removed the unused activePlaylistMobileLabel declaration that caused TS6133.');
console.log('Next: run npm run build.');
