import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getBeatDesignDataRoot } from '@/config/data-root';

import type {
  UpscaleEnginePaths,
  UpscaleGpuDevice,
  UpscaleLaunchResult,
  UpscaleSetupState,
} from './upscale-contract';

/**
 * Machine-level setup for the bundled SnowLeopard Vision desktop app.
 *
 * The engine itself is a headless CLI, but the first run is meant to be done by
 * hand in the GUI: it is the only way to see the vendor's model list, let the
 * user confirm the GPU, and warm the Vulkan caches. This module finds the GUI,
 * launches it outside the server process, and remembers that the walkthrough
 * happened.
 */

const GUI_EXE = 'SnowLeopard Vision.exe';
const SETUP_FILE = 'upscale-setup.json';
const GUI_ROOT_FILE = 'upscale-gui-root.txt';

type StoredSetup = {
  guiLastLaunchedAt: string | null;
  manualUpscaleAt: string | null;
  manualInterpolateAt: string | null;
  confirmedAt: string | null;
};

const EMPTY_SETUP: StoredSetup = {
  guiLastLaunchedAt: null,
  manualUpscaleAt: null,
  manualInterpolateAt: null,
  confirmedAt: null,
};

const setupFilePath = () => join(getBeatDesignDataRoot(), SETUP_FILE);
const guiRootFilePath = () => join(getBeatDesignDataRoot(), GUI_ROOT_FILE);

const nowIso = () => new Date().toISOString();

export const readStoredUpscaleSetup = (): StoredSetup => {
  try {
    const parsed = JSON.parse(
      readFileSync(setupFilePath(), 'utf8')
    ) as Partial<StoredSetup>;
    return {
      guiLastLaunchedAt:
        typeof parsed.guiLastLaunchedAt === 'string'
          ? parsed.guiLastLaunchedAt
          : null,
      manualUpscaleAt:
        typeof parsed.manualUpscaleAt === 'string'
          ? parsed.manualUpscaleAt
          : null,
      manualInterpolateAt:
        typeof parsed.manualInterpolateAt === 'string'
          ? parsed.manualInterpolateAt
          : null,
      confirmedAt:
        typeof parsed.confirmedAt === 'string' ? parsed.confirmedAt : null,
    };
  } catch {
    return { ...EMPTY_SETUP };
  }
};

const writeStoredUpscaleSetup = (value: StoredSetup) => {
  try {
    mkdirSync(getBeatDesignDataRoot(), { recursive: true });
    writeFileSync(setupFilePath(), JSON.stringify(value, null, 2), 'utf8');
  } catch {
    // Setup state is a convenience, not a job precondition.
  }
};

export const markUpscaleSetup = ({
  launched,
  manualUpscale,
  manualInterpolate,
  confirmed,
}: {
  launched?: boolean;
  manualUpscale?: boolean;
  manualInterpolate?: boolean;
  confirmed?: boolean;
}) => {
  const current = readStoredUpscaleSetup();
  const next: StoredSetup = {
    ...current,
    guiLastLaunchedAt: launched ? nowIso() : current.guiLastLaunchedAt,
    manualUpscaleAt: manualUpscale ? nowIso() : current.manualUpscaleAt,
    manualInterpolateAt: manualInterpolate
      ? nowIso()
      : current.manualInterpolateAt,
    confirmedAt: confirmed ? nowIso() : current.confirmedAt,
  };
  writeStoredUpscaleSetup(next);
  return next;
};

const isGuiFolder = (folder: string | null) =>
  Boolean(folder && existsSync(join(folder, GUI_EXE)));

/**
 * Order matters: an explicit env override, then a one-line local file, then
 * the folder the engine was found in. The local file exists because the agent
 * workspace this app is developed in is not a reliable place to launch a
 * WebView2 app from on every machine.
 */
export const resolveUpscaleGuiRoot = (
  engineRoot: string | null
): string | null => {
  const candidates = [
    process.env.BEATDESIGN_SLV_GUI_ROOT?.trim() ?? '',
    (() => {
      try {
        return readFileSync(guiRootFilePath(), 'utf8').split(/\r?\n/)[0]?.trim();
      } catch {
        return '';
      }
    })(),
    engineRoot ?? '',
  ].filter(Boolean);
  return candidates.find(isGuiFolder) ?? null;
};

export const buildUpscaleSetupState = (
  engineRoot: string | null
): UpscaleSetupState => {
  const guiRoot = resolveUpscaleGuiRoot(engineRoot);
  const stored = readStoredUpscaleSetup();
  return {
    guiAvailable: Boolean(guiRoot),
    guiRoot,
    ...stored,
  };
};

const execFileAsync = promisify(execFile);

const tasklistHasGui = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${GUI_EXE}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 4000 }
    );
    return stdout.toLowerCase().includes(GUI_EXE.toLowerCase());
  } catch {
    return false;
  }
};

const wait = (ms: number) =>
  new Promise<void>((resolveWait) => setTimeout(resolveWait, ms));

export const launchUpscaleGui = async (
  engineRoot: string | null
): Promise<UpscaleLaunchResult> => {
  const root = resolveUpscaleGuiRoot(engineRoot);
  if (!root) {
    return {
      ok: false,
      path: null,
      reason: 'missing',
      error: 'SnowLeopard Vision.exe was not found in any configured folder.',
      setup: buildUpscaleSetupState(engineRoot),
    };
  }
  const exe = join(root, GUI_EXE);
  const tempRoot = join(getBeatDesignDataRoot(), 'upscale-jobs');
  try {
    mkdirSync(tempRoot, { recursive: true });
  } catch {
    // The GUI can still start with its own temp folder.
  }

  let child;
  try {
    child = spawn(exe, [], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: {
        ...process.env,
        // The engine is a PyInstaller bundle and rejects an 8.3 short TEMP.
        TEMP: tempRoot,
        TMP: tempRoot,
      },
    });
    child.unref();
  } catch (error) {
    return {
      ok: false,
      path: exe,
      reason: 'spawn',
      error: error instanceof Error ? error.message : 'The tool could not start.',
      setup: buildUpscaleSetupState(engineRoot),
    };
  }

  const outcome = await new Promise<'running' | 'exited' | 'error'>(
    (resolveOutcome) => {
      let settled = false;
      const finish = (value: 'running' | 'exited' | 'error') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOutcome(value);
      };
      const timer = setTimeout(() => finish('running'), 2500);
      timer.unref?.();
      child.once('error', () => finish('error'));
      child.once('exit', () => finish('exited'));
    }
  );

  // A second launch of a single-instance app exits immediately while the first
  // window is still open; that is success from the user's point of view.
  if (outcome === 'exited' && (await tasklistHasGui())) {
    markUpscaleSetup({ launched: true });
    return {
      ok: true,
      path: exe,
      reason: null,
      error: null,
      setup: buildUpscaleSetupState(engineRoot),
    };
  }

  if (outcome === 'running') {
    await wait(200);
    markUpscaleSetup({ launched: true });
    return {
      ok: true,
      path: exe,
      reason: null,
      error: null,
      setup: buildUpscaleSetupState(engineRoot),
    };
  }

  return {
    ok: false,
    path: exe,
    reason: outcome === 'exited' ? 'exited' : 'spawn',
    error:
      outcome === 'exited'
        ? 'The tool exited right after starting (WebView2 could not create its window).'
        : 'The tool could not start.',
    setup: buildUpscaleSetupState(engineRoot),
  };
};

let cachedDevices:
  | { at: number; gpus: UpscaleGpuDevice[]; encoders: UpscaleGpuDevice[] }
  | null = null;

/**
 * NVIDIA's tool lists physical GPUs in the same order as the Vulkan and NVENC
 * device indices used by the engine. With no NVIDIA driver the UI simply offers
 * `auto`, which is also the engine's default.
 */
export const probeUpscaleGpuDevices = async (): Promise<{
  gpus: UpscaleGpuDevice[];
  encoders: UpscaleGpuDevice[];
}> => {
  if (cachedDevices && Date.now() - cachedDevices.at < 60_000) {
    return { gpus: cachedDevices.gpus, encoders: cachedDevices.encoders };
  }
  let gpus: UpscaleGpuDevice[] = [];
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=index,name', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 }
    );
    gpus = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const comma = line.indexOf(',');
        const id = (comma >= 0 ? line.slice(0, comma) : line).trim();
        const name = (comma >= 0 ? line.slice(comma + 1) : '').trim();
        return { id, name: name || `GPU ${id}` };
      })
      .filter((device) => /^\d{1,2}$/.test(device.id));
  } catch {
    gpus = [];
  }
  const devices = { gpus, encoders: gpus };
  cachedDevices = { at: Date.now(), ...devices };
  return devices;
};

export const buildUpscaleEnginePaths = (
  install: {
    root: string;
    engine: string;
    ffmpeg: string;
    realesrgan: string;
    realcugan: string;
    anime4k: string;
    rife: string | null;
    rifeModern: string | null;
  } | null
): UpscaleEnginePaths | null =>
  install
    ? {
        root: install.root,
        engine: install.engine,
        ffmpeg: install.ffmpeg,
        realesrgan: install.realesrgan,
        realcugan: install.realcugan,
        anime4k: install.anime4k,
        rife: install.rife,
        rifeModern: install.rifeModern,
      }
    : null;
