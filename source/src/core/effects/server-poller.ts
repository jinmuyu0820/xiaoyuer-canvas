import { asc, inArray } from 'drizzle-orm';
import { generationHistory } from '@/config/db/schema';
import { syncGeneration } from '@/core/effects/generation-sync';
import { EFFECTS_POLL_INTERVAL_MS } from '@/core/effects/runtime-config';
import { getDb } from '@/core/workspace-lib/db-adapter';

const activePollers = new Set<string>();
const scheduledPollers = new Map<string, ReturnType<typeof setTimeout>>();
const lastQuerySyncAt = new Map<string, number>();

/** A status read may force one sync, but not more often than the client polls. */
export const syncGenerationForStatusQuery = async ({
  wmTaskId,
  effectId,
}: {
  wmTaskId: string;
  effectId: number;
}) => {
  const now = Date.now();
  if (now - (lastQuerySyncAt.get(wmTaskId) ?? 0) < 5_000) {
    return null;
  }
  lastQuerySyncAt.set(wmTaskId, now);
  return syncGeneration({ wmTaskId, effectId, minIntervalMs: 5_000 });
};

export function stopBackendPollingForGeneration(wmTaskId: string) {
  activePollers.delete(wmTaskId);
  const timer = scheduledPollers.get(wmTaskId);
  if (timer) clearTimeout(timer);
  scheduledPollers.delete(wmTaskId);
}

export type DueGenerationStatusPassResult = {
  checked: number;
  succeeded: number;
  failed: number;
};

export async function runGenerationStatusPass({
  wmTaskId,
  effectId,
}: {
  wmTaskId: string;
  effectId: number;
}) {
  return syncGeneration({ wmTaskId, effectId });
}

export async function runDueGenerationStatusPasses({ limit = 25 } = {}) {
  const db = await getDb();
  const rows = await db
    .select({ id: generationHistory.id, effectId: generationHistory.effectId })
    .from(generationHistory)
    .where(inArray(generationHistory.status, ['pending', 'processing']))
    .orderBy(asc(generationHistory.createdAt))
    .limit(limit);
  const result: DueGenerationStatusPassResult = { checked: 0, succeeded: 0, failed: 0 };
  for (const row of rows) {
    const synced = await syncGeneration({ wmTaskId: row.id, effectId: row.effectId });
    result.checked += 1;
    if (synced.ok && synced.generation.status === 'succeeded') result.succeeded += 1;
    if (!synced.ok || (synced.ok && synced.generation.status === 'failed')) result.failed += 1;
  }
  return result;
}

export function startBackendPollingForGeneration({
  wmTaskId,
  effectId,
}: {
  wmTaskId: string;
  effectId: number;
}) {
  if (activePollers.has(wmTaskId)) return;
  activePollers.add(wmTaskId);
  const poll = async () => {
    scheduledPollers.delete(wmTaskId);
    if (!activePollers.has(wmTaskId)) return;
    try {
      const result = await syncGeneration({ wmTaskId, effectId });
      if (!result.ok || result.generation.status === 'succeeded' || result.generation.status === 'failed') {
        stopBackendPollingForGeneration(wmTaskId);
        return;
      }
    } catch (cause) {
      console.error('generation poll error:', cause);
    }
    if (activePollers.has(wmTaskId)) schedule();
  };
  const schedule = () => {
    const timer = setTimeout(poll, EFFECTS_POLL_INTERVAL_MS);
    timer.unref();
    scheduledPollers.set(wmTaskId, timer);
  };
  schedule();
}
