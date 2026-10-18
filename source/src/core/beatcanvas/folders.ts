import { isCanvasFolderCard, type CanvasCard } from './canvas-types';

export { isCanvasFolderCard };

/**
 * Canvas folders.
 *
 * A folder is a card (`kind: 'folder'`) that other cards point at through their
 * `folderId`. Membership is therefore a property of the card, not of geometry:
 * it survives a reload, it does not depend on React Flow parenting (which the
 * snapshot does not persist), and a card can be moved around freely while
 * staying in its folder.
 *
 * Assets follow their cards: every asset produced by a card inside a folder
 * belongs to that folder in the project asset view, whether it was produced
 * before or after the folder was created.
 */

export type CanvasFolderSummary = {
  id: string;
  name: string;
  /** Folder path from the top level, used as the chip label. */
  trail: string[];
  cardIds: string[];
  assetIds: string[];
};

/**
 * A folder is an icon on its parent level, so its frame keeps the position the
 * user put it at but not an arbitrary size.
 */
export const CANVAS_FOLDER_ICON_SIZE = { w: 208, h: 112 } as const;

/**
 * Folders of a project, with the assets each one owns. Used by the project
 * asset page, which only ever reads the canvas snapshot.
 */
export const summarizeCanvasFolders = (cards: readonly CanvasCard[]) => {
  const folders = new Map<string, CanvasFolderSummary>();
  for (const card of cards) {
    if (!isCanvasFolderCard(card)) continue;
    folders.set(card.id, {
      id: card.id,
      name: card.name,
      trail: [],
      cardIds: [],
      assetIds: [],
    });
  }

  // Names are only unique within a level, so the chip shows the whole path.
  const folderIdByCardId = new Map(
    cards.map((card) => [card.id, card.folderId ?? null] as const)
  );
  for (const folder of folders.values()) {
    const trail: string[] = [];
    const seen = new Set<string>();
    let current: string | null = folder.id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const card = folders.get(current);
      if (!card) break;
      trail.unshift(card.name);
      current = folderIdByCardId.get(current) ?? null;
    }
    folder.trail = trail;
  }

  const folderIdByAssetId: Record<string, string> = {};
  for (const card of cards) {
    const folderId = card.folderId;
    if (!folderId) continue;
    const folder = folders.get(folderId);
    if (!folder) continue;
    folder.cardIds.push(card.id);
    if (card.assetId) {
      folder.assetIds.push(card.assetId);
      folderIdByAssetId[card.assetId] = folderId;
    }
  }

  return {
    folders: [...folders.values()].sort((left, right) =>
      left.trail.join(' / ').localeCompare(right.trail.join(' / '))
    ),
    folderIdByAssetId,
  };
};

export type CanvasFolderCardUpdate = {
  cardId: string;
  folderId: string | null;
  referenceCardIds: string[];
  sourceTextCardId: string | null;
};

export type CanvasFolderLinkRemoval = {
  sourceCardId: string;
  targetCardId: string;
};

/**
 * Works out what has to change when cards become a folder.
 *
 * The rule the user asked for: once a folder exists, nothing inside it is
 * linked to anything outside it. References that cross the boundary are
 * dropped in both directions, so an inner node cannot consume an outer result
 * and an outer node cannot consume an inner one.
 */
export const planCanvasFolderCreation = ({
  cards,
  folderId,
  memberIds,
}: {
  cards: readonly CanvasCard[];
  folderId: string;
  memberIds: readonly string[];
}): {
  updates: CanvasFolderCardUpdate[];
  removals: CanvasFolderLinkRemoval[];
} => {
  const memberSet = new Set(memberIds);
  // A generation card's results live in separate output cards. Framing the
  // generation node must also gather what it already produced, otherwise the
  // folder would start empty for exactly the nodes that matter most.
  for (const card of cards) {
    if (
      card.kind === 'output' &&
      card.sourceConfigCardId &&
      memberSet.has(card.sourceConfigCardId)
    ) {
      memberSet.add(card.id);
    }
  }

  const updates: CanvasFolderCardUpdate[] = [];
  const removals: CanvasFolderLinkRemoval[] = [];
  const seenRemoval = new Set<string>();

  const pushRemoval = (sourceCardId: string, targetCardId: string) => {
    const key = `${sourceCardId}->${targetCardId}`;
    if (seenRemoval.has(key)) return;
    seenRemoval.add(key);
    removals.push({ sourceCardId, targetCardId });
  };

  for (const card of cards) {
    if (card.kind === 'folder') continue;
    const isMember = memberSet.has(card.id);
    const keptReferences = isMember
      ? card.referenceCardIds.filter((id) => memberSet.has(id))
      : card.referenceCardIds.filter((id) => !memberSet.has(id));
    const droppedReferences = card.referenceCardIds.filter(
      (id) => !keptReferences.includes(id)
    );
    for (const dropped of droppedReferences) {
      // A reference is an edge pointing from the referenced card to this card.
      pushRemoval(dropped, card.id);
    }

    // A text card feeding a member card is a boundary link as well — in both
    // directions: a card inside cannot take its text from outside, and a card
    // outside cannot take its text from inside. The link has to be cut, not just
    // hidden by the level view, or it reappears when the folder is dissolved.
    const textSourceCardId = card.sourceTextCardId ?? null;
    const textSourceIsMember = textSourceCardId
      ? memberSet.has(textSourceCardId)
      : false;
    const textCrossesBoundary =
      Boolean(textSourceCardId) && textSourceIsMember !== isMember;
    const sourceTextCardId = textCrossesBoundary ? null : textSourceCardId;
    if (textCrossesBoundary && textSourceCardId) {
      // A text source is an edge pointing from the text card to this card.
      pushRemoval(textSourceCardId, card.id);
    }

    const folderIdNext = isMember ? folderId : (card.folderId ?? null);
    const changed =
      folderIdNext !== (card.folderId ?? null) ||
      keptReferences.length !== card.referenceCardIds.length ||
      sourceTextCardId !== (card.sourceTextCardId ?? null);

    if (!changed) continue;
    updates.push({
      cardId: card.id,
      folderId: folderIdNext,
      referenceCardIds: keptReferences,
      sourceTextCardId,
    });
  }

  return { updates, removals };
};

/**
 * A card created from another card stays in the same folder. New results of a
 * node inside a folder must show up in that folder's asset list, which is the
 * whole point of grouping them.
 */
export const inheritFolderId = (
  cards: Record<string, CanvasCard> | readonly CanvasCard[],
  sourceCardIds: readonly (string | null | undefined)[]
): string | null => {
  const lookup = Array.isArray(cards)
    ? new Map(cards.map((card) => [card.id, card] as const))
    : new Map(Object.entries(cards as Record<string, CanvasCard>));
  for (const sourceId of sourceCardIds) {
    if (!sourceId) continue;
    const folderId = lookup.get(sourceId)?.folderId ?? null;
    if (folderId) return folderId;
  }
  return null;
};
