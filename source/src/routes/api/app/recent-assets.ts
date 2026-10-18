import { createFileRoute } from '@tanstack/react-router';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { projectAssetMembership, userAsset } from '@/config/db/schema';
import { getActiveProject as getProject } from '@/core/projects/projects';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

async function GET({ request }: { request: Request }) {
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get('projectId')?.trim();
  if (!projectId) return Response.json({ error: 'projectId is required' }, { status: 400 });
  if (!await getProject({ projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  const requested = Number(searchParams.get('limit'));
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  const db = await getDb();
  const fields = { id:userAsset.id, publicUrl:userAsset.publicUrl, filename:userAsset.filename, width:userAsset.width, height:userAsset.height, durationMs:userAsset.durationMs, createdAt:userAsset.createdAt, mimeType:userAsset.mimeType, assetClass:userAsset.assetClass, metadata:userAsset.metadata };
  const list = (type:'image'|'video'|'audio') => db.selectDistinct(fields).from(userAsset).innerJoin(projectAssetMembership,eq(projectAssetMembership.assetId,userAsset.id))
    .where(and(eq(projectAssetMembership.projectId, projectId),eq(userAsset.type,type),isNotNull(userAsset.publicUrl))).orderBy(desc(userAsset.createdAt)).limit(limit + 1);
  const [images,videos,audios] = await Promise.all([list('image'),list('video'),list('audio')]);
  const hasMore = { images: images.length > limit, videos: videos.length > limit, audios: audios.length > limit };
  return Response.json({ images:images.slice(0,limit), videos:videos.slice(0,limit), audios:audios.slice(0,limit), hasMore });
}
export const Route = createFileRoute('/api/app/recent-assets')({server:{handlers:{GET}}});
