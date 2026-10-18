import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { hashFileSha256 } from '@/core/projects/local-file-utils';

import {
  buildLocalProjectAssetUrl,
  createLocalProjectAssetObjectKey,
  persistLocalProjectAsset,
  resolveLocalProjectAssetPath,
  sanitizeLocalProjectAssetFilename,
} from '@/core/projects/local-project-assets';
import {
  linkProjectAsset,
  recordUserAsset,
} from '@/core/workspace-lib/assets/user-assets';

import type { UpscaleJobOutput, UpscaleMediaType } from './upscale-contract';

/**
 * Turning the engine's output file into a first-class project asset.
 *
 * The output is written straight into the project asset root by the engine, so
 * a 500 MB video never has to be loaded into memory: the file is renamed into
 * place and hashed as a stream.
 */

export const UPSCALE_OUTPUT_EXTENSIONS: Record<UpscaleMediaType, string> = {
  image: '.png',
  video: '.mp4',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

export const mimeTypeForExtension = (extension: string) =>
  MIME_BY_EXTENSION[extension.toLowerCase()] ??
  (extension.toLowerCase().startsWith('.p') ? 'image/png' : 'video/mp4');

export type ProbedMedia = {
  width?: number;
  height?: number;
  durationMs?: number;
};

const parsePositive = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
};

/**
 * `ffprobe` is only used for metadata; a missing binary or an unreadable file
 * degrades to an asset without dimensions rather than failing the job.
 */
export const probeMediaFile = ({
  ffprobe,
  filePath,
  timeoutMs = 20_000,
}: {
  ffprobe: string;
  filePath: string;
  timeoutMs?: number;
}): Promise<ProbedMedia> =>
  new Promise((resolveProbe) => {
    let settled = false;
    const finish = (value: ProbedMedia) => {
      if (settled) return;
      settled = true;
      resolveProbe(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        ffprobe,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,duration',
          '-of',
          'json',
          filePath,
        ],
        { windowsHide: true }
      );
    } catch {
      finish({});
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      finish({});
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.length > 65_536) out = out.slice(0, 65_536);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish({});
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<Record<string, unknown>>;
        };
        const stream = parsed.streams?.[0] ?? {};
        const durationSeconds = Number(stream.duration);
        finish({
          width: parsePositive(stream.width),
          height: parsePositive(stream.height),
          durationMs: Number.isFinite(durationSeconds)
            ? Math.round(durationSeconds * 1000)
            : undefined,
        });
      } catch {
        finish({});
      }
    });
  });

/**
 * Move the engine output into the project asset root and register it. Returns
 * the same shape the upload route hands back to the canvas, so an upscaled file
 * is indistinguishable from any other project asset downstream.
 */
export const adoptUpscaleOutput = async ({
  projectId,
  sourceAssetId,
  sourceFilename,
  mediaType,
  scale,
  backend,
  task = 'upscale',
  summary,
  jobId,
  outputPath,
  filename,
  ffprobe,
  assetRoot,
}: {
  projectId: string;
  sourceAssetId: string;
  sourceFilename: string;
  mediaType: UpscaleMediaType;
  scale: number;
  backend: string;
  task?: 'upscale' | 'interpolate';
  summary?: string;
  jobId: string;
  outputPath: string;
  filename: string;
  ffprobe: string | null;
  assetRoot?: string;
}): Promise<UpscaleJobOutput> => {
  const assetId = randomUUID();
  const extension =
    filename.slice(filename.lastIndexOf('.')).toLowerCase() ||
    UPSCALE_OUTPUT_EXTENSIONS[mediaType];
  const mimeType = mimeTypeForExtension(extension);
  const safeFilename = sanitizeLocalProjectAssetFilename({ filename, mimeType });
  const objectKey = createLocalProjectAssetObjectKey({
    projectId,
    assetId,
    filename: safeFilename,
  });
  const finalPath = resolveLocalProjectAssetPath({ objectKey, assetRoot });

  await mkdir(dirname(finalPath), { recursive: true });
  // Re-check after creating the tree so a pre-existing symlink cannot redirect
  // the write outside the project-owned asset root.
  resolveLocalProjectAssetPath({ objectKey, assetRoot });
  try {
    await rename(outputPath, finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(outputPath, finalPath);
    await unlink(outputPath).catch(() => undefined);
  }

  const [sizeBytes, sha256, probed] = await Promise.all([
    stat(finalPath).then((value) => value.size),
    hashFileSha256(finalPath),
    ffprobe
      ? probeMediaFile({ ffprobe, filePath: finalPath })
      : Promise.resolve<ProbedMedia>({}),
  ]);

  try {
    await recordUserAsset({
      id: assetId,
      type: mediaType,
      source: 'derived',
      bucket: 'local-project-assets',
      objectKey,
      publicUrl: buildLocalProjectAssetUrl({ projectId, assetId }),
      mimeType,
      sizeBytes,
      sha256,
      filename: safeFilename,
      storageProvider: 'local',
      assetClass: 'derived',
      originProjectId: projectId,
      width: probed.width,
      height: probed.height,
      durationMs: probed.durationMs,
      metadata: {
        operation: 'upscale',
        task,
        ...(summary ? { result: summary } : {}),
        jobId,
        sourceAssetId,
        sourceFilename,
        backend,
        scale,
      },
    });
    await linkProjectAsset({
      projectId,
      assetId,
      role: 'generated',
      assetRole: 'derived',
      metadata: { operation: 'upscale', task, jobId, sourceAssetId, scale },
    });
  } catch (error) {
    await persistLocalProjectAssetCleanup(finalPath);
    throw error;
  }

  return {
    assetId,
    publicUrl: buildLocalProjectAssetUrl({ projectId, assetId }),
    filename: safeFilename,
    sizeBytes,
    ...(probed.width ? { width: probed.width } : {}),
    ...(probed.height ? { height: probed.height } : {}),
    ...(probed.durationMs ? { durationMs: probed.durationMs } : {}),
  };
};

const persistLocalProjectAssetCleanup = async (filePath: string) => {
  await unlink(filePath).catch(() => undefined);
};
