import type { WorkspaceModelOption } from '@/core/effects/workspace-models';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CanvasCard } from '@/core/beatcanvas/canvas-types';
import {
  resolveSourceLevel,
  type CanvasLevelId,
} from '@/core/projects/canvas-levels';

import { useBeatCanvasState } from './use-beatcanvas-state';
import { useBeatCanvasReactFlowAdapter } from './use-beatcanvas-react-flow-adapter';
import type { StudioTranslateFn } from './beatcanvas-types';

export function useBeatCanvasGraph({
  studioT,
  imageModels,
  videoModels,
  initialImageModelId,
  initialVideoModelId,
}: {
  studioT: StudioTranslateFn;
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
  initialImageModelId: string | null;
  initialVideoModelId: string | null;
}) {
  const canvasState = useBeatCanvasState();
  /** Folder whose subproject is open; `null` is the project's top level. */
  const [viewFolderId, setViewFolderId] = useState<CanvasLevelId>(null);
  const viewFolderIdRef = useRef<CanvasLevelId>(null);
  viewFolderIdRef.current = viewFolderId;

  const { canvasCardsRef, setCanvasCard } = canvasState;
  /**
   * A new card is created on the level of the card it was derived from, or on
   * the level that is open when there is no source. Every creation path goes
   * through this setter, so a card cannot silently land on a level the user is
   * not looking at (its shape would be removed by the level invariant and the
   * card would become invisible).
   */
  const setCanvasCardOnCurrentLevel = useCallback(
    (card: CanvasCard) => {
      const existing = canvasCardsRef.current[card.id];
      if (existing) {
        setCanvasCard(card);
        return;
      }
      const fromSource = resolveSourceLevel(canvasCardsRef.current, card);
      const levelId =
        card.folderId ??
        (fromSource.found ? fromSource.levelId : viewFolderIdRef.current);
      setCanvasCard(
        levelId === (card.folderId ?? null)
          ? card
          : ({ ...card, folderId: levelId } as CanvasCard)
      );
    },
    [canvasCardsRef, setCanvasCard]
  );

  const reactFlowAdapter = useBeatCanvasReactFlowAdapter({
    studioT,
    imageModels,
    videoModels,
    initialImageModelId,
    initialVideoModelId,
    canvasCards: canvasState.canvasCards,
    canvasCardsRef,
    removeCanvasCard: canvasState.removeCanvasCard,
    replaceCanvasCards: canvasState.replaceCanvasCards,
    setCanvasCard: setCanvasCardOnCurrentLevel,
    setActiveComposerCardId: canvasState.setActiveComposerCardId,
    viewFolderId,
  });

  const { showCanvasLevel } = reactFlowAdapter;
  const openCanvasLevel = useCallback(
    (levelId: CanvasLevelId) => {
      setViewFolderId(levelId);
      showCanvasLevel(levelId);
    },
    [showCanvasLevel]
  );
  const goBackCanvasLevel = useCallback(() => {
    const parentFolderId =
      canvasCardsRef.current[viewFolderIdRef.current ?? '']?.folderId ?? null;
    openCanvasLevel(parentFolderId);
  }, [canvasCardsRef, openCanvasLevel]);

  // A subproject can disappear under the open level (undo, an external edit, a
  // card deleted elsewhere). Fall back to the top level instead of leaving the
  // canvas on a level that no longer exists.
  useEffect(() => {
    if (!viewFolderId) return;
    if (canvasState.canvasCards[viewFolderId]?.kind === 'folder') return;
    openCanvasLevel(null);
  }, [canvasState.canvasCards, openCanvasLevel, viewFolderId]);

  return {
    ...canvasState,
    ...reactFlowAdapter,
    viewFolderId,
    openCanvasLevel,
    goBackCanvasLevel,
  };
}
