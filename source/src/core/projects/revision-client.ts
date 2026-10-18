import { apiJsonGet } from '@/lib/api-client';

export async function hasNewProjectRevision(
  projectId: string,
  surface: 'canvas',
  version: number | null
) {
  const revision = await apiJsonGet<{ canvas: number }>(
    `/api/app/projects/${encodeURIComponent(projectId)}/revision`
  );
  return revision[surface] !== null && (version === null || revision[surface]! > version);
}
