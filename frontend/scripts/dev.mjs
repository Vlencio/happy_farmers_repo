import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(frontend, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
  return child;
}
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`A porta ${port} já está em uso. Encerre o servidor anterior antes de iniciar.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
try {
  if (!existsSync(python)) throw new Error('Crie .venv na raiz e instale backend/requirements.txt. Veja frontend/README.md.');
  await available(8000); await available(4173);
  const api = start(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8000'], root);
  let ready = false;
  for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(500) })).ok; } catch { /* API is starting. */ }
    if (ready || api.exitCode !== null) break;
    await delay(200);
  }
  if (!ready || stopping) throw new Error('A API não iniciou. Confira o erro acima e as dependências Python.');
  start(process.execPath, ['node_modules/vite/bin/vite.js', ...(process.argv.includes('--preview') ? ['preview'] : [])], frontend);
  console.log('Happy Farmers + motor: http://127.0.0.1:4173 · Ctrl+C encerra os dois serviços.');
} catch (error) { console.error(error.message); stop(1); }
