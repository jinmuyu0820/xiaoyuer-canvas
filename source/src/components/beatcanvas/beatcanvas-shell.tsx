
import {
  invalidateWorkspaceAfterAssetMutation,
  invalidateWorkspaceAfterGeneration,
} from '@/core/workspace-lib/app/workspace-query-invalidation';
import { generationValidationConstraints } from '@/core/effects/validation';
import {
  type WorkspaceModelOption,
  getCanonicalWorkspaceModelId,
  getDefaultSelectableWorkspaceModel,
  getWorkspaceModelsByType,
} from '@/core/effects/workspace-models';
import type { ProjectSnapshotActiveTemplateWorkflow } from '@/core/projects/project-snapshot';
import {
  canCreateFolderIn,
  countLevelCards,
  resolveFolderTrail,
} from '@/core/projects/canvas-levels';
import {
  isCanvasDraftCard,
  type CanvasCard,
  type CanvasCardMediaType,
  type CanvasCardStatus,
  type CanvasDraftCard,
  type CanvasUpscaleCard,
} from '@/core/beatcanvas/canvas-types';
import {
  cancelUpscaleJob,
  fetchUpscaleJob,
  startUpscaleJob,
} from '@/core/upscale/upscale-client';
import type { UpscaleJob, UpscaleOptions } from '@/core/upscale/upscale-contract';
import {
  normalizeUpscaleOptions,
  resolveUpscaleCardStatus,
} from '@/core/upscale/upscale-contract';
import {
  appendUniqueReferenceCardId,
  canUseCanvasCardAsGenerationReference,
  removeReferenceCardId,
  shouldIgnoreCanvasModifierShortcut,
  shouldIgnoreCanvasShortcut,
} from '@/core/beatcanvas/composer';
import {
  buildCanvasReferenceMentions,
  moveCanvasReferenceCardId,
  rewriteCanvasReferenceAliases,
} from '@/core/beatcanvas/reference-mentions';
import { getSelectableModel } from '@/core/beatcanvas/generation-controller';
import { resolveConcreteCanvasMediaCard } from '@/core/beatcanvas/generation-history';
import {
  PROJECT_ASSET_DRAG_MIME,
  PROJECT_ASSET_INSERT_EVENT,
  getProjectAssetCardSize,
  isProjectAssetTransferType,
  parseProjectAssetTransfer,
  type ProjectAssetInsertDetail,
  type ProjectAssetTransfer,
} from '@/core/beatcanvas/project-asset-transfer';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import {useCanvasTextActions} from './use-canvas-text-actions';
import {expandCanvasSelection} from '@/core/beatcanvas/context-menu';
import { extractVideoFrame } from '@/core/media/video-frame';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { useCanvasComposerLabels } from './use-canvas-composer-labels';
import { useProjectSnapshotLifecycle } from './use-project-snapshot-lifecycle';
import { useBeatCanvasGraph } from './use-beatcanvas-graph';
import {
  BEATCANVAS_OPEN_COMPOSER_EVENT,
  BEATCANVAS_REMEMBER_COMPOSER_EVENT,
  clearRememberedComposer,
  readRememberedComposer,
  rememberActiveComposer,
} from './beatcanvas-composer-restore';
import { useBeatCanvasDraftActions } from './use-beatcanvas-draft-actions';
import { useBeatCanvasGenerationRuntime } from './use-beatcanvas-generation-runtime';
import {
  type UploadIntent,
  useBeatCanvasUploadActions,
} from './use-beatcanvas-upload-actions';
import {
  BeatCanvasFrontLayerProvider,
  type BeatCanvasFrontLayerValue,
} from './beatcanvas-front-layer-context';
import { registerCardConnectorCallback } from './beatcanvas-card-connector-bridge';
import type { BeatCanvasPreviewMedia } from './beatcanvas-media-preview-overlay';
import {
  getPreviewableCanvasCardFromSelection,
  isDownloadableCanvasCard,
  resolveBatchCanvasCardSelection,
} from './beatcanvas-media-preview';
import BeatCanvasSidebar from './beatcanvas-sidebar';
import { BeatCanvasLoading } from './beatcanvas-loading';
import type { PersistedLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';

/**
 * Lazy-load heavy conditional overlays so they don't inflate the initial
 * canvas bundle. These are only rendered when the user opens them.
 */
const BeatCanvasContextToolbar = lazy(() =>
  import('./beatcanvas-context-toolbar').then((mod) => ({
    default: mod.BeatCanvasContextToolbar,
  }))
);
const BeatCanvasMediaPreviewOverlay = lazy(() =>
  import('./beatcanvas-media-preview-overlay').then((mod) => ({
    default: mod.BeatCanvasMediaPreviewOverlay,
  }))
);
const BeatCanvasStatusPill = lazy(() =>
  import('./beatcanvas-status-pill').then((mod) => ({
    default: mod.BeatCanvasStatusPill,
  }))
);
const DirectorDeskDrawer = lazy(() =>
  import('./director-desk-drawer').then((mod) => ({
    default: mod.DirectorDeskDrawer,
  }))
);
const UpscaleDialog = lazy(() =>
  import('./upscale-dialog').then((mod) => ({
    default: mod.UpscaleDialog,
  }))
);
const UpscaleNodeSettings = lazy(() =>
  import('./upscale-node-settings').then((mod) => ({
    default: mod.UpscaleNodeSettings,
  }))
);

/**
 * Keep the canvas interaction layer lazy so the main studio shell remains
 * small while React Flow and the composer overlays load together.
 */
const BeatCanvasFrontLayer = lazy(() =>
  import('./beatcanvas-front-layer').then(
    (mod) => ({ default: mod.BeatCanvasFrontLayer })
  )
);

const BeatCanvasReactFlowEditor = lazy(
  () => import('@/components/beatcanvas/react-flow/react-flow-editor')
);

const getInitialTaskType = ({
  initialTarget,
  initialModelId,
  imageModels,
}: {
  initialTarget: string | null;
  initialModelId: string | null;
  imageModels: WorkspaceModelOption[];
}): CanvasCardMediaType => {
  if (initialTarget === 'image') return 'image';

  if (!initialModelId) return 'video';

  const canonicalModelId = getCanonicalWorkspaceModelId(initialModelId);
  return imageModels.some((item) => item.id === canonicalModelId)
    ? 'image'
    : 'video';
};

const getCanvasShortcutTargetContext = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return {
      tagName: null,
      isContentEditable: false,
    };
  }

  const interactiveAncestor = target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], [contenteditable="plaintext-only"]'
  );
  const resolvedTarget = interactiveAncestor ?? target;

  return {
    tagName: resolvedTarget.tagName,
    isContentEditable:
      resolvedTarget instanceof HTMLElement
        ? resolvedTarget.isContentEditable
        : false,
  };
};

const sanitizeDownloadName = (value: string) =>
  Array.from(value.trim().replace(/[<>:"/\\|?*]+/g, '-'))
    .filter((character) => character >= ' ')
    .join('')
    .replace(/\s+/g, '-')
    .toLowerCase();

export function BeatCanvasShell({
  projectId,
  projectPath,
  initialProjectSnapshot,
  initialProjectSnapshotVersion,
  initialTarget,
  initialModelId,
  initialPrompt,
  initialFocusCardId,
}: {
  projectId: string;
  projectPath: string;
  initialProjectSnapshot:
    | import('@/core/projects/project-snapshot').ProjectSnapshotDocument
    | null;
  initialProjectSnapshotVersion: number | null;
  initialTarget: string | null;
  initialModelId: string | null;
  initialPrompt: string | null;
  initialFocusCardId: string | null;
}) {
  const rawStudioT = useTranslations('AppShell.studio');
  const projectAssetsT = useTranslations('AppShell.header.projectAssets');
  const toolsT=useTranslations('CanvasTools');
  const handledInitialFocusCardIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const refreshWorkspaceAfterGeneration = useCallback(() => {
    void invalidateWorkspaceAfterGeneration(queryClient);
  }, [queryClient]);
  const refreshWorkspaceAfterUpload = useCallback(() => {
    void invalidateWorkspaceAfterAssetMutation(queryClient);
  }, [queryClient]);
  const studioT = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      rawStudioT(key as never, values as never),
    [rawStudioT]
  );

  const imageModels = useMemo(
    () =>
      getWorkspaceModelsByType('ai-image').filter(
        (item) => item.available !== false
      ),
    []
  );
  const videoModels = useMemo(
    () =>
      getWorkspaceModelsByType('ai-video').filter(
        (item) => item.available !== false
      ),
    []
  );
  const canonicalInitialModelId = initialModelId
    ? getCanonicalWorkspaceModelId(initialModelId)
    : null;
  const initialTaskType = getInitialTaskType({
    initialTarget,
    initialModelId,
    imageModels,
  });
  const initialImageModel = getSelectableModel(
    imageModels,
    canonicalInitialModelId ??
      getDefaultSelectableWorkspaceModel('ai-image')?.id
  );
  const initialVideoModel = getSelectableModel(
    videoModels,
    canonicalInitialModelId
  );

  const {
    activeComposerCardId,
    canvasCards,
    canvasCardsRef,
    copySelectedCanvasCards,
    createConnectorBetweenCards,
    createDirectorCard,
    createUpscaleCard,
    createFolderFromSelection,
    reconcileFolderMembership,
    dissolveFolder,
    refreshCanvasLevelShapes,
    resetCanvasHistory,
    goBackCanvasLevel,
    openCanvasLevel,
    viewFolderId,
    createDraftCard,
    createTextCard,
    buildProjectSnapshotDocument: buildCanvasProjectSnapshotDocument,
    canUndoCanvas,
    canRedoCanvas,
    recordCanvasHistory,
    undoCanvas,
    redoCanvas,
    editorRef,
    focusShape,
    focusShapes,
    handleSelectedShapeIdsChange,
    handleSelectShape,
    handleSelectedCanvasCardIdsChange,
    insertAssetCard,
    pasteCanvasCards,
    createGenerationOutput,
    updateGenerationOutput,
    completeGenerationOutput,
    removeConnectorBetweenCards,
    removeCanvasCardsForShapes,
    restoreProjectSnapshot: restoreCanvasProjectSnapshot,
    selectedShapeIds,
    selectedCanvasCardIds,
    setActiveComposerCardId,
    updateCanvasCard,
    updateDraftCard,
  } = useBeatCanvasGraph({
    studioT,
    imageModels,
    videoModels,
    initialImageModelId: initialImageModel?.id ?? null,
    initialVideoModelId: initialVideoModel?.id ?? null,
  });

  const textActions=useCanvasTextActions({projectId,cardsRef:canvasCardsRef,updateCard:updateCanvasCard,checkpoint:recordCanvasHistory,createTextCard});
  const textToGeneration=useCallback((id:string,type:CanvasCardMediaType)=>{
    const card=canvasCardsRef.current[id];if(card?.kind!=='text'||!card.prompt.trim())return;
    if(Array.from(card.prompt).length>generationValidationConstraints.maxPromptChars){toast.error(toolsT('textPromptTooLong',{max:generationValidationConstraints.maxPromptChars}));return;}
    const nextId=createDraftCard({taskType:type,prompt:card.prompt,referenceCardIds:[],anchorCardIds:[id]});
    if(nextId){updateDraftCard(nextId,{sourceTextCardId:id});createConnectorBetweenCards(id,nextId);}
  },[canvasCardsRef,createConnectorBetweenCards,createDraftCard,updateDraftCard,toolsT]);

  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [canvasDocumentRevision, setCanvasDocumentRevision] = useState(0);

  useEffect(() => {
    const remember = () => {
      if (activeComposerCardId) {
        rememberActiveComposer(projectId, activeComposerCardId);
      }
    };
    window.addEventListener(BEATCANVAS_REMEMBER_COMPOSER_EVENT, remember);
    return () =>
      window.removeEventListener(BEATCANVAS_REMEMBER_COMPOSER_EVENT, remember);
  }, [activeComposerCardId, projectId]);

  useEffect(() => {
    if (!isCanvasReady) return;
    const cardId = readRememberedComposer(projectId);
    if (!cardId) return;
    let attempts = 0;
    let timer: number | undefined;
    // Wait for the snapshot to hydrate and for the initial empty-selection
    // pass to settle; that pass clears the active composer.
    const restore = () => {
      if (isCanvasDraftCard(canvasCardsRef.current[cardId])) {
        // Selecting the node keeps the restored composer anchored; the front
        // layer owns the actual open state and listens for this event.
        handleSelectShape(cardId);
        handleSelectedCanvasCardIdsChange([cardId]);
        window.dispatchEvent(
          new CustomEvent(BEATCANVAS_OPEN_COMPOSER_EVENT, {
            detail: { cardId },
          })
        );
        clearRememberedComposer(projectId);
        return;
      }
      attempts += 1;
      if (attempts <= 20) timer = window.setTimeout(restore, 250);
      else clearRememberedComposer(projectId);
    };
    timer = window.setTimeout(restore, 900);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    handleSelectShape,
    handleSelectedCanvasCardIdsChange,
    isCanvasReady,
    projectId,
  ]);
  const [allowEmptyProjectSnapshot, setAllowEmptyProjectSnapshot] =
    useState(false);
  const [previewMedia, setPreviewMedia] = useState<BeatCanvasPreviewMedia | null>(
    null
  );
  const [isContinuingVideo, setIsContinuingVideo] = useState(false);

  const insertProjectAsset = useCallback(
    (
      asset: ProjectAssetTransfer,
      clientPoint?: { x: number; y: number }
    ) => {
      if (asset.projectId !== projectId) return;

      const size = getProjectAssetCardSize(asset);
      const pagePoint = clientPoint
        ? editorRef.current?.screenToPage(clientPoint)
        : null;
      const insertedShapeId = insertAssetCard({
        assetId: asset.id,
        type: asset.mediaType,
        url: asset.publicUrl,
        name:
          asset.filename?.trim() ||
          projectAssetsT(
            asset.mediaType === 'image'
              ? 'imageName'
              : asset.mediaType === 'audio'
                ? 'audioName'
                : 'videoName'
          ),
        kind: 'asset',
        activateOnInsert: true,
        size,
        durationSec:
          typeof asset.durationMs === 'number' ? asset.durationMs / 1000 : null,
        audioRole: asset.mediaType === 'audio' ? 'music' : undefined,
        ...(pagePoint
          ? {
              frame: {
                x: pagePoint.x - size.w / 2,
                y: pagePoint.y - size.h / 2,
                w: size.w,
                h: size.h,
              },
            }
          : {}),
      });

      if (insertedShapeId) {
        toast.success(projectAssetsT('addedToCanvas'));
      }
    },
    [editorRef, insertAssetCard, projectAssetsT, projectId]
  );

  useEffect(() => {
    const handleInsertEvent = (event: Event) => {
      const detail = (event as CustomEvent<ProjectAssetInsertDetail>).detail;
      if (!detail?.asset) return;
      insertProjectAsset(detail.asset, detail.clientPoint);
    };

    const handleDragOver = (event: DragEvent) => {
      if (
        !event.dataTransfer ||
        !isProjectAssetTransferType(Array.from(event.dataTransfer.types))
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (event: DragEvent) => {
      const transferValue = event.dataTransfer?.getData(
        PROJECT_ASSET_DRAG_MIME
      );
      if (!transferValue) return;

      const asset = parseProjectAssetTransfer(transferValue);
      if (!asset || asset.projectId !== projectId) return;

      event.preventDefault();
      event.stopPropagation();
      insertProjectAsset(asset, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener(PROJECT_ASSET_INSERT_EVENT, handleInsertEvent);
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('drop', handleDrop, true);
    return () => {
      window.removeEventListener(PROJECT_ASSET_INSERT_EVENT, handleInsertEvent);
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('drop', handleDrop, true);
    };
  }, [insertProjectAsset, projectId]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setErrorMessage(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [errorMessage]);

  const {
    handleMediaUpload,
    handleUpload,
    mediaFileInputRef,
    imageFileInputRef,
    audioFileInputRef,
    openMediaUploadPicker,
    openUploadPicker,
    uploadFiles,
    uploadIntent,
    videoFileInputRef,
  } = useBeatCanvasUploadActions({
    projectId,
    studioT,
    imageModels,
    videoModels,
    canvasCardsRef,
    setErrorMessage,
    setStatusMessage,
    createConnectorBetweenCards,
    createDraftCard,
    focusShape,
    focusShapes,
    handleSelectShape,
    insertAssetCard,
    updateCanvasCard,
    updateDraftCard,
    setActiveComposerCardId,
    onWorkspaceAssetsMayChange: refreshWorkspaceAfterUpload,
  });

  useEffect(() => {
    const handleLocalFileDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleLocalFileDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void uploadFiles({ intent: 'media', mode: 'global' }, files);
    };

    window.addEventListener('dragover', handleLocalFileDragOver, true);
    window.addEventListener('drop', handleLocalFileDrop, true);
    return () => {
      window.removeEventListener('dragover', handleLocalFileDragOver, true);
      window.removeEventListener('drop', handleLocalFileDrop, true);
    };
  }, [uploadFiles]);

  const {
    handleCreatePromptDraft,
    handleDraftAnalysisDepthChange,
    handleDraftAspectRatioChange,
    handleDraftBackgroundSourceChange,
    handleDraftCharacterOrientationChange,
    handleDraftDurationChange,
    handleDraftLanguageChange,
    handleDraftModeChange,
    handleDraftModelChange,
    handleDraftOutputQualityChange,
    handleDraftPromptChange,
    handleDraftQualityChange,
    handleDraftTaskTypeChange,
    handleDraftVariantChange,
  } = useBeatCanvasDraftActions({
    canvasCardsRef,
    selectedCanvasCardIds,
    imageModels,
    videoModels,
    initialImageModelId: initialImageModel?.id ?? null,
    initialVideoModelId: initialVideoModel?.id ?? null,
    studioT,
    createDraftCard,
    setActiveComposerCardId,
    updateDraftCard,
  });

  const {
    handleGenerateDraft,
    metadataMap,
    resumeInFlightGenerations,
    runGenerateDraft,
  } = useBeatCanvasGenerationRuntime({
      projectId,
      studioT,
      canvasCardsRef,
      imageModels,
      isCanvasReady,
      videoModels,
      createGenerationOutput,
      updateGenerationOutput,
      completeGenerationOutput,
      setErrorMessage,
      setStatusMessage,
      updateDraftCard,
      onGenerationComplete: refreshWorkspaceAfterGeneration,
    });

  const handleCreateGenerationFromConnector = useCallback(
    ({
      sourceCardId,
      taskType,
      pagePoint,
    }: {
      sourceCardId: string;
      taskType: CanvasCardMediaType;
      pagePoint: { x: number; y: number };
    }) => {
      const sourceCard = canvasCardsRef.current[sourceCardId];
      if (!sourceCard) {
        return;
      }

      const models = taskType === 'image' ? imageModels : videoModels;
      const targetModel = getSelectableModel(models, null);
      if (
        !canUseCanvasCardAsGenerationReference({
          sourceCard,
          targetType: taskType,
          targetModel,
        })
      ) {
        return;
      }

      createDraftCard({
        taskType,
        prompt: '',
        referenceCardIds: [sourceCardId],
        anchorCardIds: [sourceCardId],
        placementPoint: pagePoint,
      });
    },
    [canvasCardsRef, createDraftCard, imageModels, videoModels]
  );

  const handleCreateGenerationAtPoint = useCallback(
    ({
      taskType,
      pagePoint,
    }: {
      taskType: CanvasCardMediaType;
      pagePoint: { x: number; y: number };
    }) => {
      createDraftCard({
        taskType,
        prompt: '',
        referenceCardIds: [],
        placementPoint: pagePoint,
        connectReferences: false,
      });
    },
    [createDraftCard]
  );

  const handleAttachCanvasReference = useCallback(
    (draftId: string, sourceCardId: string) => {
      const sourceCard = canvasCardsRef.current[sourceCardId];
      const draftCard = canvasCardsRef.current[draftId];
      if (!sourceCard || draftCard?.kind !== 'generation') {
        return;
      }

      if (
        draftCard.generationMode === 'analysis' &&
        !draftCard.referenceCardIds?.includes(sourceCardId) &&
        (draftCard.referenceCardIds?.length ?? 0) >= 1
      ) {
        return;
      }

      const models = draftCard.type === 'image' ? imageModels : videoModels;
      const targetModel = getSelectableModel(models, draftCard.modelId);
      if (
        !canUseCanvasCardAsGenerationReference({
          sourceCard,
          targetType: draftCard.type,
          targetModel,
          targetGenerationMode: draftCard.generationMode,
        })
      ) {
        return;
      }

      createConnectorBetweenCards(sourceCardId, draftId, {
        recordHistory: true,
      });
      updateDraftCard(draftId, {
        referenceCardIds: appendUniqueReferenceCardId(
          draftCard.referenceCardIds,
          sourceCardId
        ),
      });
    },
    [
      canvasCardsRef,
      createConnectorBetweenCards,
      imageModels,
      updateDraftCard,
      videoModels,
    ]
  );

  const handleDetachCanvasReference = useCallback(
    (draftId: string, sourceCardId: string) => {
      const draftCard = canvasCardsRef.current[draftId];
      if (draftCard?.kind !== 'generation') {
        return;
      }

      removeConnectorBetweenCards(sourceCardId, draftId, {
        recordHistory: true,
      });
      updateDraftCard(draftId, (current) => {
        const nextReferenceCardIds = removeReferenceCardId(
          current.referenceCardIds,
          sourceCardId
        );
        const previousMentions = buildCanvasReferenceMentions({
          referenceCardIds: current.referenceCardIds,
          cards: canvasCardsRef.current,
        });
        const nextMentions = buildCanvasReferenceMentions({
          referenceCardIds: nextReferenceCardIds,
          cards: canvasCardsRef.current,
        });

        return {
          ...current,
          prompt: rewriteCanvasReferenceAliases({
            prompt: current.prompt,
            previousMentions,
            nextMentions,
          }),
          referenceCardIds: nextReferenceCardIds,
        };
      });
    },
    [canvasCardsRef, removeConnectorBetweenCards, updateDraftCard]
  );

  const handleReorderCanvasReferences = useCallback(
    (draftId: string, activeCardId: string, overCardId: string) => {
      const draftCard = canvasCardsRef.current[draftId];
      if (draftCard?.kind !== 'generation') return;

      const nextReferenceCardIds = moveCanvasReferenceCardId({
        referenceCardIds: draftCard.referenceCardIds,
        activeCardId,
        overCardId,
      });
      if (nextReferenceCardIds === draftCard.referenceCardIds) return;

      const previousMentions = buildCanvasReferenceMentions({
        referenceCardIds: draftCard.referenceCardIds,
        cards: canvasCardsRef.current,
      });
      const nextMentions = buildCanvasReferenceMentions({
        referenceCardIds: nextReferenceCardIds,
        cards: canvasCardsRef.current,
      });

      recordCanvasHistory();
      updateDraftCard(draftId, {
        prompt: rewriteCanvasReferenceAliases({
          prompt: draftCard.prompt,
          previousMentions,
          nextMentions,
        }),
        referenceCardIds: nextReferenceCardIds,
        status: 'idle',
        error: null,
      });
    },
    [canvasCardsRef, recordCanvasHistory, updateDraftCard]
  );

  const handleReferenceEdgesRemoved = useCallback(
    (edges: Array<{ source: string; target: string }>) => {
      for (const edge of edges) {
        const draftCard = canvasCardsRef.current[edge.target];
        if (draftCard?.kind !== 'generation') {
          continue;
        }

        updateDraftCard(draftCard.id, (current) => {
          const nextReferenceCardIds = removeReferenceCardId(
            current.referenceCardIds,
            edge.source
          );
          return {
            ...current,
            prompt: rewriteCanvasReferenceAliases({
              prompt: current.prompt,
              previousMentions: buildCanvasReferenceMentions({
                referenceCardIds: current.referenceCardIds,
                cards: canvasCardsRef.current,
              }),
              nextMentions: buildCanvasReferenceMentions({
                referenceCardIds: nextReferenceCardIds,
                cards: canvasCardsRef.current,
              }),
            }),
            referenceCardIds: nextReferenceCardIds,
            sourceTextCardId:current.sourceTextCardId===edge.source?null:current.sourceTextCardId,
          };
        });
      }
    },
    [canvasCardsRef, updateDraftCard]
  );

  const handlePinGenerationOutput = useCallback(
    (draftId: string, outputId: string) => {
      const draftCard = canvasCardsRef.current[draftId];
      const outputCard = canvasCardsRef.current[outputId];
      if (draftCard?.kind !== 'generation' || outputCard?.kind !== 'output') {
        return;
      }

      recordCanvasHistory();
      updateDraftCard(draftId, {
        pinnedOutputId: outputId,
        url: outputCard.url,
        resultText: outputCard.resultText ?? null,
      });
    },
    [canvasCardsRef, recordCanvasHistory, updateDraftCard]
  );

  const selectedCanvasCards = useMemo(
    () =>
      selectedCanvasCardIds
        .map((cardId) => canvasCards[cardId])
        .filter((card): card is CanvasCard => Boolean(card)),
    [canvasCards, selectedCanvasCardIds]
  );

  const canvasCopy = useCanvasComposerLabels();
  const deleteCanvasSelection=useCallback((requestedIds:string[])=>{
    const editor=editorRef.current;if(!editor)return;
    const ids=expandCanvasSelection(requestedIds,editor.getCurrentPageShapes());if(!ids.length)return;
    // Deleting a subproject this way must behave like its own menu: the members
    // move up a level (the state helper does that) and they have to appear on
    // this level immediately.
    const removedFolder = ids.some((id)=>canvasCardsRef.current[id]?.kind==='folder');
    recordCanvasHistory();
    editor.deleteShapes(ids);
    removeCanvasCardsForShapes(ids);
    if (removedFolder) refreshCanvasLevelShapes();
    setActiveComposerCardId(null);
    if(Object.keys(canvasCardsRef.current).length===0)setAllowEmptyProjectSnapshot(true);
    setCanvasDocumentRevision(value=>value+1);
  },[editorRef,recordCanvasHistory,removeCanvasCardsForShapes,refreshCanvasLevelShapes,setActiveComposerCardId,canvasCardsRef]);
  const duplicateCanvasSelection=useCallback((requestedIds:string[])=>{
    const editor=editorRef.current;if(!editor)return;
    const ids=expandCanvasSelection(requestedIds,editor.getCurrentPageShapes());if(!ids.length)return;
    editor.setSelectedShapes(ids);
    if(copySelectedCanvasCards())pasteCanvasCards();
  },[editorRef,copySelectedCanvasCards,pasteCanvasCards]);

  const canvasComponents = useMemo(
    () => ({
      InFrontOfTheCanvas: BeatCanvasFrontLayer,
    }),
    []
  );

  // Declared before `frontLayerValue` (which references it) and before any
  // early return: a `const` referenced from an earlier useMemo would throw a
  // temporal-dead-zone error at render time.
  const [openDirectorNodeId, setOpenDirectorNodeId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const openDirectorNode = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (nodeId && canvasCardsRef.current[nodeId]) {
        setOpenDirectorNodeId(nodeId);
      }
    };
    window.addEventListener('beatcanvas:open-director-node', openDirectorNode);
    return () =>
      window.removeEventListener(
        'beatcanvas:open-director-node',
        openDirectorNode
      );
  }, [canvasCardsRef]);

  const createDirectorNode = useCallback(
    (pagePoint?: { x: number; y: number }) => {
      const cardId = createDirectorCard({
        name: toolsT('directorDesk'),
        placementPoint: pagePoint,
      });
      if (cardId) setOpenDirectorNodeId(cardId);
      return cardId;
    },
    [createDirectorCard, toolsT]
  );

  const handleCreateFolder = useCallback(
    (shapeIds: string[], pagePoint?: { x: number; y: number }) => {
      // A subproject nested inside a subproject is the last level: no third.
      if (!canCreateFolderIn(Object.values(canvasCardsRef.current), viewFolderId)) {
        toast.error(toolsT('folderDepthLimit'));
        return;
      }
      const cardId = createFolderFromSelection(
        shapeIds,
        toolsT('newFolderName'),
        pagePoint
      );
      if (cardId) toast.success(toolsT('newFolderCreated'));
    },
    [canvasCardsRef, createFolderFromSelection, toolsT, viewFolderId]
  );

  const handleEnterFolder = useCallback(
    (folderId: string) => {
      const folder = canvasCardsRef.current[folderId];
      if (folder?.kind !== 'folder') return;
      openCanvasLevel(folderId);
    },
    [canvasCardsRef, openCanvasLevel]
  );

  const handleRenameFolder = useCallback((folderId: string) => {
    window.dispatchEvent(
      new CustomEvent('beatcanvas:begin-rename-folder', {
        detail: { cardId: folderId },
      })
    );
  }, []);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      if (dissolveFolder(folderId)) toast.success(toolsT('folderDissolved'));
    },
    [dissolveFolder, toolsT]
  );

  useEffect(() => {
    const enter = (event: Event) => {
      const folderId = (event as CustomEvent<{ folderId?: string }>).detail
        ?.folderId;
      if (folderId) handleEnterFolder(folderId);
    };
    window.addEventListener('beatcanvas:enter-folder', enter);
    return () => window.removeEventListener('beatcanvas:enter-folder', enter);
  }, [handleEnterFolder]);

  // Esc steps out of a subproject, one level at a time. Inside an input or a
  // menu the key belongs to that widget; those targets are skipped.
  useEffect(() => {
    if (!viewFolderId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // Only the canvas itself handles the key: a menu, a dialog or a field
      // keeps its own Escape.
      if (
        target &&
        target !== document.body &&
        typeof target.closest === 'function' &&
        !target.closest('.react-flow')
      ) {
        return;
      }
      goBackCanvasLevel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBackCanvasLevel, viewFolderId]);

  const folderTrail = useMemo(
    () => resolveFolderTrail(Object.values(canvasCards), viewFolderId),
    [canvasCards, viewFolderId]
  );
  const canCreateSubfolder = useMemo(
    () => canCreateFolderIn(Object.values(canvasCards), viewFolderId),
    [canvasCards, viewFolderId]
  );

  useEffect(() => {
    const rename = (event: Event) => {
      const detail = (event as CustomEvent<{ cardId?: string; name?: string }>)
        .detail;
      if (!detail?.cardId || !detail.name) return;
      const name = detail.name.trim().slice(0, 200);
      if (!name) return;
      updateCanvasCard(detail.cardId, (current) => ({
        ...current,
        name,
      }) as CanvasCard);
    };
    window.addEventListener('beatcanvas:rename-folder', rename);
    return () => window.removeEventListener('beatcanvas:rename-folder', rename);
  }, [updateCanvasCard]);

  /**
   * Local upscale.
   *
   * The job is attached to a canvas node that is created immediately, so the
   * node is the progress surface and the result appears in place. `retry`
   * reopens the options for the original source and reuses the failed node
   * instead of stacking a second one next to it.
   */
  const [upscaleTarget, setUpscaleTarget] = useState<{
    sourceCardId: string;
    reuseCardId?: string;
    options?: UpscaleOptions | null;
  } | null>(null);
  /** Node gear: settings are edited against the node, not a global panel. */
  const [upscaleSettingsCardId, setUpscaleSettingsCardId] = useState<
    string | null
  >(null);

  const handleUpscaleSelection = useCallback((cardId: string) => {
    setUpscaleTarget({ sourceCardId: cardId });
  }, []);

  const startUpscaleForCard = useCallback(
    async (
      sourceCardId: string,
      options: UpscaleOptions,
      reuseCardId?: string
    ) => {
      const source = canvasCardsRef.current[sourceCardId];
      if (
        !source ||
        (source.kind !== 'asset' && source.kind !== 'generation' && source.kind !== 'upscale') ||
        (source.type !== 'image' && source.type !== 'video') ||
        !source.assetId
      ) {
        toast.error(toolsT('upscaleNotEligible'));
        return;
      }

      const jobCardId = reuseCardId ?? `shape:${Math.random().toString(36).slice(2, 10)}`;
      const title =
        source.name ||
        (source.type === 'image' ? canvasCopy.imageTitle : canvasCopy.videoTitle);

      if (reuseCardId) {
        updateCanvasCard(reuseCardId, (current) => ({
          ...current,
          status: 'pending',
          error: null,
          url: null,
          assetId: null,
          upscaleJobId: null,
          upscaleProgress: 0,
          upscaleStage: 'queued',
          upscaleSpeedFps: null,
          upscaleEtaSeconds: null,
          upscaleScale: options.scale,
          upscaleBackend: options.backend,
          upscaleOptions: options,
          upscaleSourceAssetId: source.assetId,
          upscaleSourceUrl: source.url,
        }) as CanvasCard);
      } else {
        const bounds = editorRef.current?.getShapePageBounds(sourceCardId);
        const card: CanvasUpscaleCard = {
          id: jobCardId,
          kind: 'upscale',
          type: source.type,
          name: title,
          url: null,
          prompt: '',
          referenceCardIds: [sourceCardId],
          workflowTemplateId: null,
          status: 'pending',
          error: null,
          modelId: '',
          aspectRatio: '16:9',
          outputQuality: '1k',
          duration: '5s',
          mode: 'quality',
          variant: 'standard',
          quality: 'standard',
          sourceGenerationId: null,
          upscaleJobId: null,
          upscaleSourceAssetId: source.assetId,
          upscaleSourceUrl: source.url,
          upscaleScale: options.scale,
          upscaleBackend: options.backend,
          upscaleOptions: options,
          upscaleProgress: 0,
          upscaleStage: 'queued',
          // A result of a node inside a folder belongs to that folder.
          folderId: source.folderId ?? null,
        };
        createUpscaleCard({
          card,
          title,
          placementPoint: bounds
            ? { x: bounds.maxX + 80, y: bounds.y }
            : undefined,
          activateOnInsert: true,
        });
      }

      try {
        const job = await startUpscaleJob({
          projectId,
          assetId: source.assetId,
          options,
        });
        updateCanvasCard(jobCardId, (current) => ({
          ...current,
          upscaleJobId: job.id,
          status: 'pending',
          upscaleProgress: job.progress,
          upscaleStage: job.stage,
        }) as CanvasCard);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateCanvasCard(jobCardId, (current) => ({
          ...current,
          status: 'failed',
          error: message,
        }) as CanvasCard);
        toast.error(message);
      }
    },
    [
      canvasCardsRef,
      canvasCopy,
      createUpscaleCard,
      editorRef,
      projectId,
      toolsT,
      updateCanvasCard,
    ]
  );

  /**
   * Applies a job snapshot to its node.
   *
   * Shared by the poller and by cancel: a cancel request can legitimately come
   * back with a job that already finished (or that the engine has not stopped
   * yet), so the UI must follow what the server reports instead of assuming the
   * cancel won.
   */
  const syncUpscaleCardWithJob = useCallback(
    (cardId: string, job: UpscaleJob) => {
      const current = canvasCardsRef.current[cardId];
      if (!current || current.kind !== 'upscale') return;
      const nextStatus = resolveUpscaleCardStatus(job.status) as CanvasCardStatus;
      // A cancelled job is reported as a failure, but the node should say it was
      // cancelled rather than showing whatever the killed child printed.
      const nextError =
        job.status === 'cancelled' ? toolsT('upscaleCancelled') : job.error;
      const unchanged =
        current.status === nextStatus &&
        Math.round((current.upscaleProgress ?? 0) * 100) ===
          Math.round(job.progress * 100) &&
        (current.upscaleStage ?? '') === (job.stage ?? '') &&
        (current.error ?? null) === (nextError ?? null);
      if (unchanged) return;
      updateCanvasCard(cardId, (existing) => ({
        ...existing,
        status: nextStatus,
        url: job.output?.publicUrl ?? (nextStatus === 'succeeded' ? existing.url : null),
        assetId: job.output?.assetId ?? existing.assetId,
        name: job.output?.filename ?? existing.name,
        error: nextError,
        upscaleProgress: job.progress,
        upscaleStage: job.stage,
        upscaleSpeedFps: job.speedFps,
        upscaleEtaSeconds: job.etaSeconds,
      }) as CanvasCard);
      if (job.status === 'succeeded' && job.output) {
        toast.success(toolsT('upscaleSucceeded', { name: job.output.filename }));
      }
    },
    [canvasCardsRef, toolsT, updateCanvasCard]
  );

  const cancelUpscaleCard = useCallback(
    async (cardId: string) => {
      const card = canvasCardsRef.current[cardId];
      if (!card || card.kind !== 'upscale' || !card.upscaleJobId) return;
      try {
        const job = await cancelUpscaleJob({ projectId, jobId: card.upscaleJobId });
        if (job) {
          // Terminal states settle the node; `running` means the kill was only
          // requested, so the poller keeps following it to the real outcome.
          syncUpscaleCardWithJob(cardId, job);
          return;
        }
        // The server answered without a job: it cannot confirm the stop, so do
        // not claim one. The poller settles the node with the honest state.
        toast.error(toolsT('upscaleCancelFailed'));
      } catch {
        // The request failed, so the engine is probably still working: say so
        // and let the poller keep the node honest instead of faking a cancel.
        toast.error(toolsT('upscaleCancelFailed'));
      }
    },
    [canvasCardsRef, projectId, syncUpscaleCardWithJob, toolsT, updateCanvasCard]
  );

  const retryUpscaleCard = useCallback(
    (cardId: string) => {
      const card = canvasCardsRef.current[cardId];
      if (!card || card.kind !== 'upscale') return;
      const sourceCardId = card.referenceCardIds.find(
        (id) => Boolean(canvasCardsRef.current[id]?.assetId)
      );
      const source = sourceCardId ? canvasCardsRef.current[sourceCardId] : null;
      if (!sourceCardId || !source) {
        toast.error(toolsT('upscaleSourceGone'));
        return;
      }
      setUpscaleTarget({
        sourceCardId,
        reuseCardId: cardId,
        options: normalizeUpscaleOptions(
          card.upscaleOptions ?? {
            backend: card.upscaleBackend ?? undefined,
            scale: card.upscaleScale ?? undefined,
          },
          card.type === 'image' ? 'image' : 'video'
        ),
      });
    },
    [canvasCardsRef, toolsT]
  );

  useEffect(() => {
    const onSettings = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: string }>).detail?.cardId;
      if (cardId) setUpscaleSettingsCardId(cardId);
    };
    window.addEventListener('beatcanvas:upscale-settings', onSettings);
    return () => {
      window.removeEventListener('beatcanvas:upscale-settings', onSettings);
    };
  }, []);

  useEffect(() => {
    const onCancel = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: string }>).detail?.cardId;
      if (cardId) void cancelUpscaleCard(cardId);
    };
    const onRetry = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: string }>).detail?.cardId;
      if (cardId) retryUpscaleCard(cardId);
    };
    window.addEventListener('beatcanvas:upscale-cancel', onCancel);
    window.addEventListener('beatcanvas:upscale-retry', onRetry);
    return () => {
      window.removeEventListener('beatcanvas:upscale-cancel', onCancel);
      window.removeEventListener('beatcanvas:upscale-retry', onRetry);
    };
  }, [cancelUpscaleCard, retryUpscaleCard]);

  // One poller for every running node: reloading the page re-attaches to jobs
  // that are still processing instead of losing them.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const pending = Object.values(canvasCardsRef.current).filter(
        (card): card is CanvasUpscaleCard =>
          card.kind === 'upscale' &&
          (card.status === 'pending' || card.status === 'processing') &&
          Boolean(card.upscaleJobId)
      );
      for (const card of pending) {
        const jobId = card.upscaleJobId;
        if (!jobId) continue;
        void fetchUpscaleJob({ projectId, jobId })
          .then((job) => {
            if (!job) {
              updateCanvasCard(card.id, (current) => ({
                ...current,
                status: 'failed',
                error: toolsT('upscaleJobLost'),
              }) as CanvasCard);
              return;
            }
            syncUpscaleCardWithJob(card.id, job);
          })
          .catch(() => undefined);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [canvasCardsRef, projectId, toolsT, updateCanvasCard]);

  const frontLayerValue = useMemo<BeatCanvasFrontLayerValue>(
    () => ({
      cards: canvasCards,
      selectedShapeIds,
      selectedCanvasCardIds,
      activeComposerCardId,
      composerPresentation: null,
      imageModels,
      videoModels,
      effectMetadataMap: metadataMap,
      labels: canvasCopy,
      promptCharacterLimit: generationValidationConstraints.maxPromptChars,
      canUndoCanvas,
      canRedoCanvas,
      onUndoCanvas: undoCanvas,
      onRedoCanvas: redoCanvas,
      onDeleteCanvasSelection:deleteCanvasSelection,
      onDuplicateCanvasSelection:duplicateCanvasSelection,
      onCreateImageDraft: () => handleCreatePromptDraft(imageModels.length ? 'image' : 'video'),
      onCreateTextCard:textActions.createTextNode,
      onCreateDirectorCard:createDirectorNode,
      onCreateFolder:handleCreateFolder,
      canCreateFolder:canCreateSubfolder,
      onEnterFolder:handleEnterFolder,
      onRenameFolder:handleRenameFolder,
      onDeleteFolder:handleDeleteFolder,
      onUpscaleCanvasSelection:handleUpscaleSelection,
      onTextHistoryCheckpoint:recordCanvasHistory,
      onTextChange:textActions.updateText,
      onOptimizeText:textActions.optimizeTextCard,
      onAcceptText:textActions.acceptTextCandidate,
      onDiscardText:textActions.discardTextCandidate,
      onRestoreTextVersion:textActions.restoreTextVersion,
      onTextCandidateToNewCard:textActions.candidateToNewCard,
      onTextToGeneration:textToGeneration,
      optimizingTextIds:textActions.optimizingTextIds,
      onUploadImage: () =>
        openUploadPicker({ intent: 'image', mode: 'global' }),
      onCreateGenerationFromConnector: handleCreateGenerationFromConnector,
      onCreateGenerationAtPoint: handleCreateGenerationAtPoint,
      onSelectedShapeIdsChange: handleSelectedShapeIdsChange,
      onSelectedCanvasCardIdsChange: handleSelectedCanvasCardIdsChange,
      onActiveComposerCardIdChange: setActiveComposerCardId,
      onDraftPromptChange: handleDraftPromptChange,
      onDraftAnalysisDepthChange: handleDraftAnalysisDepthChange,
      onDraftTaskTypeChange: handleDraftTaskTypeChange,
      onDraftModelChange: handleDraftModelChange,
      onDraftAspectRatioChange: handleDraftAspectRatioChange,
      onDraftBackgroundSourceChange: handleDraftBackgroundSourceChange,
      onDraftCharacterOrientationChange:
        handleDraftCharacterOrientationChange,
      onDraftOutputQualityChange: handleDraftOutputQualityChange,
      onDraftModeChange: handleDraftModeChange,
      onDraftVariantChange: handleDraftVariantChange,
      onDraftQualityChange: handleDraftQualityChange,
      onDraftDurationChange: handleDraftDurationChange,
      onDraftConnectionChange:(draftId,connectionId)=>{recordCanvasHistory();updateDraftCard(draftId,{connectionId});},
      onDraftSeedanceSettingsChange: (draftId, settings) => {
        recordCanvasHistory();
        updateDraftCard(draftId, {
          seedanceSettings: settings,
          ...(['first_frame', 'first_last_frame', 'edit', 'extend'].includes(settings.taskMode) ? { aspectRatio: 'adaptive' as const } : {}),
          ...(settings.taskMode === 'edit' ? { duration: '-1s' as const } : {}),
          ...(settings.draft ? { outputQuality: '480p' as const } : {}),
        });
      },
      onDraftLanguageChange: handleDraftLanguageChange,
      onOpenReferencePicker: (draftId, intent) =>
        openUploadPicker({ draftId, intent, mode: 'reference' }),
      onAttachCanvasReference: handleAttachCanvasReference,
      onDetachCanvasReference: handleDetachCanvasReference,
      onReorderCanvasReferences: handleReorderCanvasReferences,
      onPinGenerationOutput: handlePinGenerationOutput,
      onGenerateDraft: handleGenerateDraft,
    }),
    [
      activeComposerCardId,
      deleteCanvasSelection,
      duplicateCanvasSelection,
      textActions,
      textToGeneration,
      updateDraftCard,
      recordCanvasHistory,
      canUndoCanvas,
      canRedoCanvas,
      canvasCards,
      canvasCopy,
      handleDraftAspectRatioChange,
      handleDraftAnalysisDepthChange,
      handleDraftBackgroundSourceChange,
      handleDraftCharacterOrientationChange,
      handleDraftDurationChange,
      handleDraftLanguageChange,
      handleDraftModeChange,
      handleDraftModelChange,
      handleDraftOutputQualityChange,
      handleDraftPromptChange,
      handleDraftQualityChange,
      handleDraftTaskTypeChange,
      handleDraftVariantChange,
      handleGenerateDraft,
      handleCreatePromptDraft,
      handleAttachCanvasReference,
      handleCreateGenerationFromConnector,
      handleCreateGenerationAtPoint,
      handleDetachCanvasReference,
      handleReorderCanvasReferences,
      handlePinGenerationOutput,
      handleCreateFolder,
      canCreateSubfolder,
      handleEnterFolder,
      handleRenameFolder,
      handleDeleteFolder,
      handleSelectedShapeIdsChange,
      handleSelectedCanvasCardIdsChange,
      handleUpscaleSelection,
      metadataMap,
      imageModels,
      openUploadPicker,
      selectedShapeIds,
      selectedCanvasCardIds,
      setActiveComposerCardId,
      undoCanvas,
      redoCanvas,
      videoModels,
    ]
  );

  const shellMessage = errorMessage ?? statusMessage;
  const showShellMessage = Boolean(errorMessage || statusMessage);
  /** Source card shown in the upscale options dialog. */
  const upscaleSourceCard = upscaleTarget
    ? (canvasCards[upscaleTarget.sourceCardId] ?? null)
    : null;
  const upscaleSettingsCard = upscaleSettingsCardId
    ? (canvasCards[upscaleSettingsCardId] ?? null)
    : null;
  const selectedDraftCard = useMemo(
    () =>
      selectedCanvasCards.find(
        (card): card is CanvasDraftCard => card.kind === 'generation'
      ) ?? null,
    [selectedCanvasCards]
  );
  useEffect(() => {
    if (!selectedDraftCard) {
      return;
    }

    setActiveComposerCardId(selectedDraftCard.id);
  }, [selectedDraftCard?.id, setActiveComposerCardId]);
  const selectedShapeId =
    selectedShapeIds.length === 1 ? (selectedShapeIds[0] ?? null) : null;
  const selectedSingleCard = selectedShapeId
    ? canvasCards[selectedShapeId]
    : null;

  const selectedGroupCards = useMemo<CanvasCard[]>(() => {
    if (!selectedShapeId || selectedSingleCard) {
      return [];
    }

    const editor = editorRef.current;
    const selectedShape = editor?.getShape?.(selectedShapeId as any);

    if (selectedShape?.type !== 'group') {
      return [];
    }

    const childIds =
      editor?.getSortedChildIdsForParent?.(selectedShapeId as any) ?? [];

    return childIds
      .map((childId: string) => canvasCards[childId])
      .filter((card: CanvasCard | undefined): card is CanvasCard =>
        Boolean(card)
      );
  }, [canvasCards, editorRef, selectedShapeId, selectedSingleCard]);
  const effectiveSelectedGroupCards = useMemo(
    () =>
      resolveBatchCanvasCardSelection({
        cardsById: canvasCards,
        selectedCanvasCardIds,
        selectedGroupCards,
      }),
    [canvasCards, selectedCanvasCardIds, selectedGroupCards]
  );

  const downloadableGroupCards = useMemo(
    () =>
      effectiveSelectedGroupCards.filter((card: CanvasCard) =>
        isDownloadableCanvasCard(card)
      ),
    [effectiveSelectedGroupCards]
  );
  const isSingleDownloadable = isDownloadableCanvasCard(selectedSingleCard);
  const previewableSelectedCard = useMemo(
    () =>
      getPreviewableCanvasCardFromSelection({
        selectedSingleCard,
        selectedGroupCards: effectiveSelectedGroupCards,
      }),
    [effectiveSelectedGroupCards, selectedSingleCard]
  );
  const canPreviewSelection = Boolean(previewableSelectedCard);
  const isGroupSelected = effectiveSelectedGroupCards.length > 0;
  const canDownloadSelection =
    isSingleDownloadable || downloadableGroupCards.length > 0;
  const selectedCardsForActions = useMemo(
    () =>
      isGroupSelected
        ? effectiveSelectedGroupCards
        : selectedSingleCard
          ? [selectedSingleCard]
          : [],
    [effectiveSelectedGroupCards, isGroupSelected, selectedSingleCard]
  );
  const selectedContinuationMedia = useMemo(
    () =>
      selectedCardsForActions.flatMap((sourceCard) => {
        const mediaCard = resolveConcreteCanvasMediaCard({
          cards: canvasCards,
          card: sourceCard,
        });
        return mediaCard?.url &&
          mediaCard.assetId &&
          (mediaCard.type === 'video' || mediaCard.type === 'audio')
          ? [{ sourceCard, mediaCard }]
          : [];
      }),
    [canvasCards, selectedCardsForActions]
  );
  const continuationSelection =
    selectedContinuationMedia.length === 1 &&
    selectedContinuationMedia[0]?.mediaCard.type === 'video'
      ? selectedContinuationMedia[0]
      : null;
  const handleContinueFromTailFrame = useCallback(() => {
    if (
      !continuationSelection?.mediaCard.url ||
      !continuationSelection.mediaCard.assetId ||
      isContinuingVideo
    )
      return;
    const { mediaCard, sourceCard } = continuationSelection;
    void (async () => {
      setIsContinuingVideo(true);
      setErrorMessage(null);
      setStatusMessage(projectAssetsT('extractingTailFrame'));
      try {
        const frame = await extractVideoFrame({
          url: mediaCard.url!,
          position: 'last',
          filename: `${sanitizeDownloadName(mediaCard.name) || 'video'}-tail-frame.png`,
        });
        const asset = await uploadLocalProjectAsset({
          projectId,
          file: frame.file,
          assetClass: 'derived',
          metadata: {
            operation: 'video_tail_frame',
            parentAssetId: mediaCard.assetId,
            sourceCardId: sourceCard.id,
            sourceTimeSec: frame.timeSeconds,
            sourceDurationSec: frame.durationSeconds,
            relation: 'continuation_first_frame',
          },
        });
        await invalidateWorkspaceAfterAssetMutation(queryClient);
        const maxEdge = 320;
        const ratio = frame.width / frame.height;
        const size =
          ratio >= 1
            ? { w: maxEdge, h: Math.round(maxEdge / ratio) }
            : { w: Math.round(maxEdge * ratio), h: maxEdge };
        const tailFrameCardId = insertAssetCard({
          type: 'image',
          url: asset.publicUrl,
          name: projectAssetsT('tailFrameName', { name: mediaCard.name }),
          assetId: asset.id,
          sourceCardIds: [sourceCard.id],
          anchorCardIds: [sourceCard.id],
          size,
          fitMode: 'contain',
        });
        if (!tailFrameCardId) {
          throw new Error(projectAssetsT('tailFrameInsertFailed'));
        }
        const nextDraftId = createDraftCard({
          taskType: 'video',
          prompt: '',
          referenceCardIds: [tailFrameCardId],
          anchorCardIds: [tailFrameCardId],
          placementSide: 'right',
        });
        if (!nextDraftId) {
          throw new Error(projectAssetsT('continuationInsertFailed'));
        }
        setStatusMessage('');
        toast.success(projectAssetsT('continuationReady'), {
          id: `continuation-${sourceCard.id}`,
        });
      } catch (error) {
        setStatusMessage('');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : projectAssetsT('tailFrameFailed')
        );
      } finally {
        setIsContinuingVideo(false);
      }
    })();
  }, [
    continuationSelection,
    createDraftCard,
    insertAssetCard,
    isContinuingVideo,
    projectAssetsT,
    projectId,
    queryClient,
  ]);

  const resolveDownloadUrl = useCallback((card: CanvasCard) => {
    if (!card.url) {
      return null;
    }

    if (card.sourceGenerationId) {
      const params = new URLSearchParams({
        taskId: card.sourceGenerationId,
      });
      return `/api/assets/download?${params.toString()}`;
    }

    return card.url;
  }, []);

  const inferDownloadFileName = useCallback(
    (card: CanvasCard, shapeId?: string) => {
      // Try to get custom filename from React Flow node props
      if (shapeId) {
        const editor = editorRef.current;
        const shape = editor?.getShape?.(shapeId);
        const customFilename = (shape as any)?.props?.customFilename;
        if (customFilename && typeof customFilename === 'string' && customFilename.trim()) {
          // If custom filename already has extension, use it as-is
          if (/\.[a-z0-9]{2,5}$/i.test(customFilename)) {
            return sanitizeDownloadName(customFilename) || 'asset.mp4';
          }
          // Otherwise, add extension
          const sourceUrl = resolveDownloadUrl(card) ?? card.url ?? '';
          let extension = 'mp4';
          try {
            const pathname = new URL(sourceUrl, window.location.origin).pathname;
            const ext = pathname.split('.').pop()?.toLowerCase();
            if (ext && ext.length <= 5) {
              extension = ext;
            }
          } catch {}
          if (!extension) {
            extension = card.type === 'video' ? 'mp4' : card.type === 'audio' ? 'mp3' : 'png';
          }
          return `${sanitizeDownloadName(customFilename)}.${extension}`;
        }
      }

      // Fallback: use project name + timestamp if available
      // projectPath format: "projectName--projectId"
      const projectName = projectPath.split('--')[0] || 'project';
      if (projectName && projectName !== 'project') {
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
        const sourceUrl = resolveDownloadUrl(card) ?? card.url ?? '';
        let extension = 'mp4';
        try {
          const pathname = new URL(sourceUrl, window.location.origin).pathname;
          const ext = pathname.split('.').pop()?.toLowerCase();
          if (ext && ext.length <= 5) {
            extension = ext;
          }
        } catch {}
        if (!extension) {
          extension = card.type === 'video' ? 'mp4' : card.type === 'audio' ? 'mp3' : 'png';
        }
        return `${sanitizeDownloadName(projectName)}-${timestamp}.${extension}`;
      }

      // Final fallback: use card name
      const baseName = sanitizeDownloadName(card.name) || 'asset';
      const sourceUrl = resolveDownloadUrl(card) ?? card.url ?? '';

      try {
        const pathname = new URL(sourceUrl, window.location.origin).pathname;
        const extension = pathname.split('.').pop()?.toLowerCase();
        if (extension && extension.length <= 5) {
          return `${baseName}.${extension}`;
        }
      } catch {}

      const fallbackExtension =
        card.type === 'video'
          ? 'mp4'
          : card.type === 'audio'
            ? 'mp3'
            : 'png';
      return `${baseName}.${fallbackExtension}`;
    },
    [resolveDownloadUrl, editorRef, projectPath]
  );

  const fetchDownloadBlob = useCallback(
    async (card: CanvasCard, shapeId?: string) => {
      const downloadUrl = resolveDownloadUrl(card);
      if (!downloadUrl) {
        throw new Error('Missing download URL');
      }

      let response = await fetch(downloadUrl);
      if (!response.ok && card.url && card.url !== downloadUrl) {
        response = await fetch(card.url);
      }

      if (!response.ok) {
        throw new Error(`Failed to download ${card.name}`);
      }

      const blob = await response.blob();
      return {
        blob,
        fileName: blob.type === 'video/quicktime' ? `${sanitizeDownloadName(card.name) || 'video'}.mov` : inferDownloadFileName(card, shapeId),
      };
    },
    [inferDownloadFileName, resolveDownloadUrl]
  );

  const triggerBrowserDownload = useCallback((blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, []);

  const handleDownloadSelection = useCallback(async () => {
    try {
      if (isSingleDownloadable && selectedSingleCard) {
        const { blob, fileName } = await fetchDownloadBlob(selectedSingleCard, selectedShapeId || undefined);
        triggerBrowserDownload(blob, fileName);
        return;
      }

      if (downloadableGroupCards.length > 0) {
        const [{ default: JSZip }, files] = await Promise.all([
          import('jszip'),
          Promise.all(
            downloadableGroupCards.map((card: CanvasCard) => {
              // Find the shape ID for this card
              const shapeId = Object.keys(canvasCards).find(
                (id) => canvasCards[id] === card
              );
              return fetchDownloadBlob(card, shapeId);
            })
          ),
        ]);
        const zip = new JSZip();
        files.forEach(({ blob, fileName }, index) => {
          zip.file(`${String(index + 1).padStart(2, '0')}-${fileName}`, blob);
        });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        triggerBrowserDownload(zipBlob, 'canvas-group-assets.zip');
        return;
      }

      toast.error(studioT('messages.noDownloadableAssets'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : studioT('messages.noDownloadableAssets');
      toast.error(message);
    }
  }, [
    downloadableGroupCards,
    fetchDownloadBlob,
    isSingleDownloadable,
    selectedSingleCard,
    selectedShapeId,
    canvasCards,
    studioT,
    triggerBrowserDownload,
  ]);
  const handlePreviewSelection = useCallback(() => {
    if (!previewableSelectedCard?.url) {
      return;
    }

    setActiveComposerCardId(null);
    setPreviewMedia({
      type: previewableSelectedCard.type,
      url: previewableSelectedCard.url,
      title:
        previewableSelectedCard.name ||
        studioT(
          previewableSelectedCard.type === 'video'
            ? 'canvas.frame.videoTitle'
            : 'canvas.frame.imageTitle'
        ),
    });
  }, [previewableSelectedCard, setActiveComposerCardId, studioT]);

  useEffect(() => {
    const handlePreviewMediaEvent = (event: Event) => {
      const detail = (event as CustomEvent<BeatCanvasPreviewMedia>).detail;
      if (
        (detail?.type !== 'image' && detail?.type !== 'video') ||
        !detail.url
      ) {
        return;
      }

      setActiveComposerCardId(null);
      setPreviewMedia({
        type: detail.type,
        url: detail.url,
        title:
          detail.title ||
          studioT(
            detail.type === 'video'
              ? 'canvas.frame.videoTitle'
              : 'canvas.frame.imageTitle'
          ),
      });
    };

    window.addEventListener('beatcanvas:preview-media', handlePreviewMediaEvent);
    return () => {
      window.removeEventListener(
        'beatcanvas:preview-media',
        handlePreviewMediaEvent
      );
    };
  }, [setActiveComposerCardId, studioT]);

  useEffect(() => {
    const handlePinGenerationOutputEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{ draftId?: string; outputId?: string }>
      ).detail;
      if (!detail?.draftId || !detail.outputId) {
        return;
      }
      handlePinGenerationOutput(detail.draftId, detail.outputId);
    };

    window.addEventListener(
      'beatcanvas:pin-generation-output',
      handlePinGenerationOutputEvent
    );
    return () => {
      window.removeEventListener(
        'beatcanvas:pin-generation-output',
        handlePinGenerationOutputEvent
      );
    };
  }, [handlePinGenerationOutput]);

  useEffect(() => {
    const handleUpdateCustomFilenameEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{ nodeId?: string; customFilename?: string | null }>
      ).detail;
      if (!detail?.nodeId) {
        return;
      }
      const editor = editorRef.current;
      if (!editor || typeof editor.updateShape !== 'function') {
        return;
      }
      const shape = editor.getShape?.(detail.nodeId);
      if (!shape) {
        return;
      }
      const customFilename = detail.customFilename?.trim() || null;
      editor.updateShape({
        id: detail.nodeId,
        type: shape.type,
        props: {
          ...shape.props,
          customFilename,
        },
      });
      // The node id is the card id. The card is what gets persisted into the
      // project snapshot, so the name has to be written there too; otherwise a
      // refresh drops it and downloads fall back to the default name.
      if (canvasCardsRef.current[detail.nodeId]) {
        updateCanvasCard(detail.nodeId, (current) => ({
          ...current,
          customFilename,
        }));
      }
      setCanvasDocumentRevision((value) => value + 1);
    };

    window.addEventListener(
      'beatcanvas:update-node-custom-filename',
      handleUpdateCustomFilenameEvent
    );
    return () => {
      window.removeEventListener(
        'beatcanvas:update-node-custom-filename',
        handleUpdateCustomFilenameEvent
      );
    };
  }, [canvasCardsRef, editorRef, setCanvasDocumentRevision, updateCanvasCard]);

  const handleDirectorExport = useCallback(
    (asset: PersistedLocalProjectAsset) => {
      const directorNodeId = openDirectorNodeId;
      // The exported media becomes a normal asset card next to the director
      // node. `sourceCardIds` is what persists the link: the reference is
      // written onto the card, so the connector survives a reload.
      insertAssetCard({
        type: asset.type,
        url: asset.publicUrl,
        name: asset.filename,
        kind: 'asset',
        assetId: asset.id,
        sourceGenerationId: null,
        sourceCardIds: directorNodeId ? [directorNodeId] : [],
        ...(directorNodeId ? { anchorCardIds: [directorNodeId] } : {}),
        placementSide: 'right',
        activateOnInsert: true,
        recordHistory: true,
      });
      if (!directorNodeId) return;

      updateCanvasCard(directorNodeId, (current) => ({
        ...current,
        lastExportAssetId: asset.id,
        lastExportUrl: asset.publicUrl,
      }) as CanvasCard);
      const editor = editorRef.current;
      const shape = editor?.getShape?.(directorNodeId);
      if (editor && shape) {
        editor.updateShape({
          id: directorNodeId,
          type: shape.type,
          props: { ...shape.props, lastExportUrl: asset.publicUrl },
        });
      }
    },
    [
      editorRef,
      insertAssetCard,
      openDirectorNodeId,
      updateCanvasCard,
    ]
  );

  const contextDownloadLabel = isGroupSelected
    ? studioT('multiSelect.batchDownload')
    : isSingleDownloadable
      ? studioT('multiSelect.download')
      : null;
  const showContextToolbar = Boolean(
    canPreviewSelection ||
      isSingleDownloadable ||
      isGroupSelected
  );
  const snapshotChangeSignal = useMemo(
    () => ({
      cards: canvasCards,
      canvasDocumentRevision,
    }),
    [canvasDocumentRevision, canvasCards]
  );

  const activeTemplateProjectWorkflowSnapshot =
    useMemo<ProjectSnapshotActiveTemplateWorkflow | null>(
      () => initialProjectSnapshot?.workflows?.activeTemplate ?? null,
      [initialProjectSnapshot]
    );

  const buildProjectSnapshotDocument = useCallback(() => {
    const nextDocument = buildCanvasProjectSnapshotDocument();
    const workflows = {
      ...(nextDocument.workflows ?? {}),
      ...(activeTemplateProjectWorkflowSnapshot
        ? { activeTemplate: activeTemplateProjectWorkflowSnapshot }
        : {}),
    };

    return Object.keys(workflows).length > 0
      ? {
          ...nextDocument,
          workflows,
        }
      : nextDocument;
  }, [activeTemplateProjectWorkflowSnapshot, buildCanvasProjectSnapshotDocument]);

  const restoreProjectSnapshot = useCallback(
    (
      document: import(
        '@/core/projects/project-snapshot'
      ).ProjectSnapshotDocument
    ) => {
      restoreCanvasProjectSnapshot(document);
      // A whole document arriving from outside (first load, another tab, a
      // command) invalidates the in-memory undo history, but undo itself must
      // not clear it — that is what restoreCanvasProjectSnapshot used to do.
      resetCanvasHistory();
      resumeInFlightGenerations();
    },
    [resetCanvasHistory, restoreCanvasProjectSnapshot, resumeInFlightGenerations]
  );

  const handleEmptyProjectSnapshotSaved = useCallback(() => {
    setAllowEmptyProjectSnapshot(false);
  }, []);

  const handleProjectSnapshotConflict = useCallback(() => {
    toast.error(studioT('messages.snapshotConflict'));
  }, [studioT]);

  const handleProjectSnapshotReloaded = useCallback(() => {
    toast.info(studioT('messages.snapshotReloaded'));
  }, [studioT]);

  useProjectSnapshotLifecycle({
    projectId,
    projectPath,
    initialProjectSnapshot,
    initialProjectSnapshotVersion,
    initialPrompt,
    initialTaskType,
    isCanvasReady,
    snapshotChangeSignal,
    allowEmptyProjectSnapshot,
    buildProjectSnapshotDocument,
    restoreProjectSnapshot,
    createDraftCard,
    onEmptyProjectSnapshotSaved: handleEmptyProjectSnapshotSaved,
    onProjectSnapshotConflict: handleProjectSnapshotConflict,
    onProjectSnapshotReloaded: handleProjectSnapshotReloaded,
  });

  useEffect(() => {
    const focusCardId = initialFocusCardId?.trim();
    if (
      !focusCardId ||
      !isCanvasReady ||
      handledInitialFocusCardIdRef.current === focusCardId ||
      !canvasCards[focusCardId]
    ) {
      return;
    }

    handledInitialFocusCardIdRef.current = focusCardId;
    handleSelectShape(focusCardId);
    focusShape(focusCardId);
    if (canvasCards[focusCardId]?.kind === 'generation') {
      setActiveComposerCardId(focusCardId);
    }
  }, [
    canvasCards,
    focusShape,
    handleSelectShape,
    initialFocusCardId,
    isCanvasReady,
    setActiveComposerCardId,
  ]);

  // Listen for card connector events from the overlay
  useEffect(() => {
    const handleConnect = (e: Event) => {
      const { sourceCardId, targetCardId } = (e as CustomEvent).detail;
      if (sourceCardId && targetCardId && sourceCardId !== targetCardId) {
        const sourceCard = canvasCardsRef.current[sourceCardId];
        const targetCard = canvasCardsRef.current[targetCardId];
        if (!sourceCard || targetCard?.kind !== 'generation') {
          return;
        }

        if (
          targetCard.generationMode === 'analysis' &&
          !targetCard.referenceCardIds?.includes(sourceCardId) &&
          (targetCard.referenceCardIds?.length ?? 0) >= 1
        ) {
          return;
        }

        const models = targetCard.type === 'image' ? imageModels : videoModels;
        const targetModel = getSelectableModel(models, targetCard.modelId);
        if (
          !canUseCanvasCardAsGenerationReference({
          sourceCard,
          targetType: targetCard.type,
          targetModel,
          targetGenerationMode: targetCard.generationMode,
        })
        ) {
          return;
        }

        createConnectorBetweenCards(sourceCardId, targetCardId, {
          recordHistory: true,
        });
        updateDraftCard(targetCardId, {
          referenceCardIds: [
            ...new Set([
              ...(targetCard.referenceCardIds ?? []),
              sourceCardId,
            ]),
          ],
        });
      }
    };
    window.addEventListener('beatcanvas:connect-cards', handleConnect);
    return () =>
      window.removeEventListener('beatcanvas:connect-cards', handleConnect);
  }, [
    createConnectorBetweenCards,
    canvasCardsRef,
    imageModels,
    updateDraftCard,
    videoModels,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const targetContext = getCanvasShortcutTargetContext(event.target);
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey;

      if (
        hasModifier &&
        !shouldIgnoreCanvasModifierShortcut({
          ...targetContext,
          isComposing: event.isComposing,
          defaultPrevented: event.defaultPrevented,
        })
      ) {
        if (key === 'z' && event.shiftKey) {
          event.preventDefault();
          redoCanvas();
          return;
        }
        if (key === 'z') {
          event.preventDefault();
          undoCanvas();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          redoCanvas();
          return;
        }
        if (key === 'c') {
          if (copySelectedCanvasCards()) {
            event.preventDefault();
          }
          return;
        }
        if (key === 'v') {
          if (pasteCanvasCards()) {
            event.preventDefault();
          }
        }
        return;
      }

      if (
        shouldIgnoreCanvasShortcut({
          ...targetContext,
          isComposing: event.isComposing,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          defaultPrevented: event.defaultPrevented,
        })
      ) {
        return;
      }

      if (event.shiftKey && key === 'i') {
        event.preventDefault();
        openUploadPicker({
          intent: 'image',
          mode: 'global',
        });
        return;
      }

      if (event.shiftKey && key === 'v') {
        event.preventDefault();
        openUploadPicker({
          intent: 'video',
          mode: 'global',
        });
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        handleCreatePromptDraft('image');
        return;
      }

      if (key === 'm') {
        event.preventDefault();
        handleCreatePromptDraft('video');
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [
    copySelectedCanvasCards,
    handleCreatePromptDraft,
    openUploadPicker,
    pasteCanvasCards,
    redoCanvas,
    undoCanvas,
  ]);

  // Register card connector "+" button handler
  useEffect(() => {
    registerCardConnectorCallback((shapeId, side) => {
      const card = canvasCardsRef.current[shapeId];
      if (!card) return;

      if (side === 'output') {
        handleCreatePromptDraft(card.type === 'video' ? 'video' : 'image');
      } else {
        // Open reference upload targeting this card
        openUploadPicker({
          intent: card.type === 'video' ? 'video' : 'image',
          mode: 'reference',
          draftId: shapeId,
        });
      }
    });
    return () => registerCardConnectorCallback(null);
  }, [canvasCardsRef, handleCreatePromptDraft, openUploadPicker]);

  const handleEditorMount = useCallback(
    (editor: unknown) => {
      editorRef.current = editor as any;

      if (typeof editorRef.current?.setCurrentTool === 'function') {
        editorRef.current.setCurrentTool('select');
      }

      setIsCanvasReady(true);
    },
    [editorRef]
  );

  const handleCanvasDocumentChange = useCallback(() => {
    if (Object.keys(canvasCardsRef.current).length > 0) {
      setAllowEmptyProjectSnapshot(false);
    }
    // A card dropped inside a folder panel joins it (folders may start empty).
    reconcileFolderMembership();
    setCanvasDocumentRevision((current) => current + 1);
  }, [canvasCardsRef, reconcileFolderMembership]);

  const handleCanvasShapeIdsRemoved = useCallback(
    (shapeIds: string[]) => {
      // A folder removed by Delete (React Flow reports the removal directly)
      // also has to put its members back on this level.
      const removedFolder = shapeIds.some(
        (shapeId) => canvasCardsRef.current[shapeId]?.kind === 'folder'
      );
      removeCanvasCardsForShapes(shapeIds);
      if (removedFolder) refreshCanvasLevelShapes();
      if (Object.keys(canvasCardsRef.current).length === 0) {
        setAllowEmptyProjectSnapshot(true);
      }
      setCanvasDocumentRevision((current) => current + 1);
    },
    [canvasCardsRef, refreshCanvasLevelShapes, removeCanvasCardsForShapes]
  );

  /**
   * Undo can legitimately empty the canvas, and the empty state has to be
   * allowed to save — otherwise the last undo is rejected and the nodes come
   * back on reload. Only a canvas that *became* empty counts, so the guard still
   * protects a transient empty renderer during load.
   */
  const previousCardCountRef = useRef(0);
  useEffect(() => {
    const cardCount = Object.keys(canvasCards).length;
    if (cardCount === 0 && previousCardCountRef.current > 0) {
      setAllowEmptyProjectSnapshot(true);
    }
    previousCardCountRef.current = cardCount;
  }, [canvasCards]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--beatcanvas-canvas-bg)]">
      <input
        ref={mediaFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.mp3,.wav,.m4a,.aac,.ogg"
        multiple
        className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px opacity-0"
        onChange={handleMediaUpload}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px opacity-0"
        onChange={handleUpload('image')}
      />
      <input
        ref={videoFileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        multiple
        className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px opacity-0"
        onChange={handleUpload('video')}
      />
      <input ref={audioFileInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.wav,.m4a,.aac,.ogg" multiple className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px opacity-0" onChange={handleUpload('audio')}/>

      {/* Canvas area */}
      <div className="relative flex-1 min-w-0">
        <BeatCanvasFrontLayerProvider value={frontLayerValue}>
          <Suspense fallback={<BeatCanvasLoading />}>
            <BeatCanvasReactFlowEditor
              onMount={handleEditorMount}
              onDocumentChange={handleCanvasDocumentChange}
              onHistoryCheckpoint={recordCanvasHistory}
              onShapeIdsRemoved={handleCanvasShapeIdsRemoved}
              onReferenceEdgesRemoved={handleReferenceEdgesRemoved}
              components={canvasComponents}
            />
          </Suspense>
        </BeatCanvasFrontLayerProvider>

        <div className="pointer-events-none absolute inset-0">
          {folderTrail.length > 0 ? (
            <div
              data-canvas-breadcrumb="true"
              className="pointer-events-auto absolute left-3 top-3 z-[60] flex max-w-[min(72vw,640px)] items-center gap-1 rounded-xl border border-white/10 bg-[#17181B]/92 px-2 py-1 text-[12px] text-white shadow-lg backdrop-blur"
            >
              <button
                type="button"
                data-breadcrumb-level="top"
                className="rounded px-1.5 py-0.5 text-[var(--beat-text-2)] transition hover:bg-white/10 hover:text-white"
                onClick={() => openCanvasLevel(null)}
              >
                {toolsT('breadcrumbTop')}
              </button>
              {folderTrail.map((folder, index) => (
                <span key={folder.id} className="flex min-w-0 items-center gap-1">
                  <span className="text-white/25">/</span>
                  <button
                    type="button"
                    data-breadcrumb-level={folder.id}
                    data-breadcrumb-name={folder.name}
                    aria-current={
                      index === folderTrail.length - 1 ? 'page' : undefined
                    }
                    className={
                      index === folderTrail.length - 1
                        ? 'max-w-[220px] truncate rounded px-1.5 py-0.5 font-semibold text-orange-100'
                        : 'max-w-[220px] truncate rounded px-1.5 py-0.5 text-[var(--beat-text-2)] transition hover:bg-white/10 hover:text-white'
                    }
                    onClick={() => openCanvasLevel(folder.id)}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
              <span className="ml-1 shrink-0 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/60">
                {countLevelCards(Object.values(canvasCards), viewFolderId)}
              </span>
            </div>
          ) : null}

          {/* Floating Left Toolbar */}
          <BeatCanvasSidebar
            projectId={projectId}
            onUploadMedia={openMediaUploadPicker}
            onCreateText={textActions.createTextNode}
            onCreateImageDraft={() => handleCreatePromptDraft(imageModels.length ? 'image' : 'video')}
            onInsertHistoryAsset={(asset) =>
              insertProjectAsset({ ...asset, projectId })
            }
            onUploadCategory={intent=>void openUploadPicker({intent,mode:'global'})}
            uploadIntent={uploadIntent}
          />

          {showContextToolbar ? (
            <Suspense fallback={null}>
              <BeatCanvasContextToolbar
                canDownload={canDownloadSelection}
                canPreview={canPreviewSelection}
                downloadLabel={contextDownloadLabel}
                isBatchDownload={isGroupSelected}
                previewLabel={
                  canPreviewSelection
                    ? studioT('multiSelect.preview')
                    : null
                }
                onDownload={() => {
                  void handleDownloadSelection();
                }}
                onPreview={handlePreviewSelection}
                continueVideoLabel={
                  continuationSelection
                    ? projectAssetsT('continueFromTailFrame')
                    : null
                }
                canContinueVideo={Boolean(
                  continuationSelection && !isContinuingVideo
                )}
                onContinueVideo={handleContinueFromTailFrame}
              />
            </Suspense>
          ) : null}

          {previewMedia ? (
            <Suspense fallback={null}>
              <BeatCanvasMediaPreviewOverlay
                media={previewMedia}
                closeLabel={studioT('multiSelect.closePreview')}
                onClose={() => setPreviewMedia(null)}
              />
            </Suspense>
          ) : null}

          {showShellMessage && !showContextToolbar ? (
            <Suspense fallback={null}>
              <BeatCanvasStatusPill
                message={shellMessage}
                isError={Boolean(errorMessage)}
              />
            </Suspense>
          ) : null}

          {/* Agent panel removed */}
        </div>
      </div>

      {openDirectorNodeId ? (
        <Suspense fallback={null}>
          <DirectorDeskDrawer
            projectId={projectId}
            nodeId={openDirectorNodeId}
            open
            onClose={() => setOpenDirectorNodeId(null)}
            onExported={handleDirectorExport}
          />
        </Suspense>
      ) : null}

      {upscaleTarget && upscaleSourceCard ? (
        <Suspense fallback={null}>
          <UpscaleDialog
            key={`${upscaleTarget.sourceCardId}:${upscaleTarget.reuseCardId ?? 'new'}`}
            projectId={projectId}
            mediaType={
              upscaleSourceCard.type === 'image' ? 'image' : 'video'
            }
            sourceName={upscaleSourceCard.name}
            initialOptions={upscaleTarget.options ?? null}
            onClose={() => setUpscaleTarget(null)}
            onStart={(options) => {
              void startUpscaleForCard(
                upscaleTarget.sourceCardId,
                options,
                upscaleTarget.reuseCardId
              );
            }}
          />
        </Suspense>
      ) : null}

      {upscaleSettingsCard && upscaleSettingsCard.kind === 'upscale' ? (
        <Suspense fallback={null}>
          <UpscaleNodeSettings
            projectId={projectId}
            card={upscaleSettingsCard}
            onClose={() => setUpscaleSettingsCardId(null)}
            onSave={(options) => {
              updateCanvasCard(upscaleSettingsCard.id, (current) => ({
                ...current,
                upscaleOptions: options,
                upscaleScale: options.scale,
                upscaleBackend: options.backend,
              }) as CanvasCard);
              toast.success(toolsT('upscaleSettingsSaved'));
            }}
            onRun={(options) => {
              const sourceCardId = upscaleSettingsCard.referenceCardIds.find(
                (id) => Boolean(canvasCards[id]?.assetId)
              );
              if (!sourceCardId) {
                toast.error(toolsT('upscaleSourceGone'));
                return;
              }
              void startUpscaleForCard(
                sourceCardId,
                options,
                upscaleSettingsCard.status === 'succeeded'
                  ? undefined
                  : upscaleSettingsCard.id
              );
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
