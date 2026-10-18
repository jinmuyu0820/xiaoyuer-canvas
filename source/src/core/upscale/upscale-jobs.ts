import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';
import {
  getLocalProjectAssetRoot,
  LOCAL_PROJECT_ASSET_BUCKET,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';

import {
  formatUpscaleSummary,
  isUpscaleJobTerminal,
  normalizeUpscaleOptions,
  type UpscaleJob,
  type UpscaleJobStatus,
  type UpscaleMediaType,
  type UpscaleOptions,
} from './upscale-contract';
import {
  buildUpscaledFileName,
  buildUpscaleArgs,
} from './upscale-command';
import {
  createUpscaleEventParser,
  describeUpscaleFailure,
} from './upscale-events';
import {
  adoptUpscaleOutput,
  UPSCALE_OUTPUT_EXTENSIONS,
} from './upscale-output';
import {
  buildSlvChildEnv,
  getSlvInstall,
  getUpscaleTempRoot,
} from './slv-install';

/**
 * A one-at-a-time queue for local upscale jobs.
 *
 * Vulkan inference saturates the GPU, so running two jobs at once makes both
 * slower and risks out-of-memory failures. Jobs therefore queue and run
 * sequentially; the UI can still enqueue as many as it likes.
 *
 * State is intentionally in-memory: a job owns a live child process, so after a
 * server restart there is nothing left to resume and the client is told the job
 * is gone instead of waiting forever.
 */

const MAX_RETAINED_JOBS = 40;

const jobs = new Map<string, UpscaleJob>();
const queue: string[] = [];
const running = new Map<string, ChildProcess>();
/** Job id -> absolute source file path, resolved once when the job is queued. */
const sourcePaths = new Map<string, string>();
const cancelled = new Set<string>();
let pumping = false;

export type UpscaleJobDeps = {
  spawnImpl: typeof spawn;
  adopt: typeof adoptUpscaleOutput;
  lookupAsset: typeof getProjectAssetById;
  resolveInstall: typeof getSlvInstall;
};

const defaultDeps = (): UpscaleJobDeps => ({
  spawnImpl: spawn,
  adopt: adoptUpscaleOutput,
  lookupAsset: getProjectAssetById,
  // Resolved per job, not at module load: adding the engine later must work
  // without restarting the server.
  resolveInstall: getSlvInstall,
});

let deps: UpscaleJobDeps = defaultDeps();

/** Tests replace the engine with a fake child process. */
export const setUpUpscaleJobDeps = (overrides: Partial<UpscaleJobDeps>) => {
  deps = { ...deps, ...overrides };
};

export const resetUpscaleJobDeps = () => {
  deps = defaultDeps();
};

const clone = (job: UpscaleJob): UpscaleJob => ({
  ...job,
  options: { ...job.options },
  output: job.output ? { ...job.output } : null,
});

const evictOldJobs = () => {
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_RETAINED_JOBS) break;
    if (isUpscaleJobTerminal(job.status)) {
      jobs.delete(id);
      sourcePaths.delete(id);
    }
  }
};

const nowIso = () => new Date().toISOString();

export const getUpscaleJob = (jobId: string) => {
  const job = jobs.get(jobId);
  return job ? clone(job) : null;
};

export const listUpscaleJobs = (projectId: string) =>
  [...jobs.values()]
    .filter((job) => job.projectId === projectId)
    .slice(-MAX_RETAINED_JOBS)
    .map(clone);

const patchJob = (jobId: string, patch: Partial<UpscaleJob>) => {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
};

/**
 * Attach a job to an existing project asset. Only the project's own local
 * assets have a readable file on disk, so anything else is rejected here rather
 * than failing deep inside the engine.
 */
export const startUpscaleJob = async ({
  projectId,
  assetId,
  options,
  deps: overrides,
}: {
  projectId: string;
  assetId: string;
  options?: unknown;
  deps?: Partial<UpscaleJobDeps>;
}): Promise<UpscaleJob> => {
  if (overrides) setUpUpscaleJobDeps(overrides);
  const install = deps.resolveInstall();
  if (!install) {
    throw new Error(
      'The local processing engine was not found.'
    );
  }

  const asset = await deps.lookupAsset({ projectId, assetId });
  if (!asset) throw new Error('The source asset does not belong to this project.');
  if (asset.type !== 'image' && asset.type !== 'video') {
    throw new Error('Only images and videos can be upscaled.');
  }
  const mediaType: UpscaleMediaType = asset.type === 'image' ? 'image' : 'video';
  if (asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET) {
    throw new Error(
      'This asset is not stored locally, so the local upscale engine cannot read it.'
    );
  }
  const sourcePath = resolveLocalProjectAssetPath({
    objectKey: asset.objectKey,
    assetRoot: getLocalProjectAssetRoot(),
  });
  if (!existsSync(sourcePath)) {
    throw new Error('The source file is missing from local storage.');
  }

  const sourceFilename =
    asset.filename || `${assetId}${UPSCALE_OUTPUT_EXTENSIONS[mediaType]}`;
  const resolvedOptions: UpscaleOptions = normalizeUpscaleOptions(
    options,
    mediaType
  );

  const job: UpscaleJob = {
    id: randomUUID(),
    projectId,
    sourceAssetId: assetId,
    sourceFilename,
    mediaType,
    options: resolvedOptions,
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: '',
    speedFps: null,
    etaSeconds: null,
    error: null,
    output: null,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(job.id, job);
  sourcePaths.set(job.id, sourcePath);
  evictOldJobs();
  queue.push(job.id);
  void pump();
  return clone(job);
};

const killTree = (child: ChildProcess) => {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // The engine launches ffmpeg and the Vulkan tools as descendants; killing
    // only the parent would leave a GPU job running.
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => undefined);
      return;
    } catch {
      // fall through to a direct kill
    }
  }
  child.kill('SIGKILL');
};

const finishJob = (
  jobId: string,
  patch: Partial<UpscaleJob> & { status: UpscaleJobStatus }
) => {
  cancelled.delete(jobId);
  running.delete(jobId);
  patchJob(jobId, { ...patch, finishedAt: nowIso() });
  evictOldJobs();
};

export const cancelUpscaleJob = (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Upscale job not found.');
  if (isUpscaleJobTerminal(job.status)) return clone(job);
  cancelled.add(jobId);
  const child = running.get(jobId);
  if (child) {
    killTree(child);
  } else {
    const index = queue.indexOf(jobId);
    if (index >= 0) queue.splice(index, 1);
    sourcePaths.delete(jobId);
    finishJob(jobId, {
      status: 'cancelled',
      message: 'Upscale cancelled.',
    });
  }
  return clone(jobs.get(jobId) ?? job);
};

const runJob = async (
  job: UpscaleJob,
  install: NonNullable<ReturnType<typeof getSlvInstall>>,
  sourcePath: string
) => {
  const jobDir = join(getUpscaleTempRoot(), job.id);
  const extension = UPSCALE_OUTPUT_EXTENSIONS[job.mediaType];
  const outputPath = join(jobDir, `output${extension}`);

  patchJob(job.id, {
    status: 'running',
    startedAt: nowIso(),
    stage: 'prepare',
    progress: 0,
    message: '',
  });

  await mkdir(jobDir, { recursive: true });

  const args = buildUpscaleArgs({
    options: job.options,
    mediaType: job.mediaType,
    inputPath: sourcePath,
    outputPath,
    install,
  });

  const child = deps.spawnImpl(install.engine, args, {
    cwd: install.root,
    env: buildSlvChildEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.set(job.id, child);

  const parser = createUpscaleEventParser();
  const stderrParser = createUpscaleEventParser();

  const applyEvents = (events: ReturnType<typeof parser.push>) => {
    for (const event of events) {
      const current = jobs.get(job.id);
      if (!current) return;
      if (event.kind === 'progress') {
        Object.assign(current, {
          // The engine restarts its own counter between phases; the bar must
          // never travel backwards.
          progress: Math.max(current.progress, event.progress),
          stage: event.stage || current.stage,
          message: event.message || current.message,
          speedFps: event.speedFps ?? current.speedFps,
          etaSeconds: event.etaSeconds ?? current.etaSeconds,
        });
      } else if (event.kind === 'stage') {
        current.stage = event.stage;
      } else if (event.kind === 'failed') {
        current.error = event.message;
      } else if (event.kind === 'completed') {
        Object.assign(current, { progress: 1, stage: 'completed' });
      }
    }
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => applyEvents(parser.push(chunk)));
  child.stderr?.on('data', (chunk: string) => {
    stderrParser.push(chunk);
  });

  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.on('error', (error) => {
      patchJob(job.id, { error: error.message });
      resolveExit(null);
    });
    child.on('close', (code) => resolveExit(code));
  });

  applyEvents(parser.flush());
  stderrParser.flush();

  if (cancelled.has(job.id)) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    finishJob(job.id, {
      status: 'cancelled',
      message: 'Upscale cancelled.',
    });
    return;
  }

  const current = jobs.get(job.id);
  if (exitCode !== 0 || !existsSync(outputPath)) {
    const lines = [...stderrParser.tail(8), ...parser.tail(8)];
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    finishJob(job.id, {
      status: 'failed',
      progress: 0,
      error:
        current?.error ||
        describeUpscaleFailure({ exitCode, lines }),
    });
    return;
  }

  try {
    const output = await deps.adopt({
      projectId: job.projectId,
      sourceAssetId: job.sourceAssetId,
      sourceFilename: job.sourceFilename,
      mediaType: job.mediaType,
      scale: job.options.task === 'interpolate' ? 1 : job.options.scale,
      backend:
        job.options.task === 'interpolate' ? 'rife' : job.options.backend,
      task: job.options.task,
      summary: formatUpscaleSummary(job.options),
      jobId: job.id,
      outputPath,
      filename: buildUpscaledFileName({
        sourceFilename: job.sourceFilename,
        options: job.options,
        extension,
      }),
      ffprobe: install.ffprobe,
    });
    finishJob(job.id, {
      status: 'succeeded',
      progress: 1,
      stage: 'completed',
      message: '',
      output,
      error: null,
    });
  } catch (error) {
    finishJob(job.id, {
      status: 'failed',
      error:
        error instanceof Error
          ? `The upscaled file could not be saved: ${error.message}`
          : 'The upscaled file could not be saved.',
    });
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const jobId = queue.shift();
      if (!jobId) break;
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') continue;
      try {
        const install = deps.resolveInstall();
        const sourcePath = sourcePaths.get(jobId);
        if (!install) {
          finishJob(jobId, {
            status: 'failed',
            error:
              'The local processing engine was not found.',
          });
          continue;
        }
        if (!sourcePath || !existsSync(sourcePath)) {
          finishJob(jobId, {
            status: 'failed',
            error: 'The source file is no longer available on disk.',
          });
          continue;
        }
        await runJob(job, install, sourcePath);
      } catch (error) {
        finishJob(jobId, {
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'The upscale job could not start.',
        });
      } finally {
        sourcePaths.delete(jobId);
      }
    }
  } finally {
    pumping = false;
  }
};

/** Test helper: drop all retained state without touching files. */
export const resetUpscaleJobs = () => {
  for (const child of running.values()) killTree(child);
  jobs.clear();
  queue.length = 0;
  running.clear();
  sourcePaths.clear();
  cancelled.clear();
  pumping = false;
};
