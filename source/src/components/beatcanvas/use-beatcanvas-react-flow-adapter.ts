import type {
  WorkspaceAspectRatio,
  WorkspaceModelOption,
} from '@/core/effects/workspace-models';
import {
  buildProjectSnapshotDocument as buildProjectSnapshotDocumentFromCards,
  createProjectSnapshotRestorePlan,
  mergeCanvasRuntimeCardsIntoHistoryDocument,
} from '@/core/projects/project-canvas-document';
import type {
  ProjectSnapshotCamera,
  ProjectSnapshotDocument,
  ProjectSnapshotShapeFrame,
} from '@/core/projects/project-snapshot';
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import type {
  CanvasCard,
  CanvasAssetMediaType,
  CanvasAssetCard,
  CanvasCardMediaType,
  CanvasDirectorCard,
  CanvasDraftCard,
  CanvasOutputCard,
  CanvasTextCard,
  CanvasUpscaleCard,
  CanvasFolderCard,
} from '@/core/beatcanvas/canvas-types';
import {
  inheritFolderId,
  planCanvasFolderCreation,
  CANVAS_FOLDER_ICON_SIZE,
} from '@/core/beatcanvas/folders';
import {
  buildLevelDocument,
  canCreateFolderIn,
  cardLevelId,
  countLevelCards,
  countLevelSubfolders,
  planCardAdoptionIntoFolder,
  planFolderDissolve,
  type CanvasLevelId,
} from '@/core/projects/canvas-levels';
import { buildGenerationTakes } from '@/core/beatcanvas/generation-history';
import {
  isCanvasDraftCard,
  isCanvasOutputCard,
  isCanvasUpscaleCard,
} from '@/core/beatcanvas/canvas-types';
import { getDraftDefaultsFromModel } from '@/core/beatcanvas/draft-defaults';
import { buildDraftShapeText } from '@/core/beatcanvas/draft-shape';
import { getSelectableModel } from '@/core/beatcanvas/generation-controller';
import {
  formatUpscaleSummary,
  normalizeUpscaleOptions,
} from '@/core/upscale/upscale-contract';
import {
  resolveReferenceDrivenDraftAspectRatio,
  resolveWorkspaceAspectRatioFromDimensions,
} from '@/core/beatcanvas/composer';
import {
  resolveCanvasPlacement,
  type CanvasPlacementSide,
} from '@/core/beatcanvas/upload-layout';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import {
  ASSET_CARD_NODE_TYPE,
  DIRECTOR_CARD_NODE_TYPE,
  FOLDER_CARD_NODE_TYPE,
  GENERATION_CARD_NODE_TYPE,
  TEXT_CARD_NODE_TYPE,
  UPSCALE_CARD_NODE_TYPE,
  type BeatCanvasEditor,
  type FolderCardNodeProps,
  type GenerationCardNodeProps,
  type UpscaleCardNodeProps,
} from './react-flow/beatcanvas-react-flow-types';
import type { StudioTranslateFn } from './beatcanvas-types';

type ShapePlacement = {
  x: number;
  y: number;
};

type ShapeSize = {
  w: number;
  h: number;
};

/** Runs after the next paint, or immediately when there is no frame clock. */
const runAfterPaint = (callback: () => void) => {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    window.requestAnimationFrame(callback);
    return;
  }
  callback();
};

/** Levels are keyed by folder id; the top level needs a key of its own. */
const levelCameraKey = (levelId: CanvasLevelId) => levelId ?? 'canvas:top';

type CanvasFocusOptions = {
  zoom?: number;
};

const CARD_KIND_META_KEY = 'beatdesignCardKind';
const CARD_TYPE_META_KEY = 'beatdesignCardType';
const CARD_SOURCE_META_KEY = 'beatdesignCardSource';
const CARD_WORKFLOW_TEMPLATE_META_KEY = 'beatdesignWorkflowTemplateId';
const CARD_RESULT_SIZE = 360;
const VIDEO_FRAME_HEIGHT = 236;
const ANALYSIS_REPORT_FRAME_SIZE = { w: 480, h: 340 } as const;

const makeId = () => Math.random().toString(36).slice(2, 10);
const getAspectRatioValue = (
  taskType: CanvasCardMediaType,
  aspectRatio: WorkspaceAspectRatio
) => {
  const numericRatio = /^(\d+):(\d+)$/.exec(aspectRatio);
  if (numericRatio) {
    const width = Number(numericRatio[1]);
    const height = Number(numericRatio[2]);
    if (width > 0 && height > 0) {
      return width / height;
    }
  }

  switch (aspectRatio) {
    case 'landscape':
      return 16 / 9;
    case 'portrait':
      return 9 / 16;
    default:
      return taskType === 'video' ? 16 / 9 : 1;
  }
};

const roundToStep = (value: number, step = 8) =>
  Math.max(step, Math.round(value / step) * step);

const getDraftFrameSize = (
  taskType: CanvasCardMediaType,
  aspectRatio: WorkspaceAspectRatio
): ShapeSize => {
  const ratio = getAspectRatioValue(taskType, aspectRatio);
  const maxEdge = taskType === 'image' ? 380 : 420;

  if (ratio >= 1) {
    return {
      w: maxEdge,
      h: roundToStep(maxEdge / ratio, 1),
    };
  }

  return {
    w: roundToStep(maxEdge * ratio, 1),
    h: maxEdge,
  };
};

const getAssetFrameSize = (taskType: CanvasAssetMediaType): ShapeSize => {
  if (taskType === 'video') return { w: 420, h: VIDEO_FRAME_HEIGHT };
  if (taskType === 'audio') return { w: 320, h: 104 };
  if (taskType === 'timeline') return { w: 360, h: 220 };
  return { w: CARD_RESULT_SIZE, h: CARD_RESULT_SIZE };
};

const getDraftShapeSignature = (
  card: CanvasDraftCard,
  outputs: CanvasOutputCard[]
) =>
  [
    card.name,
    card.type,
    card.generationMode ?? card.type,
    card.analysisDepth ?? '',
    card.resultText ?? '',
    card.aspectRatio,
    card.status,
    card.error ?? '',
    card.workflowTemplateId ?? '',
    card.pinnedOutputId ?? '',
    card.referenceCardIds.join('|'),
    outputs
      .map((output) =>
        [
          output.id,
          output.status,
          output.url ?? '',
          output.resultText ?? '',
          output.error ?? '',
          output.generationSnapshot.modelId,
          output.generationSnapshot.aspectRatio,
          output.generationSnapshot.capturedAt,
        ].join(':')
      )
      .join('|'),
  ].join('::');

const getAssetShapeSignature = (card: CanvasCard) =>
  [
    card.name,
    card.kind,
    card.type,
    card.url ?? '',
    card.sourceGenerationId ?? '',
  ].join('::');

export const buildGenerationCardPresentation = ({
  card,
  outputs,
}: {
  card: CanvasDraftCard;
  outputs: CanvasOutputCard[];
}) => {
  const orderedOutputs = [...outputs]
    .filter((output) => output.status !== 'failed')
    .sort(
      (left, right) =>
        left.generationSnapshot.capturedAt.localeCompare(
          right.generationSnapshot.capturedAt
        ) || left.id.localeCompare(right.id)
    );
  const latestOutput = orderedOutputs[orderedOutputs.length - 1] ?? null;
  const pinnedOutput = card.pinnedOutputId
    ? orderedOutputs.find(
        (output) =>
          output.id === card.pinnedOutputId &&
          output.status === 'succeeded' &&
          Boolean(output.url || output.resultText)
      ) ?? null
    : null;
  const latestSucceededOutput = [...orderedOutputs]
    .reverse()
    .find(
      (output) =>
        output.status === 'succeeded' &&
        Boolean(output.url || output.resultText)
    );
  const isAnalysis = card.generationMode === 'analysis';
  const analysisReportCount = isAnalysis
    ? orderedOutputs.filter(
        (output) => output.status === 'succeeded' && Boolean(output.resultText)
      ).length
    : 0;

  return {
    status: latestOutput?.status ?? card.status,
    isAnalysis,
    latestOutputUrl: isAnalysis
      ? null
      : pinnedOutput?.url ?? latestSucceededOutput?.url ?? card.url ?? null,
    latestOutputText:
      isAnalysis
        ? null
        : pinnedOutput?.resultText ??
          latestSucceededOutput?.resultText ??
          card.resultText ??
          null,
    analysisReportCount,
    takes: buildGenerationTakes({
      outputs: orderedOutputs,
      pinnedOutputId: card.pinnedOutputId,
    }),
  };
};

export const buildAnalysisReportNodeProps = (
  outputCard: CanvasOutputCard,
  label: string
): GenerationCardNodeProps | null => {
  if (
    outputCard.generationSnapshot.generationMode !== 'analysis' ||
    outputCard.status !== 'succeeded' ||
    !outputCard.resultText
  ) {
    return null;
  }

  return {
    w: ANALYSIS_REPORT_FRAME_SIZE.w,
    h: ANALYSIS_REPORT_FRAME_SIZE.h,
    cardMediaType: 'video',
    label,
    status: 'succeeded',
    isAnalysis: true,
    latestOutputUrl: null,
    latestOutputText: outputCard.resultText,
    analysisReportCount: 0,
    takes: [],
  };
};

/**
 * Node props for an upscale card. Progress lives on the card so the node can be
 * re-rendered from persisted state — after a reload the poller resumes from the
 * last known percentage instead of starting over.
 */
export const buildUpscaleNodeProps = (
  card: CanvasUpscaleCard,
  title: string,
  size: { w: number; h: number }
): UpscaleCardNodeProps => {
  const options = normalizeUpscaleOptions(
    card.upscaleOptions ?? {
      backend: card.upscaleBackend ?? undefined,
      scale: card.upscaleScale ?? undefined,
    },
    card.type === 'image' ? 'image' : 'video'
  );
  return {
    w: size.w,
    h: size.h,
    upscaleNode: true,
    title,
    cardMediaType: card.type,
    status: card.status,
    thumbnailUrl: card.status === 'succeeded' ? card.url : null,
    sourceUrl: card.upscaleSourceUrl ?? null,
    scale: options.scale,
    backend: card.upscaleBackend ?? null,
    task: options.task,
    summary: formatUpscaleSummary(options),
    progress: card.upscaleProgress ?? 0,
    stage: card.upscaleStage ?? null,
    speedFps: card.upscaleSpeedFps ?? null,
    etaSeconds: card.upscaleEtaSeconds ?? null,
    errorMessage: card.error ?? null,
  };
};

const UPSCALE_CARD_SIZE = { w: 360, h: 236 } as const;

/** Where a folder icon lands when a subproject is created from a selection. */
const FOLDER_ICON_GAP = 24;

export const buildFolderNodeProps = (
  card: CanvasFolderCard,
  {
    memberCount,
    subfolderCount,
  }: {
    memberCount: number;
    subfolderCount: number;
  }
): FolderCardNodeProps => ({
  w: CANVAS_FOLDER_ICON_SIZE.w,
  h: CANVAS_FOLDER_ICON_SIZE.h,
  folderNode: true,
  label: card.name,
  memberCount,
  subfolderCount,
});

type GroupableEditor = {
  setCurrentTool?: (tool: string) => void;
  groupShapes?: (
    shapeIds: string[],
    options?: {
      groupId?: string;
    }
  ) => void;
  getShape?: (shapeId: string) => { id: string; type: string } | null;
  getShapePageBounds?: (shapeId: string) => {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
};

type ConnectorBindableEditor = {
  getShape?: (shapeId: string) => { id: string; type: string } | null;
  getSortedChildIdsForParent?: (shapeId: string) => string[];
  getShapePageBounds?: (shapeId: string) => {
    x: number;
    y: number;
    w: number;
    h: number;
    minX?: number;
    minY?: number;
    maxX?: number;
    maxY?: number;
  } | null;
};

type DraftShapeSizeEditor = {
  getShape?: (shapeId: string) => {
    id: string;
    type: string;
    props?: {
      w?: number;
      h?: number;
    };
  } | null;
};

type FrameParentBoundsEditor = {
  getShape?: (shapeId: string) => {
    id: string;
    type?: string;
    parentId?: string;
  } | null;
  getShapePageBounds?: (shapeId: string) => {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
};

export const groupCanvasShapes = (
  editor: GroupableEditor | null | undefined,
  shapeIds: string[],
  explicitGroupId?: string
) => {
  const uniqueShapeIds = Array.from(
    new Set(shapeIds.filter((shapeId) => shapeId.length > 0))
  );

  if (!editor || uniqueShapeIds.length === 0) {
    return null;
  }

  const validShapeIds = uniqueShapeIds.filter((shapeId) => {
    const shape = editor.getShape?.(shapeId);

    if (shape === null) {
      return false;
    }

    const bounds = editor.getShapePageBounds?.(shapeId);

    if (!bounds) {
      return true;
    }

    return [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite);
  });

  if (validShapeIds.length === 0) {
    return null;
  }

  if (validShapeIds.length === 1 || typeof editor.groupShapes !== 'function') {
    return validShapeIds[0] ?? null;
  }

  editor.setCurrentTool?.('select');
  try {
    editor.groupShapes(
      validShapeIds,
      explicitGroupId ? { groupId: explicitGroupId } : undefined
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('group bounds are invalid')
    ) {
      return validShapeIds[0] ?? null;
    }

    throw error;
  }

  if (explicitGroupId) {
    return editor.getShape?.(explicitGroupId)?.id ?? null;
  }

  return validShapeIds[0] ?? null;
};

export const resolveConnectorBindableShapeId = (
  editor: ConnectorBindableEditor | null | undefined,
  shapeId: string,
  options?: {
    preserveGroup?: boolean;
  }
) => {
  if (!editor || shapeId.length === 0) {
    return null;
  }

  const shape = editor.getShape?.(shapeId);
  if (!shape || shape.type !== 'group') {
    return shapeId;
  }

  if (options?.preserveGroup) {
    return shapeId;
  }

  const childIds = editor.getSortedChildIdsForParent?.(shapeId) ?? [];
  if (childIds.length === 0) {
    return shapeId;
  }

  const rankedChildren = childIds
    .map((childId) => ({
      childId,
      bounds: editor.getShapePageBounds?.(childId) ?? null,
    }))
    .filter(
      (
        entry
      ): entry is {
        childId: string;
        bounds: { x: number; y: number; w: number; h: number };
      } => Boolean(entry.bounds)
    )
    .sort((left, right) => {
      const areaDelta =
        right.bounds.w * right.bounds.h - left.bounds.w * left.bounds.h;
      if (areaDelta !== 0) {
        return areaDelta;
      }

      if (left.bounds.x !== right.bounds.x) {
        return left.bounds.x - right.bounds.x;
      }

      return left.bounds.y - right.bounds.y;
    });

  return rankedChildren[0]?.childId ?? childIds[0] ?? shapeId;
};

export const resolveFrameParentBounds = (
  editor: FrameParentBoundsEditor | null | undefined,
  shapeId: string
) => {
  if (!editor || shapeId.length === 0) {
    return null;
  }

  const shape = editor.getShape?.(shapeId);
  const parentId = shape?.parentId;

  if (!parentId || !editor.getShape?.(parentId)) {
    return null;
  }

  try {
    return editor.getShapePageBounds?.(parentId as any) ?? null;
  } catch {
    return null;
  }
};

export const resolveDraftShapeSize = (
  editor: DraftShapeSizeEditor | null | undefined,
  card: CanvasDraftCard
) => {
  if (!card.workflowTemplateId) {
    return getDraftFrameSize(card.type, card.aspectRatio);
  }

  const existingShape = editor?.getShape?.(card.id);
  const existingWidth = existingShape?.props?.w;
  const existingHeight = existingShape?.props?.h;

  if (
    typeof existingWidth === 'number' &&
    existingWidth > 0 &&
    typeof existingHeight === 'number' &&
    existingHeight > 0
  ) {
    return {
      w: existingWidth,
      h: existingHeight,
    };
  }

  return getDraftFrameSize(card.type, card.aspectRatio);
};

export function useBeatCanvasReactFlowAdapter({
  studioT,
  imageModels,
  videoModels,
  initialImageModelId,
  initialVideoModelId,
  canvasCards,
  canvasCardsRef,
  removeCanvasCard,
  replaceCanvasCards,
  setCanvasCard,
  setActiveComposerCardId,
  viewFolderId = null,
}: {
  studioT: StudioTranslateFn;
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
  initialImageModelId: string | null;
  initialVideoModelId: string | null;
  canvasCards: Record<string, CanvasCard>;
  canvasCardsRef: MutableRefObject<Record<string, CanvasCard>>;
  removeCanvasCard: (cardId: string) => void;
  replaceCanvasCards: (cards: Record<string, CanvasCard>) => void;
  setCanvasCard: (card: CanvasCard) => void;
  setActiveComposerCardId: (cardId: string | null) => void;
  /** Level that is drawn right now; `null` is the project's top level. */
  viewFolderId?: CanvasLevelId;
}) {
  const editorRef = useRef<BeatCanvasEditor | null>(null);
  const syncedDraftShapeSignaturesRef = useRef<Record<string, string>>({});
  const syncedAssetShapeSignaturesRef = useRef<Record<string, string>>({});
  const syncedUpscaleShapeSignaturesRef = useRef<Record<string, string>>({});
  const syncedFolderSignaturesRef = useRef<Record<string, string>>({});
  /**
   * Position of every card, including the ones on levels that are not drawn.
   * Shapes only exist for the level being shown, so without this cache leaving
   * a subproject would save its cards without a frame and scatter them on the
   * next reload.
   */
  const shapeFramesRef = useRef<Record<string, ProjectSnapshotShapeFrame>>({});
  /** Camera per level, so going back does not re-fit the whole canvas. */
  const levelCamerasRef = useRef<Record<string, ProjectSnapshotCamera>>({});
  const viewFolderIdRef = useRef<CanvasLevelId>(viewFolderId);
  viewFolderIdRef.current = viewFolderId;
  /**
   * Redraws the open level from cards + frame cache. It is defined further down
   * (after the shape creators), but dissolving a subproject above that point
   * needs it, so the implementation is published through this ref.
   */
  const refreshCanvasLevelShapesRef = useRef<() => void>(() => {});
  const undoStackRef = useRef<ProjectSnapshotDocument[]>([]);
  const redoStackRef = useRef<ProjectSnapshotDocument[]>([]);
  const isRestoringHistoryRef = useRef(false);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const captureCanvasDocument = useCallback((): ProjectSnapshotDocument => {
    const editor = editorRef.current;
    const cardsById = canvasCardsRef.current;
    // Start from every frame we know about, then refresh the level that is on
    // screen. Cards on other levels have no shape right now; their last known
    // frame is what keeps their position.
    const frames: Record<string, ProjectSnapshotShapeFrame> = {};
    for (const cardId of Object.keys(cardsById)) {
      const frame = shapeFramesRef.current[cardId];
      if (frame) frames[cardId] = frame;
    }
    for (const card of Object.values(cardsById)) {
      const bounds = editor?.getShapePageBounds(card.id);
      if (bounds) {
        frames[card.id] = {
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
        };
      }
    }
    shapeFramesRef.current = frames;

    return buildProjectSnapshotDocumentFromCards({
      cardsById: canvasCardsRef.current,
      framesById: frames,
      camera: editor?.getCamera(),
    });
  }, [canvasCardsRef]);

  const recordCanvasHistory = useCallback(() => {
    if (isRestoringHistoryRef.current) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      captureCanvasDocument(),
    ];
    redoStackRef.current = [];
    syncHistoryState();
  }, [captureCanvasDocument, syncHistoryState]);

  /**
   * Drops undo/redo. Only a level switch and a full external restore may do
   * this: a document restored *from* the history stacks must never clear them,
   * otherwise undo works once and redo is impossible.
   */
  const resetCanvasHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryState();
  }, [syncHistoryState]);

  const handleSelectShape = useCallback((shapeId: string | null) => {
    const editor = editorRef.current;
    if (!editor || !shapeId) return;

    if (typeof editor.setCurrentTool === 'function') {
      editor.setCurrentTool('select');
    }

    if (typeof editor.select === 'function') {
      editor.select(shapeId);
      return;
    }

    if (typeof editor.setSelectedShapes === 'function') {
      editor.setSelectedShapes([shapeId]);
    }
  }, []);

  const centerViewportOnPagePoint = useCallback(
    (point: { x: number; y: number }, options: CanvasFocusOptions = {}) => {
      const editor = editorRef.current;

      if (!editor) return;

      editor.centerOnPoint(point, {
        zoom: options.zoom,
        animation: {
          duration: 220,
        },
      });
    },
    []
  );

  const focusShape = useCallback(
    (shapeId: string, options: CanvasFocusOptions = {}) => {
      const editor = editorRef.current;
      if (!editor) return;

      const bounds = editor.getShapePageBounds(shapeId as any);
      if (!bounds) return;

      centerViewportOnPagePoint(
        {
          x: bounds.x + bounds.w / 2,
          y: bounds.y + bounds.h / 2,
        },
        options
      );
    },
    [centerViewportOnPagePoint]
  );

  const focusShapes = useCallback(
    (shapeIds: string[], options: CanvasFocusOptions = {}) => {
      const editor = editorRef.current;
      if (!editor) return;

      const bounds = shapeIds
        .map((shapeId) => editor.getShapePageBounds(shapeId as any))
        .filter(Boolean);
      if (bounds.length === 0) return;

      const union = bounds.reduce((accumulator: any, current: any) => {
        if (!accumulator) {
          return {
            x: current.x,
            y: current.y,
            w: current.w,
            h: current.h,
            minX: current.minX,
            minY: current.minY,
            maxX: current.maxX,
            maxY: current.maxY,
          };
        }

        const minX = Math.min(accumulator.minX, current.minX);
        const minY = Math.min(accumulator.minY, current.minY);
        const maxX = Math.max(accumulator.maxX, current.maxX);
        const maxY = Math.max(accumulator.maxY, current.maxY);

        return {
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          minX,
          minY,
          maxX,
          maxY,
        };
      }, null);

      if (!union) return;

      centerViewportOnPagePoint(
        {
          x: union.x + union.w / 2,
          y: union.y + union.h / 2,
        },
        options
      );
    },
    [centerViewportOnPagePoint]
  );

  const groupShapes = useCallback(
    (shapeIds: string[], explicitGroupId?: string) => {
      const editor = editorRef.current;
      const groupId = explicitGroupId ?? `shape:${makeId()}`;
      return groupCanvasShapes(editor, shapeIds, groupId);
    },
    []
  );

  const getViewportCenter = useCallback(() => {
    const editor = editorRef.current;
    const bounds = editor?.getViewportPageBounds?.();
    return bounds?.center
      ? {
          x: bounds.center.x,
          y: bounds.center.y,
        }
      : null;
  }, []);

  const getCanvasPlacement = useCallback(
    (
      sourceIds: string[] = [],
      offsetIndex = 0,
      size?: ShapeSize,
      side: CanvasPlacementSide = 'right'
    ): ShapePlacement => {
      const editor = editorRef.current;
      if (!editor) {
        return resolveCanvasPlacement({
          occupied: [],
          size,
          offsetIndex,
          side,
        });
      }

      const sourceFrames = sourceIds
        .map((id) => editor.getShapePageBounds(id as any))
        .filter(Boolean)
        .map((bounds: any) => ({
          x: bounds.minX,
          y: bounds.minY,
          w: bounds.maxX - bounds.minX,
          h: bounds.maxY - bounds.minY,
        }));
      const occupied = Object.keys(canvasCardsRef.current).flatMap((cardId) => {
        const bounds = editor.getShapePageBounds(cardId as any) as
          | { minX: number; minY: number; maxX: number; maxY: number }
          | undefined;
        return bounds
          ? [
              {
                x: bounds.minX,
                y: bounds.minY,
                w: bounds.maxX - bounds.minX,
                h: bounds.maxY - bounds.minY,
              },
            ]
          : [];
      });
      return resolveCanvasPlacement({
        sourceFrames,
        occupied,
        size,
        offsetIndex,
        side,
      });
    },
    [canvasCardsRef]
  );

  const createConnectorBetweenCards = useCallback(
    (
      sourceCardId: string,
      targetCardId: string,
      options?: { recordHistory?: boolean }
    ) => {
      const editor = editorRef.current;
      if (!editor) return;

      if (options?.recordHistory) {
        recordCanvasHistory();
      }

      const sourceShapeId = resolveConnectorBindableShapeId(
        editor,
        sourceCardId
      );
      const targetShapeId = resolveConnectorBindableShapeId(
        editor,
        targetCardId,
        { preserveGroup: true }
      );
      if (!sourceShapeId || !targetShapeId) return;
      editor.createConnection(sourceShapeId, targetShapeId);
    },
    [recordCanvasHistory]
  );

  const removeConnectorBetweenCards = useCallback(
    (
      sourceCardId: string,
      targetCardId: string,
      options?: { recordHistory?: boolean }
    ) => {
      const editor = editorRef.current;
      if (!editor) return;

      if (options?.recordHistory) {
        recordCanvasHistory();
      }

      const sourceShapeId = resolveConnectorBindableShapeId(
        editor,
        sourceCardId
      );
      const targetShapeId = resolveConnectorBindableShapeId(
        editor,
        targetCardId,
        { preserveGroup: true }
      );
      if (!sourceShapeId || !targetShapeId) return;
      editor.deleteConnection(sourceShapeId, targetShapeId);
    },
    [recordCanvasHistory]
  );

  const syncDraftShape = useCallback(
    (card: CanvasDraftCard, outputs: CanvasOutputCard[]) => {
      const editor = editorRef.current;
      if (!editor) return;

      const presentation = buildGenerationCardPresentation({
        card,
        outputs,
      });
      const size = resolveDraftShapeSize(editor, card);

      editor.updateShape({
        id: card.id,
        type: GENERATION_CARD_NODE_TYPE,
        meta: {
          [CARD_KIND_META_KEY]: 'generation',
          [CARD_TYPE_META_KEY]: card.type,
          ...(card.workflowTemplateId
            ? {
                [CARD_WORKFLOW_TEMPLATE_META_KEY]: card.workflowTemplateId,
              }
            : {}),
        },
        props: {
          w: size.w,
          h: size.h,
          cardMediaType: card.type,
          label: buildDraftShapeText(card),
          ...presentation,
        },
      });
    },
    []
  );

  const syncAssetShape = useCallback((card: CanvasCard) => {
    const editor = editorRef.current;
    if (!editor || card.kind !== 'asset') return;

    editor.updateShape({
      id: card.id,
      type: ASSET_CARD_NODE_TYPE,
      meta: {
        [CARD_KIND_META_KEY]: card.kind,
        [CARD_TYPE_META_KEY]: card.type,
        ...(card.sourceGenerationId
          ? {
              [CARD_SOURCE_META_KEY]: card.sourceGenerationId,
            }
          : {}),
        ...(card.workflowTemplateId
          ? {
              [CARD_WORKFLOW_TEMPLATE_META_KEY]: card.workflowTemplateId,
            }
          : {}),
      },
      props: {
        title: card.name,
        thumbnailUrl: card.url ?? '',
        durationSec: card.durationSec,
        audioRole: card.audioRole,
        timelineId: card.timelineId,
        clipCount: card.clipCount,
      },
    });
  }, []);

  const insertAssetCard = useCallback(
    ({
      type,
      url,
      name,
      assetId,
      sourceGenerationId,
      sourceCardIds = [],
      anchorCardIds,
      placementSide = 'right',
      placementOffsetIndex = 0,
      activateOnInsert = true,
      size,
      shapeId,
      frame,
      existingCard,
      fitMode = 'cover',
      chromeMode = 'default',
      workflowTemplateId = null,
      durationSec,
      audioRole,
      timelineId,
      clipCount,
      lastRenderAssetId,
      recordHistory = true,
    }: {
      type: CanvasAssetMediaType;
      url?: string | null;
      name: string;
      kind?: 'asset';
      assetId?: string | null;
      sourceGenerationId?: string | null;
      sourceCardIds?: string[];
      anchorCardIds?: string[];
      placementSide?: CanvasPlacementSide;
      placementOffsetIndex?: number;
      activateOnInsert?: boolean;
      size?: ShapeSize;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      existingCard?: CanvasAssetCard;
      fitMode?: 'cover' | 'contain';
      chromeMode?: 'default' | 'frameless';
      workflowTemplateId?: string | null;
      durationSec?: number | null;
      audioRole?: CanvasCard['audioRole'];
      timelineId?: string | null;
      clipCount?: number | null;
      lastRenderAssetId?: string | null;
      recordHistory?: boolean;
    }) => {
      const editor = editorRef.current;
      if (!editor) return null;

      if (recordHistory) {
        recordCanvasHistory();
      }

      const nextSize = frame
        ? { w: frame.w, h: frame.h }
        : (size ?? getAssetFrameSize(type));
      const inferredAspectRatio = resolveWorkspaceAspectRatioFromDimensions({
        width: nextSize.w,
        height: nextSize.h,
        fallback:
          existingCard?.aspectRatio ?? (type === 'image' ? '1:1' : '16:9'),
      });
      const fallbackPlacement = getCanvasPlacement(
        anchorCardIds ?? sourceCardIds,
        placementOffsetIndex,
        nextSize,
        placementSide
      );
      const { x, y } = frame ?? fallbackPlacement;
      const nextShapeId = shapeId ?? `shape:${makeId()}`;

      editor.createShape({
        id: nextShapeId,
        type: ASSET_CARD_NODE_TYPE,
        x,
        y,
        meta: {
          [CARD_KIND_META_KEY]: 'asset',
          [CARD_TYPE_META_KEY]: type,
          ...(sourceGenerationId
            ? {
                [CARD_SOURCE_META_KEY]: sourceGenerationId,
              }
            : {}),
          ...(workflowTemplateId
            ? {
                [CARD_WORKFLOW_TEMPLATE_META_KEY]: workflowTemplateId,
              }
            : {}),
        },
        props: {
          w: nextSize.w,
          h: nextSize.h,
          cardMediaType: type,
          title: name,
          thumbnailUrl: url ?? '',
          fitMode,
          chromeMode,
          durationSec: durationSec ?? existingCard?.durationSec,
          audioRole: audioRole ?? existingCard?.audioRole,
          timelineId: timelineId ?? existingCard?.timelineId,
          clipCount: clipCount ?? existingCard?.clipCount,
        },
      });

      for (const sourceCardId of sourceCardIds) {
        createConnectorBetweenCards(sourceCardId, nextShapeId);
      }

      const folderIdForCard =
        existingCard?.folderId ??
        inheritFolderId(canvasCardsRef.current, sourceCardIds);

      setCanvasCard(
        existingCard
          ? { ...existingCard, aspectRatio: inferredAspectRatio }
          : {
              id: nextShapeId,
              assetId: assetId ?? null,
              kind: 'asset',
              type,
              name,
              url: url ?? null,
              prompt: '',
              referenceCardIds: sourceCardIds,
              workflowTemplateId,
              status: 'succeeded',
              error: null,
              modelId: '',
              aspectRatio: inferredAspectRatio,
              outputQuality: type === 'image' ? '1k' : '1080p',
              duration: '5s',
              mode: 'quality',
              variant: 'standard',
              quality: 'standard',
              sourceGenerationId: sourceGenerationId ?? null,
              durationSec: durationSec ?? null,
              audioRole,
              timelineId: timelineId ?? null,
              clipCount: clipCount ?? null,
              lastRenderAssetId: lastRenderAssetId ?? null,
              // Results of a node inside a folder belong to that folder.
              folderId: folderIdForCard,
            }
      );

      if (activateOnInsert) {
        handleSelectShape(nextShapeId);
        focusShape(nextShapeId);
      }
      return nextShapeId;
    },
    [
      createConnectorBetweenCards,
      focusShape,
      getCanvasPlacement,
      handleSelectShape,
      setCanvasCard,
      recordCanvasHistory,
    ]
  );

  const materializeAnalysisReport = useCallback(
    ({
      outputCard,
      draftCard,
      frame,
      connectSource = true,
    }: {
      outputCard: CanvasOutputCard;
      draftCard: CanvasDraftCard;
      frame?: ProjectSnapshotShapeFrame;
      connectSource?: boolean;
    }) => {
      const editor = editorRef.current;
      const reportProps = buildAnalysisReportNodeProps(
        outputCard,
        studioT('canvas.shapes.analysisReport')
      );
      if (!editor || !reportProps) return false;

      const reportIndex = Object.values(canvasCardsRef.current).filter(
        (candidate) =>
          isCanvasOutputCard(candidate) &&
          candidate.id !== outputCard.id &&
          candidate.sourceConfigCardId === draftCard.id &&
          candidate.generationSnapshot.generationMode === 'analysis' &&
          candidate.status === 'succeeded' &&
          Boolean(candidate.resultText)
      ).length;
      const reportSize = frame
        ? { w: frame.w, h: frame.h }
        : ANALYSIS_REPORT_FRAME_SIZE;
      const placement =
        frame ??
        getCanvasPlacement(
          [draftCard.id],
          reportIndex,
          reportSize,
          'right'
        );

      editor.createShape({
        id: outputCard.id,
        type: GENERATION_CARD_NODE_TYPE,
        x: placement.x,
        y: placement.y,
        meta: {
          [CARD_KIND_META_KEY]: 'output',
          [CARD_TYPE_META_KEY]: 'video',
          ...(outputCard.sourceGenerationId
            ? { [CARD_SOURCE_META_KEY]: outputCard.sourceGenerationId }
            : {}),
        },
        props: {
          ...reportProps,
          w: reportSize.w,
          h: reportSize.h,
        },
      });
      if (connectSource) {
        createConnectorBetweenCards(draftCard.id, outputCard.id);
      }
      return true;
    },
    [canvasCardsRef, createConnectorBetweenCards, getCanvasPlacement, studioT]
  );

  const createGenerationOutput = useCallback(
    ({
      draftCard,
      name,
      suppressFocus = false,
      shapeId,
      frame,
      existingCard,
      connectSource = true,
    }: {
      draftCard: CanvasDraftCard;
      name: string;
      suppressFocus?: boolean;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      existingCard?: CanvasOutputCard;
      connectSource?: boolean;
    }) => {
      if (!editorRef.current) return null;

      const outputCardId = shapeId ?? `output:${makeId()}`;
      const models = draftCard.type === 'image' ? imageModels : videoModels;
      const model = getSelectableModel(models, draftCard.modelId);
      const resolvedAspectRatio = resolveReferenceDrivenDraftAspectRatio({
        draftCard,
        cards: canvasCardsRef.current,
        model,
      });
      const nextCard: CanvasOutputCard = existingCard ?? {
        ...draftCard,
        aspectRatio: resolvedAspectRatio,
        id: outputCardId,
        kind: 'output',
        name,
        url: null,
        referenceCardIds: [draftCard.id],
        status: 'pending',
        error: null,
        sourceGenerationId: null,
        sourceConfigCardId: draftCard.id,
        // A result belongs to the level of the node that produced it, even when
        // it finishes while another subproject is open.
        folderId: draftCard.folderId ?? null,
        generationRunId: `run:${makeId()}`,
        generationSnapshot: {
          type: draftCard.type,
          generationMode: draftCard.generationMode,
          analysisDepth: draftCard.analysisDepth,
          prompt: draftCard.prompt,
          referenceCardIds: [...draftCard.referenceCardIds],
          workflowTemplateId: draftCard.workflowTemplateId,
          modelId: draftCard.modelId,
          connectionId:draftCard.connectionId,
          aspectRatio: resolvedAspectRatio,
          outputQuality: draftCard.outputQuality,
          duration: draftCard.duration,
          language: draftCard.language,
          mode: draftCard.mode,
          variant: draftCard.variant,
          quality: draftCard.quality,
          seedanceSettings: draftCard.seedanceSettings,
          ...(draftCard.characterOrientation
            ? { characterOrientation: draftCard.characterOrientation }
            : {}),
          ...(draftCard.backgroundSource
            ? { backgroundSource: draftCard.backgroundSource }
            : {}),
          resultText: draftCard.resultText ?? null,
          capturedAt: new Date().toISOString(),
        },
      };
      setCanvasCard(nextCard);

      const createdReportShape = materializeAnalysisReport({
        outputCard: nextCard,
        draftCard,
        frame,
        connectSource,
      });

      if (!suppressFocus && createdReportShape) {
        focusShape(nextCard.id);
      } else if (!suppressFocus) {
        focusShape(draftCard.id);
      }
      return outputCardId;
    },
    [
      canvasCardsRef,
      focusShape,
      imageModels,
      materializeAnalysisReport,
      setCanvasCard,
      videoModels,
    ]
  );

  const updateGenerationOutput = useCallback(
    (outputCardId: string, patch: Partial<CanvasOutputCard>) => {
      const current = canvasCardsRef.current[outputCardId];
      if (!isCanvasOutputCard(current)) return;
      setCanvasCard({
        ...current,
        ...patch,
      });
    },
    [canvasCardsRef, setCanvasCard]
  );

  const completeGenerationOutput = useCallback(
    ({
      outputCardId,
      draftCard,
      url,
      resultText = null,
      name,
      sourceGenerationId = null,
      suppressFocus = false,
    }: {
      outputCardId: string;
      draftCard: CanvasDraftCard;
      url?: string | null;
      resultText?: string | null;
      name: string;
      sourceGenerationId?: string | null;
      suppressFocus?: boolean;
    }) => {
      const current = canvasCardsRef.current[outputCardId];
      if (!editorRef.current || !isCanvasOutputCard(current)) return null;

      const completedOutputCard: CanvasOutputCard = {
        ...current,
        assetId:
          parseLocalProjectAssetUrl(url)?.assetId ?? current.assetId ?? null,
        name,
        url: url ?? null,
        resultText,
        status: 'succeeded',
        error: null,
        sourceGenerationId,
      };
      const isAnalysisOutput =
        completedOutputCard.generationSnapshot.generationMode === 'analysis';
      setCanvasCard(completedOutputCard);
      setCanvasCard({
        ...draftCard,
        url: isAnalysisOutput ? null : (url ?? null),
        resultText: isAnalysisOutput ? null : resultText,
      });

      const createdReportShape = materializeAnalysisReport({
        outputCard: completedOutputCard,
        draftCard,
      });

      if (!suppressFocus && createdReportShape) {
        focusShape(completedOutputCard.id);
      } else if (!suppressFocus) {
        focusShape(draftCard.id);
      }
      return outputCardId;
    },
    [
      canvasCardsRef,
      focusShape,
      materializeAnalysisReport,
      setCanvasCard,
    ]
  );

  const createDraftCard = useCallback(
    ({
      taskType,
      prompt,
      referenceCardIds,
      workflowTemplateId = null,
      presetName,
      aspectRatio,
      language,
      placementSide = 'right',
      anchorCardIds,
      placementOffsetIndex = 0,
      placementPoint,
      connectReferences = true,
      shapeId,
      frame,
      existingCard,
      activateOnInsert = true,
      recordHistory = true,
    }: {
      taskType: CanvasCardMediaType;
      prompt: string;
      referenceCardIds: string[];
      workflowTemplateId?: string | null;
      presetName?: string;
      aspectRatio?: WorkspaceAspectRatio;
      language?: CanvasDraftCard['language'];
      placementSide?: CanvasPlacementSide;
      anchorCardIds?: string[];
      placementOffsetIndex?: number;
      placementPoint?: ShapePlacement;
      connectReferences?: boolean;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      existingCard?: CanvasDraftCard;
      activateOnInsert?: boolean;
      recordHistory?: boolean;
    }) => {
      const editor = editorRef.current;
      const model =
        taskType === 'image'
          ? getSelectableModel(imageModels, initialImageModelId)
          : getSelectableModel(videoModels, initialVideoModelId);

      if (!editor || !model) return null;

      if (recordHistory) {
        recordCanvasHistory();
      }

      const defaults = getDraftDefaultsFromModel(taskType, model);
      const cardId = shapeId ?? `shape:${makeId()}`;
      const baseNextCard: CanvasDraftCard = existingCard ?? {
        id: cardId,
        kind: 'generation',
        type: defaults.type,
        generationMode: defaults.type,
        name:
          presetName ??
          (defaults.type === 'image'
            ? studioT('canvas.frame.imageTitle')
            : studioT('canvas.frame.videoTitle')),
        url: null,
        prompt,
        referenceCardIds,
        workflowTemplateId,
        status: 'idle',
        error: null,
        modelId: defaults.modelId,
        aspectRatio: aspectRatio ?? defaults.aspectRatio,
        outputQuality: defaults.outputQuality,
        duration: defaults.duration,
        language: language ?? defaults.language,
        mode: defaults.mode,
        variant: defaults.variant,
        quality: defaults.quality,
        ...(defaults.characterOrientation
          ? { characterOrientation: defaults.characterOrientation }
          : {}),
        ...(defaults.backgroundSource
          ? { backgroundSource: defaults.backgroundSource }
          : {}),
        sourceGenerationId: null,
        customFilename: null,
      };
      const selectedCardModel = getSelectableModel(
        taskType === 'image' ? imageModels : videoModels,
        baseNextCard.modelId
      );
      const nextCard: CanvasDraftCard = {
        ...baseNextCard,
        aspectRatio: resolveReferenceDrivenDraftAspectRatio({
          draftCard: baseNextCard,
          cards: canvasCardsRef.current,
          model: selectedCardModel,
        }),
      };
      const size = frame
        ? { w: frame.w, h: frame.h }
        : getDraftFrameSize(nextCard.type, nextCard.aspectRatio);
      const fallbackPlacement = placementPoint
        ? {
            x: placementPoint.x,
            y: placementPoint.y,
          }
        : getCanvasPlacement(
            anchorCardIds ?? referenceCardIds,
            placementOffsetIndex,
            size,
            placementSide
          );
      const { x, y } = frame ?? fallbackPlacement;

      editor.createShape({
        id: cardId,
        type: GENERATION_CARD_NODE_TYPE,
        x,
        y,
        meta: {
          [CARD_KIND_META_KEY]: 'generation',
          [CARD_TYPE_META_KEY]: defaults.type,
          ...(workflowTemplateId
            ? {
                [CARD_WORKFLOW_TEMPLATE_META_KEY]: workflowTemplateId,
              }
            : {}),
        },
        props: {
          w: size.w,
          h: size.h,
          cardMediaType: defaults.type,
          label: buildDraftShapeText(nextCard),
          status: 'idle',
          takes: [],
        },
      });

      if (connectReferences) {
        for (const referenceCardId of referenceCardIds) {
          createConnectorBetweenCards(referenceCardId, cardId);
        }
      }

      setCanvasCard(nextCard);
      if (activateOnInsert) {
        setActiveComposerCardId(cardId);
        handleSelectShape(cardId);
        focusShape(cardId);
      }
      return cardId;
    },
    [
      createConnectorBetweenCards,
      focusShape,
      getCanvasPlacement,
      handleSelectShape,
      imageModels,
      initialImageModelId,
      initialVideoModelId,
      setActiveComposerCardId,
      setCanvasCard,
      recordCanvasHistory,
      canvasCardsRef,
      studioT,
      videoModels,
    ]
  );

  const createTextCard=useCallback(({text='',name='Text',placementPoint,shapeId,frame,existingCard,recordHistory=true,activateOnInsert=true}:{text?:string;name?:string;placementPoint?:ShapePlacement;shapeId?:string;frame?:ProjectSnapshotShapeFrame;existingCard?:CanvasTextCard;recordHistory?:boolean;activateOnInsert?:boolean}={})=>{
    const editor=editorRef.current;if(!editor)return null;
    if(recordHistory)recordCanvasHistory();
    const id=shapeId??`shape:${makeId()}`,size={w:460,h:440};
    const point=frame??placementPoint??getCanvasPlacement([],0,size,'right');
    const card:CanvasTextCard=existingCard??{id,kind:'text',type:'text',name,url:null,prompt:text,referenceCardIds:[],workflowTemplateId:null,status:'idle',error:null,modelId:'',aspectRatio:'1:1',outputQuality:'1k',duration:'5s',mode:'quality',variant:'standard',quality:'standard',sourceGenerationId:null,textHistory:[]};
    editor.createShape({id,type:TEXT_CARD_NODE_TYPE,x:point.x,y:point.y,meta:{[CARD_KIND_META_KEY]:'text',[CARD_TYPE_META_KEY]:'text'},props:{w:frame?.w??size.w,h:frame?.h??size.h,textNode:true}});
    setCanvasCard(card);
    if(activateOnInsert){setActiveComposerCardId(null);handleSelectShape(id);focusShape(id);}
    return id;
  },[focusShape,getCanvasPlacement,handleSelectShape,recordCanvasHistory,setActiveComposerCardId,setCanvasCard]);

  const createDirectorCard = useCallback(
    ({
      name = 'Director desk',
      placementPoint,
      shapeId,
      frame,
      existingCard,
      recordHistory = true,
      activateOnInsert = true,
    }: {
      name?: string;
      placementPoint?: ShapePlacement;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      existingCard?: CanvasDirectorCard;
      recordHistory?: boolean;
      activateOnInsert?: boolean;
    } = {}) => {
      const editor = editorRef.current;
      if (!editor) return null;
      if (recordHistory) recordCanvasHistory();
      const id = shapeId ?? `shape:${makeId()}`;
      const size = { w: 360, h: 220 };
      const point =
        frame ?? placementPoint ?? getCanvasPlacement([], 0, size, 'right');
      const card: CanvasDirectorCard = existingCard ?? {
        id,
        kind: 'director',
        type: 'director',
        name,
        url: null,
        prompt: '',
        referenceCardIds: [],
        workflowTemplateId: null,
        status: 'idle',
        error: null,
        modelId: '',
        aspectRatio: '16:9',
        outputQuality: '1k',
        duration: '5s',
        mode: 'quality',
        variant: 'standard',
        quality: 'standard',
        sourceGenerationId: null,
        lastExportAssetId: null,
        lastExportUrl: null,
      };
      editor.createShape({
        id,
        type: DIRECTOR_CARD_NODE_TYPE,
        x: point.x,
        y: point.y,
        meta: {
          [CARD_KIND_META_KEY]: 'director',
          [CARD_TYPE_META_KEY]: 'director',
        },
        props: {
          w: frame?.w ?? size.w,
          h: frame?.h ?? size.h,
          directorNode: true,
          label: card.name,
          lastExportUrl: card.lastExportUrl ?? null,
        },
      });
      setCanvasCard(card);
      if (activateOnInsert) {
        setActiveComposerCardId(null);
        handleSelectShape(id);
        focusShape(id);
      }
      return id;
    },
    [
      focusShape,
      getCanvasPlacement,
      handleSelectShape,
      recordCanvasHistory,
      setActiveComposerCardId,
      setCanvasCard,
    ]
  );

  const createUpscaleCard = useCallback(
    ({
      card,
      title,
      placementPoint,
      shapeId,
      frame,
      connectReferences = true,
      recordHistory = true,
      activateOnInsert = true,
    }: {
      card: CanvasUpscaleCard;
      title: string;
      placementPoint?: ShapePlacement;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      connectReferences?: boolean;
      recordHistory?: boolean;
      activateOnInsert?: boolean;
    }) => {
      const editor = editorRef.current;
      if (!editor) return null;
      if (recordHistory) recordCanvasHistory();
      const id = shapeId ?? card.id;
      const size = UPSCALE_CARD_SIZE;
      const point =
        frame ?? placementPoint ?? getCanvasPlacement([], 0, size, 'right');
      const resolved: CanvasUpscaleCard = { ...card, id };
      editor.createShape({
        id,
        type: UPSCALE_CARD_NODE_TYPE,
        x: point.x,
        y: point.y,
        meta: {
          [CARD_KIND_META_KEY]: 'upscale',
          [CARD_TYPE_META_KEY]: card.type,
        },
        props: buildUpscaleNodeProps(resolved, title, {
          w: frame?.w ?? size.w,
          h: frame?.h ?? size.h,
        }),
      });
      setCanvasCard(resolved);
      if (connectReferences) {
        // The link to the source is what makes the node read as "this media,
        // upscaled"; the restore plan rebuilds it from referenceCardIds.
        for (const referenceCardId of resolved.referenceCardIds) {
          if (referenceCardId !== id) {
            createConnectorBetweenCards(referenceCardId, id);
          }
        }
      }
      if (activateOnInsert) {
        setActiveComposerCardId(null);
        handleSelectShape(id);
      }
      return id;
    },
    [
      createConnectorBetweenCards,
      getCanvasPlacement,
      handleSelectShape,
      recordCanvasHistory,
      setActiveComposerCardId,
      setCanvasCard,
    ]
  );

  /** Push card progress onto the existing node without touching its geometry. */
  const syncUpscaleShape = useCallback(
    (card: CanvasUpscaleCard, title: string) => {
      const editor = editorRef.current;
      if (!editor || card.kind !== 'upscale') return;
      const existing = editor.getShape?.(card.id);
      const props = (existing?.props ?? {}) as { w?: number; h?: number };
      const size = {
        w: typeof props.w === 'number' ? props.w : UPSCALE_CARD_SIZE.w,
        h: typeof props.h === 'number' ? props.h : UPSCALE_CARD_SIZE.h,
      };
      editor.updateShape({
        id: card.id,
        type: UPSCALE_CARD_NODE_TYPE,
        meta: {
          [CARD_KIND_META_KEY]: 'upscale',
          [CARD_TYPE_META_KEY]: card.type,
        },
        props: buildUpscaleNodeProps(card, title, size),
      });
    },
    []
  );

  const createFolderCard = useCallback(
    ({
      card,
      memberCount = 0,
      subfolderCount = 0,
      placementPoint,
      shapeId,
      frame,
      recordHistory = true,
      activateOnInsert = true,
    }: {
      card: CanvasFolderCard;
      memberCount?: number;
      subfolderCount?: number;
      placementPoint?: ShapePlacement;
      shapeId?: string;
      frame?: ProjectSnapshotShapeFrame;
      recordHistory?: boolean;
      activateOnInsert?: boolean;
    }) => {
      const editor = editorRef.current;
      if (!editor) return null;
      if (recordHistory) recordCanvasHistory();
      const id = shapeId ?? card.id;
      // A folder icon keeps the level it was created on; its own frame is the
      // position of the icon only, never a panel around its content.
      const resolved: CanvasFolderCard = { ...card, id };
      const point = frame ?? placementPoint ?? { x: 0, y: 0 };
      editor.createShape({
        id,
        type: FOLDER_CARD_NODE_TYPE,
        x: point.x,
        y: point.y,
        meta: {
          [CARD_KIND_META_KEY]: 'folder',
          [CARD_TYPE_META_KEY]: 'folder',
        },
        props: buildFolderNodeProps(resolved, { memberCount, subfolderCount }),
      });
      setCanvasCard(resolved);
      if (activateOnInsert) {
        setActiveComposerCardId(null);
        handleSelectShape(id);
      }
      return id;
    },
    [
      handleSelectShape,
      recordCanvasHistory,
      setActiveComposerCardId,
      setCanvasCard,
    ]
  );

  /**
   * Merges a partial update into a card. `setCanvasCard` takes a whole card, and
   * the adapter does not receive the shell's functional updater.
   */
  const patchCanvasCard = useCallback(
    (cardId: string, patch: Partial<CanvasCard>) => {
      const current = canvasCardsRef.current[cardId];
      if (!current) return;
      setCanvasCard({ ...current, ...patch } as CanvasCard);
    },
    [canvasCardsRef, setCanvasCard]
  );

  /**
   * Turns the current selection into a folder.
   *
   * Creating the folder also cuts every link that crosses its boundary, so the
   * group becomes self-contained: it can no longer consume upstream results and
   * nothing outside can consume its results.
   *
   * With an empty selection an empty folder is created at `placementPoint`, so a
   * folder can be made first and filled by dragging nodes into it.
   */
  const createFolderFromSelection = useCallback(
    (
      memberIds: readonly string[],
      name: string,
      placementPoint?: { x: number; y: number }
    ) => {
      const editor = editorRef.current;
      if (!editor) return null;
      const parentLevelId = viewFolderIdRef.current;
      const allCards = Object.values(canvasCardsRef.current);
      // No third level: the entry point is disabled, this is the data guard.
      if (!canCreateFolderIn(allCards, parentLevelId)) return null;
      const unique = [...new Set(memberIds)].filter((id) => {
        const card = canvasCardsRef.current[id];
        return (
          card && card.kind !== 'folder' && cardLevelId(card) === parentLevelId
        );
      });
      if (unique.length === 0 && !placementPoint) return null;

      const bounds = unique
        .map((id) => editor.getShapePageBounds?.(id) ?? null)
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
      let frame: ProjectSnapshotShapeFrame;
      if (bounds.length > 0) {
        // The icon replaces the group on this level, just above where the group
        // was, so the canvas stays readable after the nodes move inside.
        const minX = Math.min(...bounds.map((value) => value.x));
        const minY = Math.min(...bounds.map((value) => value.y));
        frame = {
          x: minX,
          y: minY - CANVAS_FOLDER_ICON_SIZE.h - FOLDER_ICON_GAP,
          w: CANVAS_FOLDER_ICON_SIZE.w,
          h: CANVAS_FOLDER_ICON_SIZE.h,
        };
      } else {
        // Empty subproject: the click point is its top-left corner.
        frame = {
          x: placementPoint?.x ?? 0,
          y: placementPoint?.y ?? 0,
          w: CANVAS_FOLDER_ICON_SIZE.w,
          h: CANVAS_FOLDER_ICON_SIZE.h,
        };
      }

      const folderId = `shape:${makeId()}`;
      const card: CanvasFolderCard = {
        id: folderId,
        kind: 'folder',
        type: 'folder',
        name,
        url: null,
        prompt: '',
        referenceCardIds: [],
        workflowTemplateId: null,
        status: 'idle',
        error: null,
        modelId: '',
        aspectRatio: '16:9',
        outputQuality: '1k',
        duration: '5s',
        mode: 'quality',
        variant: 'standard',
        quality: 'standard',
        sourceGenerationId: null,
        // The icon itself lives on the level that is open right now.
        folderId: parentLevelId,
      };

      recordCanvasHistory();
      const createdId = createFolderCard({
        card,
        memberCount: unique.length,
        frame,
        recordHistory: false,
        activateOnInsert: false,
      });
      if (!createdId) return null;

      if (unique.length === 0) {
        editor.setSelectedShapes([]);
        return createdId;
      }

      const plan = planCanvasFolderCreation({
        cards: allCards,
        folderId: createdId,
        memberIds: unique,
      });
      for (const update of plan.updates) {
        patchCanvasCard(update.cardId, {
          folderId: update.folderId,
          referenceCardIds: update.referenceCardIds,
          ...(update.sourceTextCardId === null
            ? { sourceTextCardId: null }
            : {}),
        });
      }
      for (const removal of plan.removals) {
        removeConnectorBetweenCards(removal.sourceCardId, removal.targetCardId);
      }
      // The members just left this level, so their shapes go away with them.
      editor.deleteShapes(unique);

      // Leave nothing selected: the folder is now the group, and a lingering
      // multi-selection would hide per-node actions (upscale, duplicate...).
      editor.setSelectedShapes([]);
      return createdId;
    },
    [
      canvasCardsRef,
      createFolderCard,
      patchCanvasCard,
      recordCanvasHistory,
      removeConnectorBetweenCards,
    ]
  );

  /**
   * Adopts a card dropped onto a subproject icon.
   *
   * A subproject can be created empty and filled afterwards, so membership is
   * not decided only at creation time. Dropping a node on the icon moves it
   * inside, which is the same act as grouping a selection: the node leaves this
   * level, so its links that would cross the boundary are cut. Adoption is
   * one-way — dragging a node off the icon does nothing, because silently
   * cutting links on a stray drag would be destructive.
   */
  const reconcileFolderMembership = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const levelId = viewFolderIdRef.current;
    const cards = Object.values(canvasCardsRef.current);
    const levelCards = cards.filter((card) => cardLevelId(card) === levelId);
    const folders = levelCards.filter(
      (card): card is CanvasFolderCard => card.kind === 'folder'
    );
    if (folders.length === 0) return;
    const boundsOf = (id: string) => editor.getShapePageBounds?.(id) ?? null;
    const folderBounds = new Map(
      folders.map((folder) => [folder.id, boundsOf(folder.id)] as const)
    );
    for (const card of levelCards) {
      if (card.kind === 'folder') continue;
      const bounds = boundsOf(card.id);
      if (!bounds) continue;
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      for (const folder of folders) {
        const frame = folderBounds.get(folder.id);
        if (!frame) continue;
        const inside =
          centerX >= frame.x &&
          centerX <= frame.x + frame.w &&
          centerY >= frame.y &&
          centerY <= frame.y + frame.h;
        if (!inside) continue;
        const plan = planCardAdoptionIntoFolder({
          cards,
          folderId: folder.id,
          cardId: card.id,
        });
        for (const update of plan.updates) {
          patchCanvasCard(update.cardId, {
            folderId: update.folderId,
            referenceCardIds: update.referenceCardIds,
            ...(update.sourceTextCardId === null
              ? { sourceTextCardId: null }
              : {}),
          });
        }
        for (const removal of plan.removals) {
          removeConnectorBetweenCards(
            removal.sourceCardId,
            removal.targetCardId
          );
        }
        // The node belongs to another level from now on.
        editor.deleteShapes([card.id]);
        break;
      }
    }
  }, [
    canvasCardsRef,
    patchCanvasCard,
    removeConnectorBetweenCards,
  ]);

  /**
   * Deleting a subproject keeps its content: the icon goes away and everything
   * inside moves up one level, laid out around where the icon was.
   */
  const dissolveFolder = useCallback(
    (folderId: string) => {
      const editor = editorRef.current;
      const folder = canvasCardsRef.current[folderId];
      if (!editor || folder?.kind !== 'folder') return false;
      const cards = Object.values(canvasCardsRef.current);
      const plan = planFolderDissolve({ cards, folderId });
      if (plan.cardIdsToDelete.length === 0) return false;
      const origin = editor.getShapePageBounds?.(folderId) ?? null;
      const frames = shapeFramesRef.current;
      recordCanvasHistory();
      for (const update of plan.updates) {
        patchCanvasCard(update.cardId, { folderId: update.folderId });
        // Their coordinates were relative to the level that just disappeared.
        const frame = frames[update.cardId];
        if (origin && frame) {
          shapeFramesRef.current[update.cardId] = {
            ...frame,
            x: origin.x + (frame.x - (frames[folderId]?.x ?? 0)),
            y: origin.y + (frame.y - (frames[folderId]?.y ?? 0)),
          };
        }
      }
      if (editor.getShape(folderId)) editor.deleteShape(folderId);
      removeCanvasCard(folderId);
      // Cards that just moved onto this level need a shape right away: text and
      // director nodes are not covered by the card→shape sync effects, so
      // without this they would look deleted until the next level switch.
      refreshCanvasLevelShapesRef.current();
      return true;
    },
    [canvasCardsRef, patchCanvasCard, recordCanvasHistory, removeCanvasCard]
  );

  const buildProjectSnapshotDocument = captureCanvasDocument;

  /**
   * Draws one document on the canvas: every shape is removed and rebuilt from
   * the cards the document contains. Cards are not touched here — the caller
   * owns which card collection is authoritative, because the collection always
   * holds every level while only one level is drawn.
   */
  const applyDocumentShapes = useCallback(
    (document: ProjectSnapshotDocument) => {
      const editor = editorRef.current;
      const restoredCardIds: string[] = [];
      const restoredDraftIds: string[] = [];
      if (!editor) return { cardIds: restoredCardIds, draftIds: restoredDraftIds };

      const currentShapeIds = editor
        .getCurrentPageShapes()
        .map((shape) => shape.id);
      if (currentShapeIds.length > 0) {
        editor.deleteShapes(currentShapeIds);
      }
      syncedDraftShapeSignaturesRef.current = {};
      syncedAssetShapeSignaturesRef.current = {};
      syncedUpscaleShapeSignaturesRef.current = {};
      syncedFolderSignaturesRef.current = {};

      const restorePlan = createProjectSnapshotRestorePlan(document);
      // Folders first: a member's node can then already see its subproject icon.
      for (const item of restorePlan.folderCards) {
        const memberCount = countLevelCards(document.cards, item.card.id);
        const subfolderCount = countLevelSubfolders(document.cards, item.card.id);
        const id = createFolderCard({
          card: item.card,
          memberCount,
          subfolderCount,
          shapeId: item.card.id,
          frame: item.frame,
          recordHistory: false,
          activateOnInsert: false,
        });
        if (id) restoredCardIds.push(id);
      }
      for(const item of restorePlan.textCards){const id=createTextCard({shapeId:item.card.id,frame:item.frame,existingCard:item.card,recordHistory:false,activateOnInsert:false});if(id)restoredCardIds.push(id);}

      for (const item of restorePlan.directorCards) {
        const id = createDirectorCard({
          shapeId: item.card.id,
          frame: item.frame,
          existingCard: item.card,
          recordHistory: false,
          activateOnInsert: false,
        });
        if (id) restoredCardIds.push(id);
      }

      for (const item of restorePlan.upscaleCards) {
        const id = createUpscaleCard({
          card: item.card,
          title: item.card.name,
          shapeId: item.card.id,
          frame: item.frame,
          connectReferences: false,
          recordHistory: false,
          activateOnInsert: false,
        });
        if (id) restoredCardIds.push(id);
      }

      for (const item of restorePlan.assetCards) {
        const insertedAssetCardId = insertAssetCard({
          type: item.card.type,
          url: item.card.url ?? '',
          name: item.card.name,
          kind: item.card.kind,
          sourceGenerationId: item.card.sourceGenerationId,
          sourceCardIds: [],
          activateOnInsert: false,
          shapeId: item.card.id,
          frame: item.frame,
          existingCard: item.card,
          recordHistory: false,
        });
        if (insertedAssetCardId) {
          restoredCardIds.push(insertedAssetCardId);
        }
      }

      for (const item of restorePlan.draftCards) {
        const insertedDraftCardId = createDraftCard({
          taskType: item.card.type,
          prompt: item.card.prompt,
          referenceCardIds: item.card.referenceCardIds,
          workflowTemplateId: item.card.workflowTemplateId,
          presetName: item.card.name,
          connectReferences: false,
          shapeId: item.card.id,
          frame: item.frame,
          existingCard: item.card,
          activateOnInsert: false,
          recordHistory: false,
        });
        if (insertedDraftCardId) {
          restoredCardIds.push(insertedDraftCardId);
          restoredDraftIds.push(insertedDraftCardId);
        }
      }

      for (const item of restorePlan.outputCards) {
        const sourceConfigCard = canvasCardsRef.current[
          item.card.sourceConfigCardId
        ];
        if (!isCanvasDraftCard(sourceConfigCard)) {
          continue;
        }

        const insertedOutputCardId = createGenerationOutput({
          draftCard: sourceConfigCard,
          name: item.card.name,
          suppressFocus: true,
          shapeId: item.card.id,
          frame: item.frame,
          existingCard: item.card,
          connectSource: true,
        });
        if (insertedOutputCardId) {
          restoredCardIds.push(insertedOutputCardId);
        }
      }

      for (const connector of restorePlan.connectors) {
        createConnectorBetweenCards(
          connector.sourceCardId,
          connector.targetCardId
        );
      }

      return { cardIds: restoredCardIds, draftIds: restoredDraftIds };
    },
    [
      createConnectorBetweenCards,
      createDirectorCard,
      createDraftCard,
      createFolderCard,
      createGenerationOutput,
      createTextCard,
      createUpscaleCard,
      canvasCardsRef,
      insertAssetCard,
    ]
  );

  const restoreProjectSnapshot = useCallback(
    (document: ProjectSnapshotDocument) => {
      if (!editorRef.current) return;

      // Every frame of every level: cards on other levels have no shape, and the
      // capture below needs their positions to keep the project intact.
      shapeFramesRef.current = { ...document.frames };
      // History is deliberately NOT cleared here: undo/redo restores through this
      // function, so clearing would make undo work once and drop the redo stack.
      // A level switch calls resetCanvasHistory, and the shell resets it when a
      // whole project document arrives from outside.

      replaceCanvasCards(
        Object.fromEntries(document.cards.map((card) => [card.id, card] as const))
      );
      const { cardIds, draftIds } = applyDocumentShapes(
        buildLevelDocument(document, viewFolderIdRef.current)
      );
      if (draftIds.length > 0) {
        setActiveComposerCardId(draftIds[0]);
      }

      runAfterPaint(() => {
        if (document.camera) {
          editorRef.current?.setCamera(document.camera, {
            animation: { duration: 0 },
          });
          return;
        }
        if (cardIds.length > 0) {
          focusShapes(cardIds);
        }
      });
    },
    [
      applyDocumentShapes,
      focusShapes,
      replaceCanvasCards,
      setActiveComposerCardId,
    ]
  );

  /**
   * Redraws the current level from the cards and the frame cache.
   *
   * Membership changes that are not a level switch (dissolving a subproject,
   * deleting one through a generic delete) move cards onto the level that is
   * already open. Text and director cards have no card→shape sync effect, so
   * without this they stay invisible until the next switch or reload.
   */
  const refreshCanvasLevelShapes = useCallback(() => {
    if (!editorRef.current) return;
    captureCanvasDocument();
    applyDocumentShapes(
      buildLevelDocument(
        {
          version: 3,
          cards: Object.values(canvasCardsRef.current),
          frames: shapeFramesRef.current,
        },
        viewFolderIdRef.current
      )
    );
  }, [applyDocumentShapes, canvasCardsRef, captureCanvasDocument]);
  refreshCanvasLevelShapesRef.current = refreshCanvasLevelShapes;

  /**
   * Switches the canvas to one level (a subproject, or the top level).
   *
   * The card collection is not touched: entering a subproject only changes what
   * is drawn, which is why leaving it can never lose the parent's cards.
   */
  const showCanvasLevel = useCallback(
    (levelId: CanvasLevelId) => {
      const editor = editorRef.current;
      if (!editor) return;
      // Positions of the level being left have to be refreshed before its
      // shapes are deleted.
      captureCanvasDocument();
      // Every level remembers where the user was looking, so going back to the
      // parent does not jump to a fit of everything.
      const leavingCamera = editor.getCamera?.();
      if (leavingCamera) {
        levelCamerasRef.current[levelCameraKey(viewFolderIdRef.current)] =
          leavingCamera;
      }
      const levelDocument = buildLevelDocument(
        {
          version: 3,
          cards: Object.values(canvasCardsRef.current),
          frames: shapeFramesRef.current,
        },
        levelId
      );
      const { cardIds } = applyDocumentShapes(levelDocument);
      // Undo is per level: replaying a top-level undo while inside a subproject
      // would delete cards the user cannot see.
      resetCanvasHistory();
      editor.setSelectedShapes([]);
      setActiveComposerCardId(null);

      runAfterPaint(() => {
        const remembered = levelCamerasRef.current[levelCameraKey(levelId)];
        if (remembered) {
          editorRef.current?.setCamera(remembered, {
            animation: { duration: 0 },
          });
          return;
        }
        if (cardIds.length > 0) {
          focusShapes(cardIds);
          return;
        }
        // An empty subproject: start from a known camera instead of wherever
        // the previous level happened to be.
        editorRef.current?.setCamera({ x: 0, y: 0, z: 1 }, {
          animation: { duration: 0 },
        });
      });
    },
    [
      applyDocumentShapes,
      canvasCardsRef,
      captureCanvasDocument,
      focusShapes,
      resetCanvasHistory,
      setActiveComposerCardId,
    ]
  );

  const applyHistoryDocument = useCallback(
    (document: ProjectSnapshotDocument) => {
      const editor = editorRef.current;
      if (!editor) return;

      isRestoringHistoryRef.current = true;
      const historyDocument = mergeCanvasRuntimeCardsIntoHistoryDocument({
        target: document,
        current: captureCanvasDocument(),
      });
      const currentShapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
      if (currentShapeIds.length > 0) {
        editor.deleteShapes(currentShapeIds);
      }
      replaceCanvasCards({});
      syncedDraftShapeSignaturesRef.current = {};
      syncedAssetShapeSignaturesRef.current = {};
      syncedUpscaleShapeSignaturesRef.current = {};
      restoreProjectSnapshot(historyDocument);

      const finishRestore = () => {
        isRestoringHistoryRef.current = false;
      };
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(finishRestore);
      } else {
        finishRestore();
      }
    },
    [captureCanvasDocument, replaceCanvasCards, restoreProjectSnapshot]
  );

  const undoCanvas = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;

    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current.slice(-49),
      captureCanvasDocument(),
    ];
    applyHistoryDocument(previous);
    syncHistoryState();
  }, [applyHistoryDocument, captureCanvasDocument, syncHistoryState]);

  const redoCanvas = useCallback(() => {
    const next = redoStackRef.current.at(-1);
    if (!next) return;

    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      captureCanvasDocument(),
    ];
    applyHistoryDocument(next);
    syncHistoryState();
  }, [applyHistoryDocument, captureCanvasDocument, syncHistoryState]);

  // Every sync below only touches cards of the level that is on screen. The card
  // collection holds all levels, and `updateShape` would happily create a shape
  // for a hidden card, which is exactly how a card would leak across levels.
  useEffect(() => {
    const nextSignatures: Record<string, string> = {};

    for (const card of Object.values(canvasCards)) {
      if (!isCanvasDraftCard(card)) continue;
      if (cardLevelId(card) !== viewFolderId) continue;

      const outputs = Object.values(canvasCards).filter(
        (candidate): candidate is CanvasOutputCard =>
          isCanvasOutputCard(candidate) &&
          candidate.sourceConfigCardId === card.id
      );
      const signature = getDraftShapeSignature(card, outputs);
      nextSignatures[card.id] = signature;

      if (syncedDraftShapeSignaturesRef.current[card.id] === signature) {
        continue;
      }

      syncDraftShape(card, outputs);
    }

    syncedDraftShapeSignaturesRef.current = nextSignatures;
  }, [canvasCards, syncDraftShape, viewFolderId]);

  useEffect(() => {
    const nextSignatures: Record<string, string> = {};

    for (const card of Object.values(canvasCards)) {
      if (isCanvasDraftCard(card) || isCanvasOutputCard(card) || isCanvasUpscaleCard(card) || !card.url) {
        continue;
      }
      if (cardLevelId(card) !== viewFolderId) continue;

      const signature = getAssetShapeSignature(card);
      nextSignatures[card.id] = signature;

      if (syncedAssetShapeSignaturesRef.current[card.id] === signature) {
        continue;
      }

      syncAssetShape(card);
    }

    syncedAssetShapeSignaturesRef.current = nextSignatures;
  }, [canvasCards, syncAssetShape, viewFolderId]);

  useEffect(() => {
    const nextSignatures: Record<string, string> = {};

    for (const card of Object.values(canvasCards)) {
      if (!isCanvasUpscaleCard(card)) continue;
      if (cardLevelId(card) !== viewFolderId) continue;
      const signature = [
        card.status,
        card.url ?? '',
        card.name,
        card.upscaleStage ?? '',
        String(Math.round((card.upscaleProgress ?? 0) * 100)),
        card.error ?? '',
      ].join('::');
      nextSignatures[card.id] = signature;

      if (syncedUpscaleShapeSignaturesRef.current[card.id] === signature) {
        continue;
      }

      syncUpscaleShape(card, card.name);
    }

    syncedUpscaleShapeSignaturesRef.current = nextSignatures;
  }, [canvasCards, syncUpscaleShape, viewFolderId]);

  // A folder icon shows its name, how many entries it holds and whether anything
  // is nested inside it, so a rename, a new member or a new subproject has to be
  // pushed back onto the shape.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const cards = Object.values(canvasCards);
    for (const card of cards) {
      if (card.kind !== 'folder') continue;
      if (cardLevelId(card) !== viewFolderId) continue;
      const memberCount = countLevelCards(cards, card.id);
      const subfolderCount = countLevelSubfolders(cards, card.id);
      const signature = `${card.name}::${memberCount}::${subfolderCount}`;
      if (syncedFolderSignaturesRef.current[card.id] === signature) continue;
      editor.updateShape({
        id: card.id,
        type: FOLDER_CARD_NODE_TYPE,
        meta: {
          [CARD_KIND_META_KEY]: 'folder',
          [CARD_TYPE_META_KEY]: 'folder',
        },
        props: buildFolderNodeProps(card, { memberCount, subfolderCount }),
      });
      syncedFolderSignaturesRef.current[card.id] = signature;
    }
  }, [canvasCards, viewFolderId]);

  // Safety net for the level invariant: a shape may only exist for a card of the
  // level being shown. Background work (a generation finishing while another
  // subproject is open) creates real cards, and this is what keeps their shape
  // from appearing on the wrong canvas.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const strayShapeIds = editor
      .getCurrentPageShapes()
      .filter((shape) => {
        const card = canvasCards[shape.id];
        return !card || cardLevelId(card) !== viewFolderId;
      })
      .map((shape) => shape.id);
    if (strayShapeIds.length > 0) {
      editor.deleteShapes(strayShapeIds);
    }
  }, [canvasCards, viewFolderId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const visibleReportIds = new Set(
      Object.values(canvasCards)
        .filter(
          (card): card is CanvasOutputCard =>
            isCanvasOutputCard(card) &&
            card.generationSnapshot.generationMode === 'analysis' &&
            card.status === 'succeeded' &&
            Boolean(card.resultText)
        )
        .map((card) => card.id)
    );
    const orphanedReportShapeIds = editor
      .getCurrentPageShapes()
      .filter(
        (shape) =>
          shape.meta[CARD_KIND_META_KEY] === 'output' &&
          !visibleReportIds.has(shape.id)
      )
      .map((shape) => shape.id);

    if (orphanedReportShapeIds.length > 0) {
      editor.deleteShapes(orphanedReportShapeIds);
    }
  }, [canvasCards]);

  const deleteCanvasCard = useCallback(
    (cardId: string) => {
      const editor = editorRef.current;
      if (!editor || typeof editor.deleteShape !== 'function') {
        return;
      }

      recordCanvasHistory();
      // Deleting a subproject dissolves it: its cards stay on the canvas and move
      // up one level, instead of pointing at a folder that no longer exists.
      if (canvasCardsRef.current[cardId]?.kind === 'folder') {
        const plan = planFolderDissolve({
          cards: Object.values(canvasCardsRef.current),
          folderId: cardId,
        });
        for (const update of plan.updates) {
          patchCanvasCard(update.cardId, { folderId: update.folderId });
        }
      }
      editor.deleteShape(cardId as any);
      removeCanvasCard(cardId);
    },
    [
      canvasCardsRef,
      patchCanvasCard,
      recordCanvasHistory,
      removeCanvasCard,
    ]
  );

  const updateCanvasCardFrame = useCallback(
    (cardId: string, frame: ProjectSnapshotShapeFrame) => {
      const editor = editorRef.current;
      if (!editor || typeof editor.updateShape !== 'function') {
        return;
      }

      const existingShape = editor.getShape?.(cardId as any) as
        | {
            type?: string;
            parentId?: string;
            props?: {
              w?: number;
              h?: number;
            };
          }
        | undefined;

      const parentBounds = resolveFrameParentBounds(editor, cardId);

      editor.updateShape({
        id: cardId,
        type: existingShape?.type ?? ASSET_CARD_NODE_TYPE,
        x: parentBounds ? frame.x - parentBounds.x : frame.x,
        y: parentBounds ? frame.y - parentBounds.y : frame.y,
        props: {
          ...(existingShape?.props ?? {}),
          w: frame.w,
          h: frame.h,
        },
      });
    },
    []
  );

  const bringCanvasCardsToFront = useCallback((cardIds: string[]) => {
    const editor = editorRef.current as
      | {
          bringToFront?: (shapeIds: string[]) => void;
        }
      | null
      | undefined;

    if (!editor?.bringToFront || cardIds.length === 0) {
      return;
    }

    editor.bringToFront(Array.from(new Set(cardIds)));
  }, []);

  const clipboardRef = useRef<{
    cards: CanvasCard[];
    frames: Record<string, ProjectSnapshotShapeFrame>;
  } | null>(null);

  const copySelectedCanvasCards = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || typeof editor.getSelectedShapeIds !== 'function') {
      return false;
    }

    const selectedCardIds = editor
      .getSelectedShapeIds()
      .filter(
        (shapeId) =>
          canvasCardsRef.current[shapeId]?.kind !== 'output' &&
          Boolean(canvasCardsRef.current[shapeId])
      );
    if (selectedCardIds.length === 0) {
      return false;
    }

    const frames: Record<string, ProjectSnapshotShapeFrame> = {};
    for (const cardId of selectedCardIds) {
      const bounds = editor.getShapePageBounds(cardId as never);
      if (bounds) {
        frames[cardId] = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
      }
    }

    clipboardRef.current = {
      cards: selectedCardIds.map(
        (cardId) => canvasCardsRef.current[cardId] as CanvasCard
      ),
      frames,
    };
    return true;
  }, [canvasCardsRef]);

  const pasteCanvasCards = useCallback(() => {
    const clipboard = clipboardRef.current;
    const editor = editorRef.current;
    if (!clipboard || clipboard.cards.length === 0 || !editor) {
      return false;
    }

    recordCanvasHistory();

    const PASTE_OFFSET = 32;
    // The copy lands on the level that is open, never on the level it was
    // copied from: otherwise the new card would be invisible here and would
    // silently add a node to a subproject the user is not looking at.
    const targetLevelId = viewFolderIdRef.current;
    const idMap = new Map<string, string>();
    for (const card of clipboard.cards) {
      idMap.set(card.id, `shape:${makeId()}`);
    }

    const sameLevel = (cardId: string) =>
      (canvasCardsRef.current[cardId]?.folderId ?? null) === targetLevelId;

    const remapReferences = (referenceCardIds: string[]) =>
      Array.from(
        new Set(
          referenceCardIds
            .map((referenceCardId) => {
              if (idMap.has(referenceCardId)) {
                return idMap.get(referenceCardId) as string;
              }
              // A reference into another level cannot be kept: it would be
              // hidden here and still feed the next generation.
              return canvasCardsRef.current[referenceCardId] &&
                sameLevel(referenceCardId)
                ? referenceCardId
                : null;
            })
            .filter((cardId): cardId is string => Boolean(cardId))
        )
      );

    const pastedCardIds: string[] = [];
    let skippedRunningUpscale = 0;
    for (const card of clipboard.cards) {
      const nextId = idMap.get(card.id) as string;
      const frame = clipboard.frames[card.id];
      const nextFrame = frame
        ? {
            ...frame,
            x: frame.x + PASTE_OFFSET,
            y: frame.y + PASTE_OFFSET,
          }
        : undefined;

      if (card.kind === 'generation') {
        const nextReferences = remapReferences(card.referenceCardIds);
        createDraftCard({
          taskType: card.type,
          prompt: card.prompt,
          referenceCardIds: nextReferences,
          workflowTemplateId: card.workflowTemplateId,
          presetName: card.name,
          aspectRatio: card.aspectRatio,
          language: card.language,
          shapeId: nextId,
          frame: nextFrame,
          existingCard: {
            ...card,
            id: nextId,
            kind: 'generation',
            folderId: targetLevelId,
            referenceCardIds: nextReferences,
            status: 'idle',
            error: null,
            pinnedOutputId: null,
            sourceTextCardId: card.sourceTextCardId
              ? (() => {
                  const remapped =
                    idMap.get(card.sourceTextCardId) ?? card.sourceTextCardId;
                  return sameLevel(remapped) ? remapped : null;
                })()
              : null,
          },
          connectReferences: true,
          activateOnInsert: false,
          recordHistory: false,
        });
        pastedCardIds.push(nextId);
        continue;
      }
      if(card.kind==='text'){createTextCard({shapeId:nextId,frame:nextFrame,existingCard:{...card,id:nextId,folderId:targetLevelId,textCandidate:null},activateOnInsert:false,recordHistory:false});pastedCardIds.push(nextId);continue;}

      if (card.kind === 'director') {
        // The copied node keeps its own scene file (keyed by card id), so the
        // new node starts empty and its exports stay separate.
        createDirectorCard({
          shapeId: nextId,
          frame: nextFrame,
          existingCard: {
            ...card,
            id: nextId,
            folderId: targetLevelId,
            lastExportAssetId: null,
            lastExportUrl: null,
          },
          activateOnInsert: false,
          recordHistory: false,
        });
        pastedCardIds.push(nextId);
        continue;
      }

      if (card.kind === 'folder') {
        // A copied folder starts empty: membership is per card and those cards
        // were not necessarily copied with it. It lands on the level being
        // shown, which is also where a third level must not be created.
        if (
          !canCreateFolderIn(
            Object.values(canvasCardsRef.current),
            viewFolderIdRef.current
          )
        ) {
          continue;
        }
        createFolderCard({
          card: { ...card, id: nextId, folderId: targetLevelId },
          memberCount: 0,
          shapeId: nextId,
          frame: nextFrame,
          activateOnInsert: false,
          recordHistory: false,
        });
        pastedCardIds.push(nextId);
        continue;
      }

      if (card.kind === 'upscale') {
        // Polling and cancelling both need the job id, and retrying needs the
        // source node. A copy of a node whose job is still running would have
        // neither, so it could never finish: refuse that one with a reason
        // instead of pasting a permanently busy node.
        if (card.status === 'pending' || card.status === 'processing') {
          skippedRunningUpscale += 1;
          continue;
        }
        // A finished copy keeps its media and its source, so a failed one can
        // still be retried; it never adopts the original job id.
        createUpscaleCard({
          card: {
            ...card,
            id: nextId,
            folderId: targetLevelId,
            upscaleJobId: null,
            referenceCardIds: remapReferences(card.referenceCardIds),
          },
          title: card.name,
          shapeId: nextId,
          frame: nextFrame,
          connectReferences: false,
          activateOnInsert: false,
          recordHistory: false,
        });
        pastedCardIds.push(nextId);
        continue;
      }

      if (card.kind === 'asset') {
        insertAssetCard({
          type: card.type,
          url: card.url ?? '',
          name: card.name,
          kind: 'asset',
          assetId: card.assetId,
          sourceGenerationId: card.sourceGenerationId,
          sourceCardIds: [],
          shapeId: nextId,
          frame: nextFrame,
          existingCard: {
            ...card,
            id: nextId,
            folderId: targetLevelId,
            referenceCardIds: [],
          },
          activateOnInsert: false,
          recordHistory: false,
        });
        pastedCardIds.push(nextId);
      }
    }

    for(const id of pastedCardIds){const card=canvasCardsRef.current[id];if(card?.kind==='generation'&&card.sourceTextCardId&&canvasCardsRef.current[card.sourceTextCardId])createConnectorBetweenCards(card.sourceTextCardId,id);}
    if (pastedCardIds.length > 0) {
      focusShapes(pastedCardIds);
    }
    if (skippedRunningUpscale > 0) {
      // Say why nothing appeared: a silently skipped paste looks like a bug.
      toast.error(
        studioT('messages.upscaleCopyRunning', {
          count: skippedRunningUpscale,
        })
      );
    }
    return true;
  }, [
    canvasCardsRef,
    createDraftCard,
    createTextCard,
    focusShapes,
    createConnectorBetweenCards,
    createDirectorCard,
    createFolderCard,
    createUpscaleCard,
    insertAssetCard,
    recordCanvasHistory,
    studioT,
  ]);

  return {
    buildProjectSnapshotDocument,
    canUndoCanvas: historyState.canUndo,
    canRedoCanvas: historyState.canRedo,
    recordCanvasHistory,
    resetCanvasHistory,
    undoCanvas,
    redoCanvas,
    createConnectorBetweenCards,
    removeConnectorBetweenCards,
    copySelectedCanvasCards,
    pasteCanvasCards,
    createGenerationOutput,
    updateGenerationOutput,
    completeGenerationOutput,
    deleteCanvasCard,
    createDirectorCard,
    createUpscaleCard,
    createFolderCard,
    createFolderFromSelection,
    reconcileFolderMembership,
    dissolveFolder,
    refreshCanvasLevelShapes,
    showCanvasLevel,
    createDraftCard,
    createTextCard,
    editorRef,
    focusShape,
    focusShapes,
    getViewportCenter,
    groupShapes,
    handleSelectShape,
    insertAssetCard,
    restoreProjectSnapshot,
    bringCanvasCardsToFront,
    updateCanvasCardFrame,
  };
}
