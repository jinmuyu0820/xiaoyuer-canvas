import { createFileRoute } from '@tanstack/react-router';
import { and, inArray } from 'drizzle-orm';
import { generationHistory } from '@/config/db/schema';
import { db } from '@/core/db';
import { getLocalDirectories, saveLocalDirectories } from '@/core/projects/local-directories';
import { getBeatDesignDataRoot } from '@/config/data-root';
import { respData, respErr } from '@/lib/resp';
import { validateTrustedLocalJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, MAX_WORKSPACE_JSON_REQUEST_BYTES } from '@/lib/request-body-limit';
async function GET() { return respData({ ...getLocalDirectories(), dataRoot: getBeatDesignDataRoot() }); }
async function POST({ request }: { request: Request }) {
  const trust = validateTrustedLocalJsonMutation(request);
  if (!trust.ok) return respErr(trust.message, trust.status);
  try {
    const body = await readRequestJsonWithLimit<Record<string, unknown>>(request, MAX_WORKSPACE_JSON_REQUEST_BYTES);
    for (const key of ['projectAssets','assetLibrary','exports']) if (typeof body[key] !== 'string') return respErr('All directory paths are required.', 400);
    const running = await (await db()).select({ id: generationHistory.id }).from(generationHistory).where(inArray(generationHistory.status, ['pending','processing'])).limit(1);
    if (running.length) return respErr('Wait for active generations before changing directories.',409);
    const next = await saveLocalDirectories({ projectAssets: body.projectAssets as string, assetLibrary: body.assetLibrary as string, exports: body.exports as string });
    return respData({ ...next, dataRoot: getBeatDesignDataRoot() });
  } catch (error) { return respErr(error instanceof Error ? error.message : 'Directory change failed.',400); }
}
export const Route = createFileRoute('/api/config/directories')({ server: { handlers: { GET, POST } } });
