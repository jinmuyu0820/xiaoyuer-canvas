import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
for (const args of [
  ['scripts/db-setup.mjs'],
  ['scripts/migrate-stage-zero.mjs'],
  ['node_modules/drizzle-kit/bin.cjs', 'push', '--config=drizzle.config.ts'],
  ['--import', 'tsx', 'scripts/prepare-paraglide.ts'],
  ['node_modules/vite/bin/vite.js', 'build'],
  ['scripts/sanitize-output.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
