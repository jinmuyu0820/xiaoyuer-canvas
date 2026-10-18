import { createFileRoute } from '@tanstack/react-router';
import { getGenerationById } from '@/core/effects/record-generation';
import {
  startBackendPollingForGeneration,
  syncGenerationForStatusQuery,
} from '@/core/effects/server-poller';

async function GET({ request }: { request: Request }) {
  const params = new URL(request.url).searchParams;
  const wmTaskId = params.get('wmTaskId');
  if (!wmTaskId) {
    return Response.json({ error: 'Missing wmTaskId' }, { status: 400 });
  }
  try {
    let generation = await getGenerationById({ id: wmTaskId });
    if (!generation) return Response.json({ error: 'Task not found' }, { status: 404 });
    if (generation.status === 'pending' || generation.status === 'processing') {
      startBackendPollingForGeneration({ wmTaskId, effectId: generation.effectId });
      // The client asks every five seconds; a status read is the freshest
      // moment to sync, so a short demo task does not wait for the 20s pass.
      const synced = await syncGenerationForStatusQuery({
        wmTaskId,
        effectId: generation.effectId,
      });
      if (synced?.ok) generation = synced.generation;
    }
    return Response.json({
      success: generation.status === 'succeeded',
      wmTaskId,
      status: generation.status,
      output: generation.output,
      error: generation.status === 'failed' ? generation.error ?? 'Generation failed.' : null,
    });
  } catch (cause) {
    console.error('effects.status error:', cause);
    return Response.json({ error: 'Failed to query task status.' }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/effects/status')({
  server: { handlers: { GET } },
});
