import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { setupRune } from './setup-rune.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = process.platform === 'win32' ? '.exe' : '';
const localCargo = path.join(os.homedir(), '.cargo', 'bin', `cargo${exe}`);
const cargo = process.env.CARGO || (existsSync(localCargo) ? localCargo : 'cargo');
const bundled = path.join(root, '.tools', 'wasm-bindgen-0.2.129-x86_64-pc-windows-msvc', 'wasm-bindgen.exe');
const bindgen = process.env.WASM_BINDGEN || (existsSync(bundled) ? bundled : path.join(os.homedir(), '.cargo', 'bin', `wasm-bindgen${exe}`));
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} failed (${result.status}). ${result.stderr || ''}`);
  return result.stdout?.trim();
}
setupRune();
if (run(bindgen, ['--version'], true) !== 'wasm-bindgen 0.2.129') {
  throw new Error('Install wasm-bindgen-cli 0.2.129 (see frontend/README.md). The CLI and Rust crate versions must match.');
}
const release = process.argv.includes('--release');
run(cargo, ['build', '--locked', '--target', 'wasm32-unknown-unknown', '--lib', ...(release ? ['--release'] : [])]);
mkdirSync(path.join(root, 'public', 'pkg'), { recursive: true });
run(bindgen, [`target/wasm32-unknown-unknown/${release ? 'release' : 'debug'}/happy_farmers.wasm`, '--target', 'web', '--out-dir', 'public/pkg', '--out-name', 'app']);
if (!process.argv.includes('--wasm-only')) run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
