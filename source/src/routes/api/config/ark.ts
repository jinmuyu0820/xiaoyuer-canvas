import { createFileRoute } from '@tanstack/react-router';
import { ARK_BASE_URL } from '@/core/adapters/ark-contract';
import { arkRequest, getArkConfig } from '@/core/adapters/ark-adapter';
import { saveConfigs } from '@/modules/config/service';
import { mutateConnections,resolveConnection } from '@/core/generation-providers/connection-store';
import { maskApiKeyPreview } from '@/lib/mask-api-key';
import { respData, respErr } from '@/lib/resp';
import { validateTrustedLocalJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, MAX_WORKSPACE_JSON_REQUEST_BYTES } from '@/lib/request-body-limit';

async function GET() {
  const config = await getArkConfig();
  return respData({ baseUrl: ARK_BASE_URL, modelId: config.model, demo: config.demo, apiKeyConfigured: Boolean(config.apiKey), apiKeyPreview: config.apiKey ? maskApiKeyPreview(config.apiKey) : '' });
}
async function POST({ request }: { request: Request }) {
  const trust = validateTrustedLocalJsonMutation(request);
  if (!trust.ok) return respErr(trust.message, trust.status);
  try {
    const body = await readRequestJsonWithLimit<Record<string, unknown>>(request, MAX_WORKSPACE_JSON_REQUEST_BYTES);
    const official = await resolveConnection('video','seedance-official');
    const previous = {apiKey:official.apiKey,model:official.model,demo:official.demo};
    const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : previous.apiKey;
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : previous.model;
    if (!/^[\w.-]{1,200}$/.test(modelId)) return respErr('Invalid model or Endpoint ID', 400);
    if (body.action === 'test') {
      if (!key) return respErr('An Ark API key is required', 400);
      await arkRequest('/contents/generations/tasks?page_size=1', key);
      return respData({ connected: true });
    }
    const demo = typeof body.demo === 'boolean' ? body.demo : previous.demo;
    if (!demo && !key) return respErr('An Ark API key is required for real generation', 400);
    await saveConfigs({ ARK_MODEL_ID: modelId, ARK_DEMO_MODE: String(demo), ...(key ? { ARK_API_KEY: key } : {}) });
    await mutateConnections({action:'save',profile:{...official,model:modelId,demo,apiKey:key}});
    return respData({ baseUrl: ARK_BASE_URL, modelId, demo, apiKeyConfigured: Boolean(key), apiKeyPreview: key ? maskApiKeyPreview(key) : '' });
  } catch (error) { return respErr(error instanceof Error ? error.message : 'Could not save Ark configuration', 400); }
}
export const Route = createFileRoute('/api/config/ark')({ server: { handlers: { GET, POST } } });
