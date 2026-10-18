import { parseLocalProjectAssetUrl } from './local-project-asset-url';
import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';
import type { ProjectSnapshotDocument } from './project-snapshot';
export async function assertSnapshotAssetsBelongToProject(projectId:string,document:ProjectSnapshotDocument) {
  const checked=new Set<string>();
  for(const card of document.cards) {
    const local=parseLocalProjectAssetUrl(card.url);
    if(local&&local.projectId!==projectId) throw new Error('A Canvas file belongs to a different project.');
    const assetId=card.assetId||local?.assetId;
    if(!assetId||checked.has(assetId))continue;
    if(!await getProjectAssetById({projectId,assetId}))throw new Error('A Canvas asset belongs to a different project or is unavailable.');
    checked.add(assetId);
  }
}
