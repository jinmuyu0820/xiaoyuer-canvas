import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { getBeatDesignDataRoot } from '@/config/data-root';

export type LocalDirectories = { projectAssets: string; assetLibrary: string; exports: string };
export const ASSET_CATEGORIES = ['人物', '道具', '场景', '声音', '视频'] as const;
const configPath = () => resolve(getBeatDesignDataRoot(), 'local-directories.json');
export function getLocalDirectories(): LocalDirectories {
  const data = getBeatDesignDataRoot();
  const defaults = { projectAssets: resolve(data, 'project-assets'), assetLibrary: resolve(data, 'asset-library'), exports: resolve(data, 'exports') };
  if (!existsSync(configPath())) return defaults;
  const saved = JSON.parse(readFileSync(configPath(), 'utf8'));
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof saved[key] === 'string' && isAbsolute(saved[key]) ? resolve(saved[key]) : fallback])) as LocalDirectories;
}
export function validateDirectoryRoot(value: string) {
  if (!value.trim() || !isAbsolute(value)) throw new Error('Use an absolute local directory path.');
  const path = resolve(value.trim());
  if (path === parse(path).root || path.startsWith('\\\\')) throw new Error('Choose a local folder, not a drive root or network path.');
  return path;
}
const overlaps = (a: string, b: string) => {
  const part = relative(a, b);
  return !part || (!part.startsWith('..') && !isAbsolute(part));
};
async function verifyWritable(path: string) {
  await mkdir(path, { recursive: true });
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Directory roots cannot be symbolic links.');
  const probe = join(path, `.seedance-check-${randomUUID()}`);
  await writeFile(probe, '', { flag: 'wx' });
  await unlink(probe);
}
async function copyExistingAssets(source: string, target: string) {
  if (!existsSync(source)) return;
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Cannot migrate linked files.');
    if (entry.isDirectory()) { await copyExistingAssets(from, to); continue; }
    if (!entry.isFile()) continue;
    if (existsSync(to)) {
      if (!(await lstat(to)).isFile()) throw new Error('A destination path is already in use.');
      const hash = async (p: string) => createHash('sha256').update(await readFile(p)).digest('hex');
      if (await hash(from) !== await hash(to)) throw new Error('Destination contains a different file. Nothing was overwritten.');
    } else await copyFile(from, to, constants.COPYFILE_EXCL);
  }
}
let saving = false;

/**
 * Directory writes versus a directory migration.
 *
 * A migration copies the old root and then switches the configuration. A write
 * that resolved the old root just before the switch and landed just after it
 * would leave a database row whose file only exists in the old root — the asset
 * page then cannot open it. Writers therefore take this gate, and a migration
 * closes it before copying and only releases the queue once the new roots are
 * saved.
 */
let migratingDirectories = false;
let activeDirectoryWrites = 0;
const directoryWriteWaiters: Array<() => void> = [];

const releaseDirectoryWriteWaiters = () => {
  for (const release of directoryWriteWaiters.splice(0)) release();
};

/** Runs an asset write that must not straddle a directory switch. */
export async function withLocalDirectoryWrite<T>(run: () => Promise<T>): Promise<T> {
  while (migratingDirectories) {
    await new Promise<void>((resolve) => directoryWriteWaiters.push(resolve));
  }
  activeDirectoryWrites += 1;
  try {
    return await run();
  } finally {
    activeDirectoryWrites -= 1;
    if (activeDirectoryWrites === 0 && !migratingDirectories) {
      releaseDirectoryWriteWaiters();
    }
  }
}

const waitForIdleDirectoryWrites = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (activeDirectoryWrites > 0) {
    if (Date.now() > deadline) {
      throw new Error('Asset writes are still running. Try the directory change again in a moment.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export async function saveLocalDirectories(input: LocalDirectories) {
  if (saving || migratingDirectories) throw new Error('Another directory change is still running.');
  saving = true;
  migratingDirectories = true;
  try {
    const next = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, validateDirectoryRoot(value)])) as LocalDirectories;
    const values = Object.values(next);
    for (let i=0;i<values.length;i++) for (let j=i+1;j<values.length;j++) if (overlaps(values[i],values[j]) || overlaps(values[j],values[i])) throw new Error('Project, library and export directories must be separate.');
    const previous = getLocalDirectories();
    for (const value of values) await verifyWritable(value);
    // Nothing may still be writing into the roots we are about to leave.
    await waitForIdleDirectoryWrites();
    for (const key of ['projectAssets', 'assetLibrary'] as const) {
      if (previous[key] === next[key]) continue;
      if (overlaps(previous[key],next[key]) || overlaps(next[key],previous[key])) throw new Error('A new directory cannot contain the old directory or be inside it.');
      await copyExistingAssets(previous[key], next[key]);
    }
    await mkdir(getBeatDesignDataRoot(), { recursive: true });
    const temp = `${configPath()}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx' });
    await rename(temp, configPath());
    return next;
  } finally {
    // The new roots are in place (or the change failed): let writers continue.
    migratingDirectories = false;
    saving = false;
    releaseDirectoryWriteWaiters();
  }
}
export async function ensureProjectDirectories(projectId: string) {
  if (!/^[\w-]{1,128}$/.test(projectId)) throw new Error('Invalid project ID.');
  const roots = getLocalDirectories();
  const materials = join(roots.projectAssets, projectId), library = join(roots.assetLibrary, projectId);
  await mkdir(materials, { recursive: true });
  for (const category of ASSET_CATEGORIES) await mkdir(join(library, category), { recursive: true });
  return { materials, library };
}
