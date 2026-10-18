import {
  WORKSPACE_MUTATION_HEADER,
  WORKSPACE_MUTATION_HEADER_VALUE,
} from '@/lib/trusted-local-request';

import type {
  UpscaleEngineStatus,
  UpscaleJob,
  UpscaleOptions,
} from './upscale-contract';

/**
 * Browser-side helpers for the local upscale API. Canvas code never talks to
 * the engine directly; it starts a job and polls its status.
 */

const upscaleRoute = (projectId: string, jobId?: string | null) => {
  const base = `/api/app/projects/${encodeURIComponent(projectId)}/upscale`;
  return jobId ? `${base}?jobId=${encodeURIComponent(jobId)}` : base;
};

const post = async (
  projectId: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
) => {
  const response = await fetchImpl(upscaleRoute(projectId), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { job?: UpscaleJob | null; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'The local upscale request failed.');
  }
  return payload;
};

export const startUpscaleJob = async ({
  projectId,
  assetId,
  options,
  fetchImpl = fetch,
}: {
  projectId: string;
  assetId: string;
  options: UpscaleOptions;
  fetchImpl?: typeof fetch;
}): Promise<UpscaleJob> => {
  const payload = await post(projectId, { action: 'start', assetId, options }, fetchImpl);
  if (!payload?.job) throw new Error('The upscale job could not be created.');
  return payload.job;
};

export const cancelUpscaleJob = async ({
  projectId,
  jobId,
  fetchImpl = fetch,
}: {
  projectId: string;
  jobId: string;
  fetchImpl?: typeof fetch;
}): Promise<UpscaleJob | null> => {
  const payload = await post(projectId, { action: 'cancel', jobId }, fetchImpl);
  return payload?.job ?? null;
};

/**
 * Returns `null` when the server no longer knows the job (a restart while the
 * card was still marked as processing). Callers mark such cards as failed
 * instead of polling them forever.
 */
export const fetchUpscaleJob = async ({
  projectId,
  jobId,
  fetchImpl = fetch,
}: {
  projectId: string;
  jobId: string;
  fetchImpl?: typeof fetch;
}): Promise<UpscaleJob | null> => {
  const response = await fetchImpl(upscaleRoute(projectId, jobId));
  const payload = (await response.json().catch(() => null)) as
    | { job?: UpscaleJob | null; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'The upscale job could not be read.');
  }
  return payload?.job ?? null;
};

export const fetchUpscaleEngine = async ({
  projectId,
  fetchImpl = fetch,
}: {
  projectId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ engine: UpscaleEngineStatus; jobs: UpscaleJob[] }> => {
  const response = await fetchImpl(upscaleRoute(projectId));
  const payload = (await response.json().catch(() => null)) as
    | { engine?: UpscaleEngineStatus; jobs?: UpscaleJob[]; error?: string }
    | null;
  if (!response.ok || !payload?.engine) {
    throw new Error(payload?.error || 'The upscale engine status is unavailable.');
  }
  return { engine: payload.engine, jobs: payload.jobs ?? [] };
};
