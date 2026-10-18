import { readFile, stat } from 'node:fs/promises';

import {
  normalizeAssetFirstGenerationRequest,
  type AssetFirstGenerationRequest,
} from '@/core/commands/generation-contract';
import { compileAssetFirstGenerationInput } from '@/core/commands/generation-compiler';
import {
  claimGenerationUploadSlot,
  completeGenerationUploadSlot,
  failGenerationUploadIntent,
  issueGenerationUploadIntent,
  releaseGenerationUploadSlot,
  getGenerationUploadIntentEffectId,
} from '@/core/effects/generation-upload-intent';
import { submitEffectGeneration } from '@/core/effects/submit-generation';
import { resolveLocalProjectAssetPath } from '@/core/projects/local-project-assets';
import {
  getProjectAssetById,
  linkGenerationAsset,
} from '@/core/workspace-lib/assets/user-assets';
import { uploadManagedGenerationInput } from '@/core/workspace-storage/managed-generation-input';
import { getProject } from '@/core/projects/projects';
import { getGenerationPromptConstraints, validateGenerationPrompt } from '@/core/effects/validation';
import { getArkConfig } from '@/core/adapters/ark-adapter';
import { getConfig } from '@/modules/config/service';
import { resolveConnection } from './connection-store';

async function referenceDeliveryPolicy(generation:AssetFirstGenerationRequest) {
  const ark = getActiveGenerationProvider().id === 'ark';
  const demo = ark && generation.mode==='video' && (await getArkConfig(typeof generation.parameters.connectionId==='string'?generation.parameters.connectionId:undefined)).demo;
  const profile=ark?await resolveConnection(generation.mode==='image'?'image':'video',typeof generation.parameters.connectionId==='string'?generation.parameters.connectionId:undefined):null;
  const remoteMedia=(type:string)=>!ark||!demo&&(type==='video'||profile?.protocol==='wan-video'&&type==='audio');
  return {
    needsUpload: (asset: { type: string; publicUrl: string; source: string; metadata: unknown }) =>
      remoteMedia(asset.type) && needsManagedGenerationReferenceUpload(asset),
    providerUrl: (asset: { type: string; publicUrl: string; source: string; metadata: unknown }) =>
      remoteMedia(asset.type) ? getProviderGenerationAssetUrl(asset) : null,
    ark,
    demo,
    profile,
  };
}

import {
  getGenerationModelDescriptor,
  validateGenerationModelInput,
} from './model-catalog';
import {
  getActiveGenerationProvider,
  getGenerationModelBinding,
} from './registry';
import {
  getProviderGenerationAssetUrl,
  needsManagedGenerationReferenceUpload,
} from './reference-delivery';

const getReferenceContentType = (asset: {
  type: 'image' | 'video' | 'audio';
  mimeType: string | null;
}) => {
  if (asset.mimeType?.trim()) return asset.mimeType.split(';')[0].trim();
  if (asset.type === 'video') return 'video/mp4';
  if (asset.type === 'audio') return 'audio/mpeg';
  return 'image/png';
};

async function prepareGenerationReferences({
  generation,
  intentId,
}: {
  generation: AssetFirstGenerationRequest;
  intentId: string;
}) {
  const assets = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof getProjectAssetById>>>
  >();
  for (const reference of generation.references) {
    if (assets.has(reference.assetId)) continue;
    const asset = await getProjectAssetById({
      projectId: generation.projectId,
      assetId: reference.assetId,
    });
    if (!asset) {
      throw new Error(
        `Asset ${reference.assetId} does not belong to this project.`
      );
    }
    assets.set(reference.assetId, asset);
  }

  const policy = await referenceDeliveryPolicy(generation);
  const localAssets = [...assets.values()].filter(policy.needsUpload);
  const deliveryUrls = new Map<string, string>();
  for (const asset of assets.values()) {
    const providerUrl = policy.providerUrl(asset);
    if (providerUrl) deliveryUrls.set(asset.id, providerUrl);
  }
  for (const asset of localAssets) {
    if (asset.storageProvider !== 'local') {
      throw new Error(
        `Asset ${asset.id} does not have a public delivery URL or a readable local file.`
      );
    }
    const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      throw new Error(`Local file for asset ${asset.id} is unavailable.`);
    }
    const slotId = await claimGenerationUploadSlot({
      intentId,
      projectId: generation.projectId,
    });
    if (!slotId) {
      throw new Error('Generation upload authorization is invalid or expired.');
    }
    try {
      const contentType = getReferenceContentType(asset);
      const bytes = await readFile(filePath);
      const body = new Blob([bytes], { type: contentType });
      const uploaded = await uploadManagedGenerationInput({
        body,
        filename: asset.filename || `${asset.id}.${asset.type}`,
        contentType,
      });
      const completed = await completeGenerationUploadSlot({
        intentId,
        upload: {
          slotId,
          provider: uploaded.provider,
          bucket: uploaded.bucket,
          key: uploaded.key,
          url: uploaded.url,
          filename: asset.filename || `${asset.id}.${asset.type}`,
          mimeType: contentType,
          sizeBytes: body.size,
        },
      });
      if (!completed) {
        throw new Error(
          'Generation upload authorization expired before completion.'
        );
      }
      deliveryUrls.set(asset.id, uploaded.url);
    } catch (error) {
      await releaseGenerationUploadSlot({ intentId, slotId }).catch(
        () => undefined
      );
      throw error;
    }
  }

  return {
    generation: {
      ...generation,
      references: generation.references.map((reference) => ({
        ...reference,
        ...(deliveryUrls.has(reference.assetId)
          ? { deliveryUrl: deliveryUrls.get(reference.assetId) }
          : {}),
      })),
    },
    authorizedDeliveryUrls: [...deliveryUrls.values()],
  };
}

export async function preflightAssetFirstGeneration(source: unknown) {
  const generation = normalizeAssetFirstGenerationRequest(source);
  const project = await getProject({ projectId: generation.projectId });
  if (!project || project.status !== 'active') throw new Error('Project not found');
  const provider = getActiveGenerationProvider();
  const binding = getGenerationModelBinding({
    modelId: generation.modelId,
    providerId: provider.id,
  });
  if (!binding) {
    throw new Error(
      `Model ${generation.modelId} is not available from ${provider.label}.`
    );
  }
  const descriptor = getGenerationModelDescriptor(generation.modelId);
  if (!descriptor || descriptor.kind !== generation.mode) {
    throw new Error(
      `Model ${generation.modelId} does not support ${generation.mode} generation.`
    );
  }
  const prompt = validateGenerationPrompt(generation.prompt, getGenerationPromptConstraints({ modelId: generation.modelId }));
  if (!prompt.ok) throw new Error(prompt.code === 'PROMPT_TOO_LONG' ? `Prompt must be ${prompt.maxChars} characters or fewer.` : 'Prompt is required.');
  const uniqueAssets = new Map<
    string,
    Awaited<ReturnType<typeof getProjectAssetById>>
  >();
  for (const reference of generation.references) {
    if (!uniqueAssets.has(reference.assetId)) {
      uniqueAssets.set(
        reference.assetId,
        await getProjectAssetById({
          projectId: generation.projectId,
          assetId: reference.assetId,
        })
      );
    }
  }
  const policy = await referenceDeliveryPolicy(generation);
  const expectedUploadCount = [...uniqueAssets.values()].filter(
    (asset) => asset && policy.needsUpload(asset)
  ).length;
  const validationUrls: string[] = [];
  for (const [assetId, asset] of uniqueAssets) {
    if (!asset) throw new Error(`Asset ${assetId} does not belong to this project.`);
    if (policy.ark && !policy.demo && policy.needsUpload(asset) && await getConfig('WORKSPACE_STORAGE_MODE') !== 's3') {
      throw new Error('此协议的参考视频（Wan 还包括音频）需要公网地址。请在设置中配置自己的 TOS/S3 素材传输存储。');
    }
    if (asset.storageProvider === 'local') {
      const file = await stat(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }));
      if (!file.isFile()) throw new Error(`Local file for asset ${assetId} is unavailable.`);
      if (policy.ark && !policy.demo) {
        const wan=policy.profile?.protocol==='wan-video',mini=policy.profile?.protocol?.startsWith('minimax-video');
        const max = (asset.type === 'image' ? wan?20:30 : asset.type === 'audio' ? 15 : mini?50:wan?100:200) * 1024 * 1024;
        if (file.size >= max) throw new Error('参考素材超过方舟大小限制。');
        if (asset.type!=='image'&&asset.durationMs && (asset.durationMs < (wan?1000:2000) || asset.durationMs > (wan||mini?15000:30000))) throw new Error(`参考视频和音频时长必须在 ${wan?'1':2}–${wan||mini?15:30} 秒之间。`);
        if (asset.type === 'video' && (generation.parameters.seedanceSettings as { taskMode?: string } | undefined)?.taskMode === 'edit' && asset.durationMs && asset.durationMs < 4000) throw new Error('视频编辑的原视频必须至少 4 秒。');
        if (asset.type === 'audio' && !['audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(asset.mimeType ?? '')) throw new Error('方舟音频参考仅支持 MP3 或 WAV。');
        if (asset.type === 'video' && !['video/mp4', 'video/quicktime'].includes(asset.mimeType ?? '')) throw new Error('方舟视频参考仅支持 MP4 或 MOV。');
      }
    } else if (policy.needsUpload(asset)) {
      if (asset.storageProvider !== 'local') throw new Error(`Asset ${assetId} is unavailable.`);
      const file = await stat(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }));
      if (!file.isFile()) throw new Error(`Local file for asset ${assetId} is unavailable.`);
    }
  }
  if (policy.ark && !policy.demo) {
    for (const kind of ['video', 'audio']) {
      const total = [...uniqueAssets.values()].reduce((sum, asset) => sum + (asset?.type === kind ? asset.durationMs ?? 0 : 0), 0);
      const limited=policy.profile?.protocol!=='ark-video';
      if (total > (limited?15000:30000)) throw new Error(`参考${kind === 'video' ? '视频' : '音频'}总时长不能超过 ${limited?15:30} 秒。`);
      if(kind==='video'&&policy.profile?.protocol==='wan-video'&&parseInt(String(generation.parameters.wmDuration),10)>0&&total+parseInt(String(generation.parameters.wmDuration),10)*1000>30000)throw new Error('Wan 3 的输入视频与输出视频总时长不能超过 30 秒。');
    }
  }
  // Validation uses inert URLs; no file leaves the workspace during preflight.
  const validationRequest = {
    ...generation,
    references: generation.references.map((reference, index) => {
      const asset = uniqueAssets.get(reference.assetId)!;
      const extension = asset.type === 'video' ? 'mp4' : asset.type === 'audio' ? 'mp3' : 'png';
      const deliveryUrl = `https://validation.invalid/reference-${index}.${extension}`;
      validationUrls.push(deliveryUrl);
      return { ...reference, deliveryUrl };
    }),
  };
  const input = await compileAssetFirstGenerationInput({ generation: validationRequest, generationIntentId: '', authorizedDeliveryUrls: validationUrls });
  const validated=validateGenerationModelInput({ modelId: generation.modelId, input });
  await provider.assertConfigured?.(validated.effect,input);
  return { generation, binding, expectedUploadCount };
}

export async function createAssetFirstGenerationIntent(source: unknown) {
  const prepared = await preflightAssetFirstGeneration(source);
  return issueGenerationUploadIntent({
    projectId: prepared.generation.projectId,
    effectId: prepared.binding.effectId,
    expectedUploadCount: prepared.expectedUploadCount,
  });
}

export async function submitAssetFirstGeneration({
  generation: source,
  origin,
  generationIntentId,
}: {
  generation: AssetFirstGenerationRequest | unknown;
  origin: 'ui' | 'mcp' | 'cli' | 'system';
  generationIntentId?: string;
}) {
  const { generation, binding, expectedUploadCount } = await preflightAssetFirstGeneration(source);
  const intentId = generationIntentId || await issueGenerationUploadIntent({
    projectId: generation.projectId,
    effectId: binding.effectId,
    expectedUploadCount,
  });
  if (await getGenerationUploadIntentEffectId({ intentId, projectId: generation.projectId }) !== binding.effectId) {
    throw new Error('Generation authorization does not match this project and model.');
  }
  try {
    const prepared = await prepareGenerationReferences({
      generation,
      intentId,
    });
    const input = await compileAssetFirstGenerationInput({
      generation: prepared.generation,
      generationIntentId: intentId,
      authorizedDeliveryUrls: prepared.authorizedDeliveryUrls,
    });
    validateGenerationModelInput({ modelId: generation.modelId, input });
    const result = await submitEffectGeneration({
      effectId: binding.effectId,
      input,
      projectId: generation.projectId,
      generationIntentId: intentId,
      authorizedReferenceUrls: prepared.authorizedDeliveryUrls,
      metadata: {
        origin,
        requestVersion: generation.version,
        logicalModelId: generation.modelId,
      },
    });
    const generationId =
      typeof result.body.wmTaskId === 'string' ? result.body.wmTaskId : null;
    if (result.status < 400 && generationId) {
      for (const assetId of new Set(
        generation.references.map((reference) => reference.assetId)
      )) {
        await linkGenerationAsset({
          generationId,
          assetId,
          role: 'input',
        });
      }
    }
    return result;
  } catch (error) {
    await failGenerationUploadIntent({ intentId });
    throw error;
  }
}
