import { createFileRoute } from '@tanstack/react-router';

import { getActiveProject } from '@/core/projects/projects';
import {
  cancelUpscaleJob,
  getUpscaleJob,
  listUpscaleJobs,
  startUpscaleJob,
} from '@/core/upscale/upscale-jobs';
import { describeUpscaleEngine } from '@/core/upscale/slv-install';
import {
  readRequestJsonWithLimit,
  RequestBodyTooLargeError,
} from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

const MAX_REQUEST_BYTES = 16 * 1024;

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const project = await getActiveProject({ projectId: params.projectId });
  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }
  const jobId = new URL(request.url).searchParams.get('jobId');
  if (jobId) {
    const job = getUpscaleJob(jobId);
    if (!job || job.projectId !== params.projectId) {
      // A card that outlived its job (server restart) must be told so instead
      // of polling a 404 forever.
      return Response.json({ job: null, missing: true }, { status: 200 });
    }
    return Response.json({ job });
  }
  return Response.json({
    jobs: listUpscaleJobs(params.projectId),
    engine: await describeUpscaleEngine(),
  });
}

async function POST({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) {
    return Response.json({ error: trust.message }, { status: trust.status });
  }
  const project = await getActiveProject({ projectId: params.projectId });
  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  try {
    const body = await readRequestJsonWithLimit<{
      action?: unknown;
      assetId?: unknown;
      jobId?: unknown;
      options?: unknown;
    }>(request, MAX_REQUEST_BYTES);

    if (body.action === 'cancel') {
      if (typeof body.jobId !== 'string' || !body.jobId) {
        return Response.json({ error: 'A job id is required.' }, { status: 400 });
      }
      const existing = getUpscaleJob(body.jobId);
      if (!existing || existing.projectId !== params.projectId) {
        return Response.json({ job: null, missing: true }, { status: 200 });
      }
      return Response.json({ job: cancelUpscaleJob(body.jobId) });
    }

    if (body.action !== 'start') {
      return Response.json(
        { error: 'Unsupported upscale operation.' },
        { status: 400 }
      );
    }
    if (typeof body.assetId !== 'string' || !body.assetId) {
      return Response.json({ error: 'A source asset is required.' }, { status: 400 });
    }
    const job = await startUpscaleJob({
      projectId: params.projectId,
      assetId: body.assetId,
      options: body.options,
    });
    return Response.json({ job });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: 'The upscale request is too large.' }, { status: 413 });
    }
    console.error('local upscale request failed:', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The local upscale job could not be started.',
      },
      { status: 400 }
    );
  }
}

export const Route = createFileRoute('/api/app/projects/$projectId/upscale')({
  server: { handlers: { GET, POST } },
});
