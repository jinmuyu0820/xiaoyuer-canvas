import { createFileRoute } from '@tanstack/react-router';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import {
  buildContentDisposition,
  generateDownloadFilename,
} from '@/core/projects/download-filename';
import { isSafeInlineUploadedMediaMimeType } from '@/core/effects/validation';
import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';
import { getProject } from '@/core/projects/projects';
import { loadProjectWithLatestSnapshot } from '@/core/projects/projects';

const parseByteRange = (header: string | null, size: number) => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
};

/**
 * Generate download filename from customFilename or fallback to "project-timestamp" format.
 * The rule lives in `@/core/projects/download-filename` so single downloads and
 * batch exports cannot drift apart.
 */

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; assetId: string };
}) {
  const asset = await getProjectAssetById(params);
  if (
    !asset ||
    asset.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER ||
    asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET
  ) {
    return Response.json({ error: 'Project asset not found' }, { status: 404 });
  }

  const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return Response.json({ error: 'Project asset file is missing' }, { status: 404 });
  }

  // Get project name and canvas snapshot to look up customFilename
  const projectData = await loadProjectWithLatestSnapshot({
    projectId: params.projectId,
  });
  if (!projectData) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Find customFilename from canvas cards by assetId
  const cards = projectData.snapshot.cards ?? [];
  const cardWithAsset = cards.find((card) => card.assetId === params.assetId);
  const customFilename = cardWithAsset?.customFilename ?? null;

  const safeInlineMimeType = isSafeInlineUploadedMediaMimeType(asset.mimeType)
    ? asset.mimeType
    : null;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    'content-type': safeInlineMimeType || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });

  // Set Content-Disposition with proper filename
  const filename = generateDownloadFilename({
    customFilename,
    projectName: projectData.project.name,
    mimeType: asset.mimeType,
  });
  // RFC 5987: the quoted fallback must stay ASCII or the header encoder throws.
  headers.set(
    'content-disposition',
    buildContentDisposition({ filename, inline: Boolean(safeInlineMimeType) })
  );

  const rangeHeader = request.headers.get('range');
  const range = parseByteRange(rangeHeader, fileStat.size);
  if (rangeHeader && !range) {
    headers.set('content-range', `bytes */${fileStat.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? fileStat.size - 1;
  headers.set('content-length', String(end - start + 1));
  if (range) {
    headers.set('content-range', `bytes ${start}-${end}/${fileStat.size}`);
  }
  const stream = Readable.toWeb(
    createReadStream(filePath, { start, end })
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: range ? 206 : 200,
    headers,
  });
}

export const Route = createFileRoute(
  '/api/app/projects/$projectId/assets/$assetId'
)({
  server: { handlers: { GET } },
});
