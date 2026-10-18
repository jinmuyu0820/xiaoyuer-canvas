import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import { BeatDesignCommandError } from './contracts';
import type { BeatDesignCommand } from './executor';

export async function normalizeCommandAssetReferences({ projectId, command }: {
  projectId: string; command: BeatDesignCommand;
}): Promise<BeatDesignCommand> {
  return { ...command, operations: await Promise.all(command.operations.map(async operation => {
    if (operation.type !== 'upsert_card') return operation;
    const { card } = operation;
    const local = parseLocalProjectAssetUrl(card.url);
    if (local && local.projectId !== projectId) throw new BeatDesignCommandError('NOT_FOUND', 'Asset does not belong to this project.');
    const assetId = card.assetId || local?.assetId;
    if (!assetId) return operation;
    const asset = await getProjectAssetById({ projectId, assetId });
    if (!asset) throw new BeatDesignCommandError('NOT_FOUND', `Asset ${assetId} does not belong to this project.`);
    const expected = card.type === 'timeline' ? 'video' : card.type;
    if (asset.type !== expected) throw new BeatDesignCommandError('INVALID_COMMAND', 'Asset media type does not match this card.');
    return { ...operation, card: { ...card, assetId, url: asset.publicUrl } };
  })) };
}
