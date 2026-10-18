/**
 * Storage for 3D 导演台 (DirectorDesk) scene documents.
 *
 * Two shapes coexist:
 *  - project-level scene (`<projectId>.json`) from the first integration, where
 *    the desk was a project-wide drawer;
 *  - node-level scene (`<projectId>--<hash>.json`), one per canvas director node.
 *
 * The embedded app owns its own IndexedDB autosave, but that is a single
 * browser-wide slot, so the host mirrors the scene here.
 *
 * The document is deliberately opaque: DirectorDesk evolves its own schema and
 * the host has no business rewriting it. We only enforce size, type and file
 * placement so a bad payload cannot escape the project namespace.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getBeatDesignDataRoot } from '@/config/data-root';

export const MAX_DIRECTOR_SCENE_BYTES = 8 * 1024 * 1024;

const PROJECT_ID_PATTERN = /^[\w-]{1,128}$/;
const NODE_ID_PATTERN = /^[\w:-]{1,200}$/;

const assertProjectId = (projectId: string) => {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Invalid project id');
  }
  return projectId;
};

const assertNodeId = (nodeId: string) => {
  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new Error('Invalid director node id');
  }
  return nodeId;
};

/**
 * Node ids look like `shape:9f3a…`; the colon is not a valid Windows filename
 * character, so the file name carries a stable hash instead of the raw id.
 */
export const getDirectorSceneFileName = (projectId: string, nodeId?: string | null) => {
  const project = assertProjectId(projectId);
  if (!nodeId) return `${project}.json`;
  const digest = createHash('sha256')
    .update(assertNodeId(nodeId))
    .digest('hex')
    .slice(0, 24);
  return `${project}--${digest}.json`;
};

export const getDirectorSceneDirectory = (workspaceRoot = process.cwd()) =>
  join(getBeatDesignDataRoot(workspaceRoot), 'director-scenes');

export const getDirectorScenePath = (
  projectId: string,
  workspaceRoot = process.cwd(),
  nodeId?: string | null
) =>
  join(
    getDirectorSceneDirectory(workspaceRoot),
    getDirectorSceneFileName(projectId, nodeId)
  );

export type DirectorSceneDocument = Record<string, unknown>;

const isPlainObject = (value: unknown): value is DirectorSceneDocument =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const readSceneFile = async (
  path: string
): Promise<DirectorSceneDocument | null> => {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error('Saved director scene is not an object');
  }
  return parsed;
};

/**
 * Returns null when nothing is saved yet.
 *
 * With a nodeId, a missing node scene falls back to the legacy project scene so
 * work created before nodes existed still opens inside the first node.
 */
export const readDirectorScene = async ({
  projectId,
  nodeId,
  workspaceRoot,
  fallbackToProjectScene = true,
}: {
  projectId: string;
  nodeId?: string | null;
  workspaceRoot?: string;
  fallbackToProjectScene?: boolean;
}): Promise<DirectorSceneDocument | null> => {
  if (nodeId) {
    const nodeScene = await readSceneFile(
      getDirectorScenePath(projectId, workspaceRoot, nodeId)
    );
    if (nodeScene) return nodeScene;
    if (!fallbackToProjectScene) return null;
  }
  return readSceneFile(getDirectorScenePath(projectId, workspaceRoot));
};

export const saveDirectorScene = async ({
  projectId,
  nodeId,
  scene,
  workspaceRoot,
}: {
  projectId: string;
  nodeId?: string | null;
  scene: unknown;
  workspaceRoot?: string;
}): Promise<{ bytes: number; savedAt: string }> => {
  if (!isPlainObject(scene)) {
    throw new Error('A director scene must be a JSON object');
  }
  const serialized = JSON.stringify(scene);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_DIRECTOR_SCENE_BYTES) {
    throw new Error(
      `The director scene exceeds the ${Math.round(MAX_DIRECTOR_SCENE_BYTES / 1024 / 1024)} MB limit`
    );
  }

  const path = getDirectorScenePath(projectId, workspaceRoot, nodeId);
  await mkdir(getDirectorSceneDirectory(workspaceRoot), { recursive: true });
  // Write then rename so a crash cannot leave a half-written scene behind.
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { bytes, savedAt: new Date().toISOString() };
};

export const deleteDirectorScene = async ({
  projectId,
  nodeId,
  workspaceRoot,
}: {
  projectId: string;
  nodeId?: string | null;
  workspaceRoot?: string;
}) => {
  const path = getDirectorScenePath(projectId, workspaceRoot, nodeId);
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
};
