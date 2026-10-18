import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isArkOutputUrl,ARK_BASE_URL } from '@/core/adapters/ark-contract';

import { resolveOutputMedia } from './output-media';
import { isOfficialBeatApiMediaUrl,isPublicHttpMediaUrl } from './beatapi-media-url';
import { getGenerationById } from './record-generation';
import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  persistLocalProjectAsset,
} from '@/core/projects/local-project-assets';
import {
  linkGenerationAsset,
  recordUserAsset,
  type AssetType,
} from '@/core/workspace-lib/assets/user-assets';
import { readResponseBodyWithLimit } from '@/lib/response-body-limit';

export const OUTPUT_STORAGE_SYNC_RETRY_ERROR = '';
export const didOutputStorageSyncFail = (output?: unknown) =>
  Boolean(
    output &&
      typeof output === 'object' &&
      (output as { storage_sync_failed?: unknown }).storage_sync_failed === true
  );
export const shouldRetryOutputStorageSync = (_input?: unknown) => false;

/**
 * Marks an output whose media could not be stored locally while keeping the
 * provider's own URLs.
 *
 * The provider already produced (and charged for) the media. Losing the response
 * just because the download or the local write failed would force the user to
 * generate it again, so the provider URL is kept and the failure is recorded on
 * the output instead.
 */
export const withOutputStorageFailure = (output: unknown, error: unknown) => ({
  ...(output && typeof output === 'object'
    ? (output as Record<string, unknown>)
    : {}),
  storage_sync_failed: true,
  storage_sync_error: error instanceof Error ? error.message : String(error),
});

/**
 * Stores the media locally, but never throws away a successful provider result.
 * Callers can therefore record `succeeded` in both cases.
 */
export async function persistOutputKeepingProviderResult(
  input: Parameters<typeof persistEffectOutputIfNeeded>[0]
) {
  try {
    return await persistEffectOutputIfNeeded(input);
  } catch (error) {
    return withOutputStorageFailure(input.output, error);
  }
}

export const MAX_LOCAL_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_LOCAL_VIDEO_ASSET_BYTES = 100 * 1024 * 1024;
export const LOCAL_MEDIA_DOWNLOAD_TIMEOUT_MS = 180_000;

const isLocalProjectAssetUrl = (url: string) =>
  url.startsWith('/api/app/projects/') && url.includes('/assets/');

export const createLocalProviderAssetId = (
  projectId: string,
  providerUrl: string
) =>
  createHash('sha256')
    .update(`${projectId}\0${providerUrl}`)
    .digest('hex');

const filenameFromUrl = (url: string, type: AssetType) => {
  if(url.startsWith('data:'))return url.startsWith('data:image/jpeg')?'generated-image.jpg':url.startsWith('data:image/webp')?'generated-image.webp':'generated-image.png';
  try {
    const filename = decodeURIComponent(
      new URL(url).pathname.split('/').pop() || ''
    );
    if (filename) return filename;
  } catch {
    // Fall through to a stable local filename.
  }
  return type === 'video' ? 'generated-video.mp4' : 'generated-image.png';
};

const replaceMediaUrls = (
  value: unknown,
  localUrlByProviderUrl: Map<string, string>
): unknown => {
  if (typeof value === 'string') {
    return localUrlByProviderUrl.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceMediaUrls(item, localUrlByProviderUrl));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      replaceMediaUrls(item, localUrlByProviderUrl),
    ])
  );
};

type OutputStoragePlanEntry = {
  url: string;
  type: AssetType;
  role: 'output' | 'thumbnail';
};

export const buildOutputStoragePlan = ({
  output,
  effectType,
}: {
  output: unknown;
  effectType: number;
}): OutputStoragePlanEntry[] => {
  if (effectType === 3) return [];
  const media = resolveOutputMedia(output);
  const mediaEntries = new Map<
    string,
    Omit<OutputStoragePlanEntry, 'url'>
  >();
  const appendMedia = (
    type: AssetType,
    role: OutputStoragePlanEntry['role'],
    values: Array<string | null>
  ) => {
    for (const url of values) {
      if (url && !mediaEntries.has(url)) mediaEntries.set(url, { type, role });
    }
  };
  if (effectType === 1) {
    appendMedia('video', 'output', [...media.videoUrls, media.resultUrl]);
    appendMedia('image', 'thumbnail', [...media.coverUrls, media.coverUrl]);
  } else {
    appendMedia(
      'image',
      'output',
      [...media.imageUrls, ...media.resultUrls, media.resultUrl]
    );
  }
  return [...mediaEntries.entries()].map(([url, entry]) => ({
    url,
    ...entry,
  }));
};

export async function persistEffectOutputIfNeeded({
  output,
  wmTaskId,
  effectId,
  effectType,
}: {
  output: unknown;
  wmTaskId: string;
  effectId: number;
  effectType: number;
}) {
  const storagePlan = buildOutputStoragePlan({ output, effectType });
  if (storagePlan.length === 0) return output;
  const media = resolveOutputMedia(output);
  const providerEntries = storagePlan.filter(
    ({ url }) => !isLocalProjectAssetUrl(url)
  );
  if (providerEntries.length === 0) return output;

  const generation = await getGenerationById({ id: wmTaskId, effectId });
  if (!generation?.projectId) {
    throw new Error('Generated media cannot be saved without a project');
  }

  const assetIds: string[] = [];
  const localUrlByProviderUrl = new Map<string, string>();

  for (const { url, type, role } of providerEntries) {
    const identity = (generation.input as { _provider?: { id?: string } } | null)?._provider?.id;
    const snapshot=(generation.input as {_connection?:{protocol:string;baseUrl:string}})?._connection;
    const imageProtocol=!!snapshot&&['compatible-images','gpt-images','gemini-images'].includes(snapshot.protocol);
    const inline=identity==='ark'&&effectType===2&&imageProtocol&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url);
    const configurable=identity==='ark'&&(imageProtocol||snapshot?.protocol&&snapshot.protocol!=='ark-video'||snapshot?.baseUrl&&snapshot.baseUrl!==ARK_BASE_URL);
    const demo = identity === 'ark' && (output as { demo?: boolean })?.demo === true && url === '/seedance-demo.mp4';
    if (!demo && !inline && !(configurable ? isPublicHttpMediaUrl(url) : identity === 'ark' ? isArkOutputUrl(url) : isOfficialBeatApiMediaUrl(url))) {
      throw new Error('Generated media URL is not an approved BeatAPI asset');
    }
    const response = inline?new Response(Buffer.from(url.split(',')[1],'base64'),{headers:{'content-type':url.slice(5,url.indexOf(';'))}}):demo ? new Response(await readFile(resolve(process.cwd(), 'public/seedance-demo.mp4')), { headers: { 'content-type': 'video/mp4' } }) : await fetch(url, {
      signal: AbortSignal.timeout(LOCAL_MEDIA_DOWNLOAD_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Failed to save generated media locally (${response.status})`);
    }

    const maxBytes =
      type === 'video'
        ? MAX_LOCAL_VIDEO_ASSET_BYTES
        : MAX_LOCAL_IMAGE_ASSET_BYTES;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error('Generated media is too large to save locally');
    }
    const bytes = await readResponseBodyWithLimit(response, maxBytes);
    const fallbackMimeType = type === 'video' ? 'video/mp4' : 'image/png';
    const responseMimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    const mimeType = responseMimeType.startsWith(`${type}/`)
      ? responseMimeType
      : fallbackMimeType;
    const persisted = await persistLocalProjectAsset({
      projectId: generation.projectId,
      assetId: createLocalProviderAssetId(generation.projectId, url),
      filename: filenameFromUrl(url, type),
      mimeType,
      bytes,
    });
    const assetId = await recordUserAsset({
      id: persisted.assetId,
      type,
      source: 'provider',
      storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
      bucket: LOCAL_PROJECT_ASSET_BUCKET,
      objectKey: persisted.objectKey,
      publicUrl: persisted.publicUrl,
      filename: persisted.filename,
      mimeType,
      sizeBytes: persisted.sizeBytes,
      sha256: persisted.sha256,
      originProjectId: generation.projectId,
      metadata: {
        effectId,
        generationId: wmTaskId,
        providerUrl: inline?null:url,
      },
    });
    await linkGenerationAsset({ generationId: wmTaskId, assetId, role });
    assetIds.push(assetId);
    localUrlByProviderUrl.set(url, persisted.publicUrl);
  }

  if (!output || typeof output !== 'object' || assetIds.length === 0) {
    return output;
  }
  const localizedOutput = replaceMediaUrls(
    output,
    localUrlByProviderUrl
  ) as Record<string, unknown>;
  const providerResultUrl = media.resultUrl?.startsWith('data:')?null:media.resultUrl;
  return {
    ...localizedOutput,
    ...(media.resultUrl
      ? {
          ...(providerResultUrl?{provider_result_url:providerResultUrl}:{}),
          stored_result_url:
            localUrlByProviderUrl.get(media.resultUrl) ?? media.resultUrl,
        }
      : {}),
    provider_result_urls: providerEntries.map(({ url }) => url).filter(url=>!url.startsWith('data:')),
    assetIds,
    storage_sync_failed: false,
  };
}
