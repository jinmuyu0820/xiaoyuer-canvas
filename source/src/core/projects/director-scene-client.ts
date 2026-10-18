import {
  WORKSPACE_MUTATION_HEADER,
  WORKSPACE_MUTATION_HEADER_VALUE,
} from '@/lib/trusted-local-request';

const directorRoute = (projectId: string, nodeId?: string | null) => {
  const base = `/api/app/projects/${encodeURIComponent(projectId)}/director`;
  return nodeId ? `${base}?nodeId=${encodeURIComponent(nodeId)}` : base;
};

export type DirectorScene = Record<string, unknown>;

export const fetchDirectorScene = async (
  projectId: string,
  nodeId?: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<DirectorScene | null> => {
  const response = await fetchImpl(directorRoute(projectId, nodeId), {
    headers: { accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => null)) as
    | { scene?: DirectorScene | null; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Could not load the director scene');
  }
  return payload?.scene ?? null;
};

export const saveDirectorScene = async (
  projectId: string,
  scene: DirectorScene,
  nodeId?: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  const response = await fetchImpl(directorRoute(projectId), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE,
    },
    body: JSON.stringify({ action: 'save-scene', scene, ...(nodeId ? { nodeId } : {}) }),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  throw new Error(payload?.error || 'Could not save the director scene');
};
