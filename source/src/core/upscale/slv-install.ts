import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { getBeatDesignDataRoot } from '@/config/data-root';

import type { UpscaleEngineStatus } from './upscale-contract';
import {
  buildUpscaleEnginePaths,
  buildUpscaleSetupState,
  probeUpscaleGpuDevices,
} from './upscale-setup';

/**
 * Locating the bundled SnowLeopard Vision engine.
 *
 * The app is developed next to the engine, so the default candidates walk up
 * from the working directory. `BEATDESIGN_SLV_ROOT` overrides everything for
 * installs that keep the engine somewhere else. Everything is asynchronous-free
 * and cached: the layout does not change while the server runs.
 */

export type SlvInstall = {
  root: string;
  engine: string;
  ffmpeg: string;
  ffprobe: string | null;
  realesrgan: string;
  realcugan: string;
  anime4k: string;
  /** Optional helpers the engine may pick up for other tasks. */
  rife: string | null;
  rifeModern: string | null;
};

const ENGINE_RELATIVE = join('engine', 'slv-engine.exe');

const firstExisting = (candidates: readonly string[]) =>
  candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;

const findFfmpegBin = (root: string) => {
  const stable = join(root, 'ffmpeg-stable');
  if (!existsSync(stable)) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(stable, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  return firstExisting(
    entries.map((entry) => join(stable, entry, 'bin', 'ffmpeg.exe'))
  );
};

const candidateRoots = (workspaceRoot: string) => {
  const configured = process.env.BEATDESIGN_SLV_ROOT?.trim();
  const roots = configured ? [resolve(configured)] : [];
  // `process.cwd()` is the repository root for `vite dev` and `.output` for a
  // packaged run; the engine sits beside the repository either way.
  let cursor = resolve(workspaceRoot);
  for (let depth = 0; depth < 4; depth += 1) {
    roots.push(join(cursor, 'SnowLeopard Vision'));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return roots;
};

export const resolveSlvInstall = (
  workspaceRoot = process.cwd()
): SlvInstall | null => {
  for (const root of candidateRoots(workspaceRoot)) {
    const engine = join(root, ENGINE_RELATIVE);
    if (!existsSync(engine)) continue;
    const ffmpeg = findFfmpegBin(root);
    const realesrgan = firstExisting([
      join(root, 'third_party', 'realesrgan-ncnn-vulkan', 'realesrgan-ncnn-vulkan.exe'),
      join(root, 'third_party', 'realesrgan-ncnn-vulkan-stable', 'realesrgan-ncnn-vulkan.exe'),
    ]);
    const realcugan = firstExisting([
      join(root, 'third_party', 'realcugan-ncnn-vulkan', 'realcugan-ncnn-vulkan.exe'),
    ]);
    const anime4k = firstExisting([
      join(root, 'third_party', 'anime4kcpp', 'ac_cli.exe'),
    ]);
    if (!ffmpeg || !realesrgan || !realcugan || !anime4k) continue;
    return {
      root,
      engine,
      ffmpeg,
      ffprobe: firstExisting([join(dirname(ffmpeg), 'ffprobe.exe')]),
      realesrgan,
      realcugan,
      anime4k,
      rife: firstExisting([
        join(
          root,
          'third_party',
          'rife-ncnn-vulkan',
          'rife-ncnn-vulkan-20221029-windows',
          'rife-ncnn-vulkan.exe'
        ),
      ]),
      rifeModern: firstExisting([
        join(root, 'third_party', 'rife-ncnn-vulkan-modern', 'rife-ncnn-vulkan-ex.exe'),
      ]),
    };
  }
  return null;
};

let cachedInstall: { value: SlvInstall | null } | null = null;

export const getSlvInstall = () => {
  if (!cachedInstall) cachedInstall = { value: resolveSlvInstall() };
  return cachedInstall.value;
};

/** Tests and directory changes must be able to forget the cached layout. */
export const resetSlvInstallCache = () => {
  cachedInstall = null;
};

const readBuildIdentity = (root: string) => {
  try {
    const raw = readFileSync(join(root, 'BUILD-IDENTITY.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      engineVersion:
        typeof parsed.productVersion === 'string'
          ? parsed.productVersion
          : typeof parsed.appVersion === 'string'
            ? parsed.appVersion
            : null,
    };
  } catch {
    return { engineVersion: null };
  }
};

/**
 * The engine is a PyInstaller one-file bundle: it unpacks itself into `TEMP`
 * before running. A short (8.3) Windows path in `TEMP` makes it fail with
 * "Could not create temporary directory", so every child process is given a
 * full-length directory owned by the app instead of inheriting the environment.
 */
export const getUpscaleTempRoot = (workspaceRoot = process.cwd()) =>
  join(getBeatDesignDataRoot(workspaceRoot), 'upscale-jobs');

export const buildSlvChildEnv = (
  workspaceRoot = process.cwd(),
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const tempRoot = getUpscaleTempRoot(workspaceRoot);
  return {
    ...base,
    TEMP: tempRoot,
    TMP: tempRoot,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
};

export const describeUpscaleEngine = async (): Promise<UpscaleEngineStatus> => {
  const install = getSlvInstall();
  if (!install) {
    return {
      available: false,
      root: null,
      engineVersion: null,
      productName: 'SnowLeopard Vision',
      gpu: null,
      gpus: [],
      encoders: [],
      paths: null,
      setup: buildUpscaleSetupState(null),
      error:
        'The local processing engine was not found.',
    };
  }
  const { engineVersion } = readBuildIdentity(install.root);
  const { gpus, encoders } = await probeUpscaleGpuDevices();
  return {
    available: true,
    root: install.root,
    engineVersion,
    productName: 'SnowLeopard Vision',
    gpu: gpus[0]?.name ?? null,
    gpus,
    encoders,
    paths: buildUpscaleEnginePaths(install),
    setup: buildUpscaleSetupState(install.root),
    error: null,
  };
};
