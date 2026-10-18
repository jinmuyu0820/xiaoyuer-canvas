import { BaseAdapter } from './base-adapter';
import { ARK_BASE_URL, ARK_DEFAULT_MODEL, buildArkTaskRequest, normalizeArkTask,arkTaskProvenance } from './ark-contract';
import { readResponseJsonWithLimit } from '@/lib/response-body-limit';
import type { ConnectionSnapshot } from '@/core/generation-providers/connection-contract';

export async function getArkConfig(connectionId?:string,revision?:number) {
  const { resolveConnection } = await import('@/core/generation-providers/connection-store');
  const profile=await resolveConnection('video',connectionId,revision);
  return {
    apiKey:profile.apiKey,model:profile.model,demo:profile.demo,baseUrl:profile.baseUrl,
  };
}

export async function arkRequest(path: string, apiKey: string, body?: unknown, fetchImpl = fetch) {
  const response = await fetchImpl(`${ARK_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(body ? 120_000 : 30_000),
    redirect: 'error',
  });
  const payload = await readResponseJsonWithLimit(response, 1024 * 1024) as Record<string, any> | null;
  if (!response.ok) throw new Error(payload?.error?.message || `方舟请求失败（HTTP ${response.status}）。`);
  if (!payload || typeof payload !== 'object') throw new Error('方舟响应格式无效。');
  return payload;
}

export class ArkAdapter extends BaseAdapter {
  async createGeneration(input: unknown) {
    const {_connection,...source}=input as Record<string,unknown>&{_connection?:ConnectionSnapshot};
    const config = await getArkConfig(_connection?.id||typeof source.connectionId==='string'&&source.connectionId||undefined,_connection?.revision);
    const body = buildArkTaskRequest(source, config.model);
    if (config.demo) return { status: 'pending' as const, output: { taskId: `ark-demo-${Date.now()}-${crypto.randomUUID()}`, demo: true } };
    if (!config.apiKey) throw new Error('请先在设置中填写火山方舟 API Key。');
    const { resolveArkInputMedia } = await import('@/core/generation-providers/ark-media');
    for (const item of body.content) {
      for (const kind of ['image', 'video', 'audio'] as const) {
        const field = `${kind}_url`;
        const media = (item as Record<string, any>)[field];
        if (media) media.url = await resolveArkInputMedia(media.url, kind);
      }
    }
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * 1024 * 1024) throw new Error('参考素材转 Base64 后请求超过 64 MB，请减少素材或使用对象存储。');
    // Paid POST is deliberately sent once. A lost response is an unknown outcome.
    let task;
    try {
      const {resolveConnection}=await import('@/core/generation-providers/connection-store');
      const {requestConnection}=await import('@/core/generation-providers/connection-request');
      task = await requestConnection(await resolveConnection('video',_connection?.id||typeof source.connectionId==='string'&&source.connectionId||undefined,_connection?.revision),'/contents/generations/tasks',body);
    }
    catch (error) {
      if (error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) throw new Error('提交连接中断，方舟可能已接受任务。请在方舟控制台核对任务后再生成，避免重复计费。');
      throw error;
    }
    if (typeof task.id !== 'string' || !task.id) throw new Error('提交返回中缺少任务 ID，请在方舟控制台核对后再试。');
    return { status: 'pending' as const, output: { taskId: task.id, upstreamModelId: config.model,...arkTaskProvenance(task,config.apiKey) } };
  }

  async checkStatus(taskId: string,context?:unknown) {
    const demoId = /^ark-demo-(\d+)(?:-[\w-]+)?$/.exec(taskId);
    if (demoId) {
      const age = Date.now() - Number(demoId[1]);
      return age < 4000
        ? { status: 'processing' as const, output: { taskId, demo: true } }
        : { status: 'succeeded' as const, output: { taskId, demo: true, result_url: '/seedance-demo.mp4' } };
    }
    if (!/^[\w-]{1,200}$/.test(taskId)) throw new Error('任务 ID 无效。');
    const snapshot=context as ConnectionSnapshot|undefined;
    const config = await getArkConfig(snapshot?.id||'seedance-official',snapshot?.revision||1);
    if (!config.apiKey) throw new Error('请在设置中配置方舟 API Key，以继续查询任务。');
    const {resolveConnection}=await import('@/core/generation-providers/connection-store');
    const {requestConnection}=await import('@/core/generation-providers/connection-request');
    return normalizeArkTask(await requestConnection(await resolveConnection('video',snapshot?.id||'seedance-official',snapshot?.revision||1),`/contents/generations/tasks/${encodeURIComponent(taskId)}`),config.baseUrl!==ARK_BASE_URL,config.apiKey);
  }
}
