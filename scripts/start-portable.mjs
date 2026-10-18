import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const host = '127.0.0.1';
const port = Number(process.env.SEEDANCE_PORT || 3020);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('SEEDANCE_PORT must be between 1024 and 65535.');
  process.exit(1);
}

const entry = resolve(root, '.output/server/index.mjs');
const database = resolve(root, 'data/local.db');
if (!existsSync(entry)) {
  console.error('The application build is missing. Unzip the package again.');
  process.exit(1);
}
if (!existsSync(database)) {
  console.error('The empty database is missing. Unzip the package again.');
  process.exit(1);
}

// Keep the portable package self-contained: ignore any stale machine-level
// BEATDESIGN_DATA_DIR from an older installation.
const dataRoot = resolve(root, 'data');
for (const directory of [
  'project-assets',
  'asset-library',
  'director-scenes',
  'exports',
  'upscale-jobs',
  'retired',
]) {
  mkdirSync(resolve(dataRoot, directory), { recursive: true });
}

const url = `http://${host}:${port}/zh/projects`;
const openBrowser = () => {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', [url], { stdio: 'ignore', windowsHide: true }).unref();
};

const free = await new Promise((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.listen(port, host, () => probe.close(() => done(true)));
});
if (!free) {
  console.log(`Port ${port} is already in use. Opening ${url}`);
  openBrowser();
  process.exit(0);
}

console.log(`Seedance local canvas: ${url}`);
console.log(`Data directory: ${dataRoot}`);

const child = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    BEATDESIGN_DATA_DIR: dataRoot,
    NITRO_HOST: host,
    NITRO_PORT: String(port),
    HOST: host,
    PORT: String(port),
  },
});

if (process.env.SEEDANCE_OPEN_BROWSER !== '0') {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://${host}:${port}/api/ping`);
      if (response.ok) {
        openBrowser();
        break;
      }
    } catch {
      // The server is still starting; retry briefly.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
