import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export const runeDir = path.join(root, '.cache', 'rune');
export function setupRune() {
  const pin = JSON.parse(readFileSync(path.join(root, 'rune-revision.json'), 'utf8'));
  const git = (args, capture = false) => execFileSync('git', args, {
    cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true,
  });
  if (!existsSync(path.join(runeDir, '.git'))) {
    mkdirSync(path.dirname(runeDir), { recursive: true });
    git(['init', runeDir]);
    git(['-C', runeDir, 'remote', 'add', 'origin', pin.repository]);
    git(['-C', runeDir, 'fetch', '--depth=1', 'origin', pin.revision]);
    git(['-C', runeDir, 'checkout', '--detach', pin.revision]);
  }
  if (git(['-C', runeDir, 'rev-parse', 'HEAD'], true).trim() !== pin.revision) {
    throw new Error('Rune cache has a different revision. Preserve your changes and move .cache/rune before rebuilding.');
  }
  for (const patch of pin.patches) {
    const file = path.join(root, patch);
    try { git(['-C', runeDir, 'apply', '--reverse', '--check', file], true); }
    catch {
      git(['-C', runeDir, 'apply', '--check', file]);
      git(['-C', runeDir, 'apply', file]);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setupRune();
