import type { CanvasAssetCard, CanvasCard } from '@/core/beatcanvas/canvas-types';
import { resolveCanvasPlacement } from '@/core/beatcanvas/upload-layout';
import {
  planFolderRemovalReparent,
  sanitizeCrossLevelLinks,
} from '@/core/projects/canvas-levels';
import {
  normalizeProjectSnapshotDocument,
  type ProjectSnapshotDocument,
  type ProjectSnapshotShapeFrame,
} from '@/core/projects/project-snapshot';

export type CanvasOperation =
  | { type: 'set_camera'; camera: ProjectSnapshotDocument['camera'] | null }
  | { type: 'set_workflow'; activeTemplate: NonNullable<ProjectSnapshotDocument['workflows']>['activeTemplate'] }
  | {
      type: 'upsert_card';
      card: CanvasCard;
      frame?: ProjectSnapshotShapeFrame;
    }
  | { type: 'remove_card'; cardId: string }
  | {
      type: 'move_card';
      cardId: string;
      frame: ProjectSnapshotShapeFrame;
    }
  | {
      type: 'place_card';
      cardId: string;
      sourceCardIds?: string[];
      side?: 'left' | 'right';
      offsetIndex?: number;
    }
  | {
      type: 'set_references';
      cardId: string;
      referenceCardIds: string[];
    }
;

export type CanvasCommandApplication = {
  document: ProjectSnapshotDocument;
  changedIds: string[];
};

export function applyCanvasOperations(
  source: ProjectSnapshotDocument,
  operations: readonly CanvasOperation[]
): CanvasCommandApplication {
  let cards = [...source.cards];
  let frames = { ...source.frames };
  let camera = source.camera;
  let workflows = source.workflows;
  const changedIds: string[] = [];

  for (const operation of operations) {
    if (operation.type === 'set_camera') {
      camera = operation.camera ?? undefined;
      continue;
    }
    if (operation.type === 'set_workflow') {
      workflows = { activeTemplate: operation.activeTemplate ?? null };
      continue;
    }
    if (operation.type === 'upsert_card') {
      const index = cards.findIndex((card) => card.id === operation.card.id);
      if (index < 0) cards.push(operation.card);
      else cards[index] = operation.card;
      if (operation.frame) {
        frames[operation.card.id] = operation.frame;
      }
      changedIds.push(operation.card.id);
      continue;
    }

    if (operation.type === 'remove_card') {
      if (!cards.some((card) => card.id === operation.cardId)) continue;
      // Deleting a subproject through a command keeps its cards: they move up to
      // the nearest surviving folder, exactly like the icon's own delete.
      const reparented = new Map(
        planFolderRemovalReparent({
          cards,
          removedCardIds: [operation.cardId],
        }).map((update) => [update.cardId, update.folderId] as const)
      );
      if (reparented.size > 0) {
        cards = cards.map((card) =>
          reparented.has(card.id)
            ? ({
                ...card,
                folderId: reparented.get(card.id) ?? null,
              } as CanvasCard)
            : card
        );
      }
      cards = cards.filter((card) => card.id !== operation.cardId);
      delete frames[operation.cardId];
      cards = cards.map((card) => ({
        ...card,
        referenceCardIds: card.referenceCardIds.filter(
          (referenceCardId) => referenceCardId !== operation.cardId
        ),
        sourceTextCardId:card.sourceTextCardId===operation.cardId?null:card.sourceTextCardId,
      }));
      changedIds.push(operation.cardId);
      continue;
    }

    if (operation.type === 'move_card') {
      if (!cards.some((card) => card.id === operation.cardId)) continue;
      frames[operation.cardId] = operation.frame;
      changedIds.push(operation.cardId);
      continue;
    }

    if (operation.type === 'place_card') {
      const card = cards.find((item) => item.id === operation.cardId);
      if (!card) continue;
      const currentFrame = frames[operation.cardId];
      const size = {
        w: currentFrame?.w ?? 360,
        h: currentFrame?.h ?? 260,
      };
      const sourceCardIds = operation.sourceCardIds ?? card.referenceCardIds;
      const sourceFrames = sourceCardIds.flatMap((cardId) => {
        const frame = frames[cardId];
        return frame ? [frame] : [];
      });
      const occupied = Object.entries(frames).flatMap(([cardId, frame]) =>
        cardId === operation.cardId ? [] : [frame]
      );
      const position = resolveCanvasPlacement({
        sourceFrames,
        occupied,
        size,
        offsetIndex: operation.offsetIndex,
        side: operation.side,
      });
      frames[operation.cardId] = { ...position, ...size };
      changedIds.push(operation.cardId);
      continue;
    }

    const cardIndex = cards.findIndex((card) => card.id === operation.cardId);
    if (cardIndex < 0) continue;
    const knownIds = new Set(cards.map((card) => card.id));
    cards[cardIndex] = {
      ...cards[cardIndex],
      referenceCardIds: Array.from(
        new Set(
          operation.referenceCardIds.filter(
            (referenceCardId) =>
              referenceCardId !== operation.cardId && knownIds.has(referenceCardId)
          )
        )
      ),
    } as CanvasCard;
    changedIds.push(operation.cardId);
  }

  return {
    document: normalizeProjectSnapshotDocument({
      ...source,
      // Only after the whole batch: a batch that moves both ends into the same
      // subproject must not have its links cut in the middle.
      cards: sanitizeCrossLevelLinks(cards),
      frames,
      camera,
      workflows,
    }),
    changedIds: Array.from(new Set(changedIds)),
  };
}
