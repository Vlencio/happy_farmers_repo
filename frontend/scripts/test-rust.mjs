import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root = fileURLToPath(new URL('..', import.meta.url));
const ext = process.platform === 'win32' ? '.exe' : '';
const localRustc = path.join(os.homedir(), '.cargo', 'bin', `rustc${ext}`);
const rustc = process.env.RUSTC || (existsSync(localRustc) ? localRustc : 'rustc');
const output = path.join(root, '.cache', `season-tests${ext}`);
mkdirSync(path.dirname(output), { recursive: true });
for (const [command, args] of [[rustc, ['--edition=2024', '--test', 'src/season.rs', '-o', output]], [output, []]]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`Season tests failed: ${result.status}`);
}
