import { createFileRoute } from '@tanstack/react-router';

import {
  MAX_DIRECTOR_SCENE_BYTES,
  readDirectorScene,
  saveDirectorScene,
} from '@/core/projects/director-scene';
import { getActiveProject } from '@/core/projects/projects';
import {
  readRequestJsonWithLimit,
  RequestBodyTooLargeError,
} from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

const MAX_REQUEST_BYTES = MAX_DIRECTOR_SCENE_BYTES + 64 * 1024;
const NODE_ID_PATTERN = /^[\w:-]{1,200}$/;

const parseNodeId = (value: unknown) => {
  if (typeof value !== 'string' || !value) return null;
  if (!NODE_ID_PATTERN.test(value)) throw new Error('Invalid director node id');
  return value;
};

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
  try {
    const url = new URL(request.url);
    const nodeId = parseNodeId(url.searchParams.get('nodeId'));
    return Response.json({
      scene: await readDirectorScene({ projectId: params.projectId, nodeId }),
      nodeId,
    });
  } catch (error) {
    console.error('director scene read failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'The saved director scene could not be read.' },
      { status: 400 }
    );
  }
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
      scene?: unknown;
      nodeId?: unknown;
    }>(request, MAX_REQUEST_BYTES);
    if (body.action !== 'save-scene') {
      return Response.json({ error: 'Unsupported director scene operation.' }, { status: 400 });
    }
    const nodeId = parseNodeId(body.nodeId);
    const saved = await saveDirectorScene({
      projectId: params.projectId,
      nodeId,
      scene: body.scene,
    });
    return Response.json({ saved: true, nodeId, ...saved });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: 'The director scene is too large.' }, { status: 413 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cannot save the director scene.' },
      { status: 400 }
    );
  }
}

export const Route = createFileRoute('/api/app/projects/$projectId/director')({
  server: { handlers: { GET, POST } },
});
