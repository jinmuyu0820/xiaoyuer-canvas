import {
  isCanvasFolderCard,
  type CanvasCard,
  type CanvasFolderCard,
} from '@/core/beatcanvas/canvas-types';

import { planCanvasFolderCreation } from '@/core/beatcanvas/folders';
import type { ProjectSnapshotDocument } from './project-snapshot';

/**
 * Canvas levels (a folder is a subproject).
 *
 * A folder is not a backdrop any more: it is an icon that opens its own canvas.
 * Every card is drawn on exactly one level, decided by its `folderId` — `null`
 * is the top level, a folder id is that subproject. Folder cards carry a
 * `folderId` too, which is the level the icon itself lives on, so nesting is a
 * plain parent chain and needs no second table.
 *
 * Levels are only a *view*. The card collection always holds every level, so
 * saving, the asset page and MCP never see a partial project. That is why there
 * is no "merge the level back" step anywhere in the save path: the one document
 * that was captured is already the whole project.
 */

/** Subprojects can be nested once: top level → level 1 → level 2. */
export const MAX_CANVAS_FOLDER_DEPTH = 2;

export type CanvasLevelId = string | null;

export const cardLevelId = (card: Pick<CanvasCard, 'folderId'>): CanvasLevelId =>
  card.folderId ?? null;

export const filterLevelCards = <TCard extends CanvasCard>(
  cards: readonly TCard[],
  levelId: CanvasLevelId
): TCard[] => cards.filter((card) => cardLevelId(card) === levelId);

const cardsByIdOf = (cards: readonly CanvasCard[]) =>
  new Map(cards.map((card) => [card.id, card] as const));

export type CanvasFolderChain = {
  /** Number of folder cards walked up from the given id. */
  depth: number;
  /** The chain points at a card that is not a folder. */
  dangling: boolean;
  /** The chain loops back on itself: the level is unreachable. */
  cyclic: boolean;
};

/**
 * Walks a folder's parent chain. Corruption (a missing parent, a card that is
 * not a folder, a loop) is reported instead of silently truncated: a snapshot
 * that contains one of those would otherwise hide cards on a level that no
 * breadcrumb can reach.
 */
export const inspectFolderChain = (
  cards: readonly CanvasCard[],
  folderId: CanvasLevelId
): CanvasFolderChain => {
  const result: CanvasFolderChain = {
    depth: 0,
    dangling: false,
    cyclic: false,
  };
  if (!folderId) return result;
  const byId = cardsByIdOf(cards);
  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current) {
    const card = byId.get(current);
    if (!isCanvasFolderCard(card)) {
      result.dangling = true;
      return result;
    }
    if (seen.has(current)) {
      result.cyclic = true;
      return result;
    }
    seen.add(current);
    result.depth += 1;
    if (result.depth > MAX_CANVAS_FOLDER_DEPTH + 1) {
      // Deeper than anything the app can produce: treat as a loop.
      result.cyclic = true;
      return result;
    }
    current = card.folderId ?? null;
  }
  return result;
};

/**
 * How deeply the given folder is nested: 1 for a folder on the top level, 2 for
 * a folder inside another folder. 0 means "not a folder" (or unknown id).
 */
export const resolveFolderDepth = (
  cards: readonly CanvasCard[],
  folderId: CanvasLevelId
): number => inspectFolderChain(cards, folderId).depth;

/**
 * Whether a new subproject may be created *inside* the given level. A level is
 * addressed by the folder that owns it, so the top level asks with `null`.
 */
export const canCreateFolderIn = (
  cards: readonly CanvasCard[],
  levelId: CanvasLevelId
): boolean => {
  if (!levelId) return true;
  const chain = inspectFolderChain(cards, levelId);
  if (chain.dangling || chain.cyclic) return false;
  return chain.depth < MAX_CANVAS_FOLDER_DEPTH;
};

/** Root first, ending with the folder that owns `levelId`. Empty at top level. */
export const resolveFolderTrail = (
  cards: readonly CanvasCard[],
  levelId: CanvasLevelId
): CanvasFolderCard[] => {
  const byId = cardsByIdOf(cards);
  const trail: CanvasFolderCard[] = [];
  const seen = new Set<string>();
  let current = levelId;
  while (current && !seen.has(current)) {
    const card = byId.get(current);
    if (!isCanvasFolderCard(card)) break;
    seen.add(current);
    trail.unshift(card);
    current = card.folderId ?? null;
  }
  return trail;
};

/**
 * Nodes drawn on one level: what the icon's "N nodes" badge counts.
 *
 * Result cards are not their own nodes — they are pinned inside the generation
 * node that produced them — so they are not counted.
 */
export const countLevelCards = (
  cards: readonly CanvasCard[],
  levelId: CanvasLevelId
) =>
  filterLevelCards(cards, levelId).filter((card) => card.kind !== 'output')
    .length;

export const countLevelSubfolders = (
  cards: readonly CanvasCard[],
  levelId: CanvasLevelId
) =>
  filterLevelCards(cards, levelId).filter((card) => isCanvasFolderCard(card))
    .length;

/**
 * The part of a project document that belongs to one level.
 *
 * Used to draw the canvas: shapes are created only for the cards of the level
 * being shown. Frames of other levels are dropped here on purpose — they are
 * kept in the document (and in the adapter's frame cache) untouched.
 */
export const buildLevelDocument = (
  document: ProjectSnapshotDocument,
  levelId: CanvasLevelId
): ProjectSnapshotDocument => {
  const cards = filterLevelCards(document.cards, levelId);
  const frames = cards.reduce<ProjectSnapshotDocument['frames']>(
    (accumulator, card) => {
      const frame = document.frames[card.id];
      if (frame) accumulator[card.id] = frame;
      return accumulator;
    },
    {}
  );
  return {
    version: 3,
    cards,
    frames,
    ...(document.camera ? { camera: document.camera } : {}),
    ...(document.workflows ? { workflows: document.workflows } : {}),
  };
};

export type CanvasFolderDissolveUpdate = {
  cardId: string;
  folderId: string | null;
};

/**
 * Deleting a subproject keeps its content: the icon disappears and everything
 * that lived inside moves up one level. Nested subprojects move with it, so a
 * delete never loses cards.
 */
export const planFolderDissolve = ({
  cards,
  folderId,
}: {
  cards: readonly CanvasCard[];
  folderId: string;
}): { updates: CanvasFolderDissolveUpdate[]; cardIdsToDelete: string[] } => {
  const folder = cardsByIdOf(cards).get(folderId);
  if (!isCanvasFolderCard(folder)) {
    return { updates: [], cardIdsToDelete: [] };
  }
  const parentLevel = folder.folderId ?? null;
  const updates = cards
    .filter((card) => card.folderId === folderId)
    .map((card) => ({ cardId: card.id, folderId: parentLevel }));
  return { updates, cardIdsToDelete: [folderId] };
};

/**
 * The same rule for deletions that do not go through the icon's own menu
 * (Delete key, a mixed selection, MCP `remove_card`).
 *
 * Every direct member of a removed folder is re-parented to the nearest
 * surviving ancestor folder, so removing `F2` inside `F1` keeps its cards in
 * `F1` instead of dropping them at the top level.
 */
export const planFolderRemovalReparent = ({
  cards,
  removedCardIds,
}: {
  cards: readonly CanvasCard[];
  removedCardIds: readonly string[];
}): CanvasFolderDissolveUpdate[] => {
  const removed = new Set(removedCardIds);
  if (removed.size === 0) return [];
  const byId = cardsByIdOf(cards);
  const updates: CanvasFolderDissolveUpdate[] = [];
  for (const card of cards) {
    const folderId = card.folderId;
    if (!folderId || !removed.has(folderId)) continue;
    let ancestor = byId.get(folderId)?.folderId ?? null;
    const seen = new Set<string>();
    while (ancestor && removed.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = byId.get(ancestor)?.folderId ?? null;
    }
    updates.push({ cardId: card.id, folderId: ancestor ?? null });
  }
  return updates;
};

/**
 * Cross-level links are not a thing: a subproject is self-contained.
 *
 * Memberships can change outside the canvas (a command that moves a card into a
 * subproject, or one that points a node at a card on another level). The canvas
 * only draws one level, so such a link would be invisible while still feeding
 * the next generation. Run this once a whole command batch has been applied, so
 * a batch that moves both ends together is not broken up.
 */
export const sanitizeCrossLevelLinks = (
  cards: readonly CanvasCard[]
): CanvasCard[] => {
  const levelByCardId = new Map(
    cards.map((card) => [card.id, card.folderId ?? null] as const)
  );
  return cards.map((card) => {
    const level = card.folderId ?? null;
    const referenceCardIds = card.referenceCardIds.filter(
      (referenceCardId) => levelByCardId.get(referenceCardId) === level
    );
    const sourceTextCardId = card.sourceTextCardId ?? null;
    const textSourceKept =
      sourceTextCardId !== null &&
      levelByCardId.get(sourceTextCardId) === level;
    const referencesChanged =
      referenceCardIds.length !== card.referenceCardIds.length;
    if (!referencesChanged && (textSourceKept || sourceTextCardId === null)) {
      return card;
    }
    return {
      ...card,
      referenceCardIds,
      sourceTextCardId: textSourceKept ? sourceTextCardId : null,
    } as CanvasCard;
  });
};

/**
 * Dropping a node onto a subproject icon moves it inside.
 *
 * Same rule as grouping a selection into a folder: the node becomes
 * self-contained, so its links that would cross the new boundary are cut.
 */
export const planCardAdoptionIntoFolder = ({
  cards,
  folderId,
  cardId,
}: {
  cards: readonly CanvasCard[];
  folderId: string;
  cardId: string;
}) => planCanvasFolderCreation({ cards, folderId, memberIds: [cardId] });

/** Direct children of a level, folders included: what "move to" lists. */
export const listLevelFolders = (
  cards: readonly CanvasCard[],
  levelId: CanvasLevelId
): CanvasFolderCard[] =>
  filterLevelCards(cards, levelId).filter(
    (card): card is CanvasFolderCard => isCanvasFolderCard(card)
  );

/**
 * Level of the card a new card was derived from.
 *
 * `found:false` means "there is nothing to derive from", and the caller falls
 * back to the level that is open. A resolved `null` is the top level and must be
 * kept as such: a tail frame taken from a top-level video belongs to the top
 * level even if the user has entered a subproject while it was processing.
 */
export const resolveSourceLevel = (
  cards: readonly CanvasCard[] | Record<string, CanvasCard>,
  card: Pick<CanvasCard, 'sourceConfigCardId' | 'referenceCardIds'>
): { found: boolean; levelId: CanvasLevelId } => {
  const lookup = Array.isArray(cards)
    ? cardsByIdOf(cards)
    : new Map(Object.entries(cards as Record<string, CanvasCard>));
  const sourceIds = [card.sourceConfigCardId, ...(card.referenceCardIds ?? [])];
  for (const sourceId of sourceIds) {
    if (!sourceId) continue;
    const source = lookup.get(sourceId);
    if (source) return { found: true, levelId: source.folderId ?? null };
  }
  return { found: false, levelId: null };
};
