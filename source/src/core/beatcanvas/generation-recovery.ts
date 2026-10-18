import {
  isCanvasDraftCard,
  isCanvasOutputCard,
  type CanvasCard,
} from '@/core/beatcanvas/canvas-types';

/**
 * Whether a failed resume/poll should release the generation node.
 *
 * A generation node stays busy (`pending`/`processing`) while one of its runs is
 * in flight. When a run fails the node has to become usable again, but only if
 * no *other* run of the same node is still going — otherwise a failed second run
 * would unlock a node whose first run is still producing.
 */
export const shouldUnlockGenerationAfterRunFailure = ({
  cards,
  draftCardId,
  failedOutputCardId,
}: {
  cards: Record<string, CanvasCard> | readonly CanvasCard[];
  draftCardId: string;
  failedOutputCardId: string;
}): boolean => {
  const values = Array.isArray(cards)
    ? cards
    : Object.values(cards as Record<string, CanvasCard>);
  const draft = values.find((card) => card.id === draftCardId);
  if (!isCanvasDraftCard(draft)) return false;
  // Only a node that is actually stuck busy needs the release. A node that is
  // already idle (a submit failure handled its own state) must keep its error.
  if (draft.status !== 'pending' && draft.status !== 'processing') return false;

  return !values.some(
    (card) =>
      isCanvasOutputCard(card) &&
      card.sourceConfigCardId === draftCardId &&
      card.id !== failedOutputCardId &&
      (card.status === 'pending' || card.status === 'processing')
  );
};
