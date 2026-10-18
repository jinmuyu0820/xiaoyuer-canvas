import type {
  CanvasCard,
} from '@/core/beatcanvas/canvas-types';
import { isCanvasFolderCard } from '@/core/beatcanvas/canvas-types';
import { seedanceSettingsSchema } from '@/core/adapters/ark-contract';
import {textCandidateSchema,textVersionSchema,TEXT_HISTORY_LIMIT} from '@/core/beatcanvas/text-contract';
import { normalizeUpscaleOptions } from '@/core/upscale/upscale-contract';
import {
  inspectFolderChain,
  MAX_CANVAS_FOLDER_DEPTH,
} from './canvas-levels';

export const MAX_PROJECT_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_PROJECT_SNAPSHOT_CARDS = 200;
const MAX_CARD_REFERENCES = 50;
const MAX_ID_CHARS = 200;
const MAX_NAME_CHARS = 500;
const MAX_CUSTOM_FILENAME_CHARS = 200;
const MAX_PROMPT_CHARS = 20_000;
const MAX_RESULT_TEXT_CHARS = 100_000;
const MAX_URL_CHARS = 4_096;

export class ProjectSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSnapshotValidationError';
  }
}

export const hasProjectSnapshotVersionConflict = ({
  currentVersion,
  baseVersion,
  documentChanged,
}: {
  currentVersion: number;
  baseVersion: number | null | undefined;
  documentChanged: boolean;
}) =>
  documentChanged &&
  (typeof baseVersion !== 'number' || currentVersion !== baseVersion);

export type ProjectSnapshotShapeFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ProjectSnapshotCamera = {
  x: number;
  y: number;
  z: number;
};

export type ProjectSnapshotActiveTemplateWorkflow = {
  slug: string;
  title: string;
  source: string;
  taskType: CanvasCard['type'];
  enteredAt: string;
};

export type ProjectSnapshotDocument = {
  version: 3;
  cards: CanvasCard[];
  frames: Record<string, ProjectSnapshotShapeFrame>;
  camera?: ProjectSnapshotCamera;
  workflows?: {
    activeTemplate?: ProjectSnapshotActiveTemplateWorkflow | null;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeString = (value: unknown, maxChars = MAX_NAME_CHARS) =>
  typeof value === 'string' ? value.slice(0, maxChars) : '';

const normalizeFrame = (value: unknown): ProjectSnapshotShapeFrame | null => {
  if (!isRecord(value)) {
    return null;
  }

  const x = value.x;
  const y = value.y;
  const w = value.w;
  const h = value.h;

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(w) ||
    !isFiniteNumber(h)
  ) {
    return null;
  }
  return { x, y, w, h };
};

const normalizeCamera = (value: unknown): ProjectSnapshotCamera | null => {
  if (!isRecord(value)) {
    return null;
  }

  const x = value.x;
  const y = value.y;
  const z = value.z;

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    z <= 0
  ) {
    return null;
  }

  return { x, y, z };
};

const normalizeActiveTemplateWorkflow = (
  value: unknown
): ProjectSnapshotActiveTemplateWorkflow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const slug = normalizeString(value.slug);
  const title = normalizeString(value.title);
  const source = normalizeString(value.source) || 'template-library';
  const taskType = value.taskType === 'video' ? 'video' : 'image';
  const enteredAt = normalizeString(value.enteredAt);

  if (!slug || !title) {
    return null;
  }

  return {
    slug,
    title,
    source,
    taskType,
    enteredAt,
  };
};

const normalizeCard = (source: unknown): CanvasCard | null => {
  if (!isRecord(source)) {
    return null;
  }
  let value: Record<string, unknown> = source;
  if (value.type === 'timeline') {
    // Old rendered timelines become ordinary video assets; empty editing nodes retire.
    if (!value.url || !(value.assetId || value.lastRenderAssetId)) return null;
    value = { ...value, type: 'video', assetId: value.assetId || value.lastRenderAssetId };
  }

  const referenceCardIds = Array.isArray(value.referenceCardIds)
    ? value.referenceCardIds.filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.length > 0 &&
          item.length <= MAX_ID_CHARS
      ).slice(0, MAX_CARD_REFERENCES)
    : [];

  const id = typeof value.id === 'string' ? value.id : null;
  const kind = typeof value.kind === 'string' ? value.kind : null;
  const type = typeof value.type === 'string' ? value.type : null;
  const name = typeof value.name === 'string' ? value.name : null;
  const workflowTemplateId =
    typeof value.workflowTemplateId === 'string'
      ? value.workflowTemplateId
      : null;
  const modelId =
    typeof value.modelId === 'string'
      ? value.modelId
      : '';

  if (
    !id ||
    id.length > MAX_ID_CHARS ||
    !['asset', 'generation', 'output', 'text', 'director', 'upscale', 'folder'].includes(kind || '') ||
    !['image', 'video', 'audio', 'text', 'director', 'folder'].includes(type || '') ||
    !name ||
    name.length > MAX_NAME_CHARS
  ) {
    return null;
  }
  // A director node never owns media itself; its exports become asset cards.
  if ((kind === 'director') !== (type === 'director')) {
    return null;
  }
  // Same for a folder: it groups cards, it is not media.
  if ((kind === 'folder') !== (type === 'folder')) {
    return null;
  }

  const sourceConfigCardId =
    typeof value.sourceConfigCardId === 'string'
      ? value.sourceConfigCardId.slice(0, MAX_ID_CHARS)
      : null;
  const generationRunId =
    typeof value.generationRunId === 'string'
      ? value.generationRunId.slice(0, MAX_ID_CHARS)
      : null;
  const generationSnapshot = isRecord(value.generationSnapshot)
    ? (value.generationSnapshot as CanvasCard['generationSnapshot'])
    : null;
  if (
    kind === 'output' &&
    (!sourceConfigCardId || !generationRunId || !generationSnapshot)
  ) {
    return null;
  }
  if (kind !== 'asset' && (type === 'audio' || type === 'timeline')) {
    return null;
  }
  if((kind==='text')!==(type==='text'))return null;

  return {
    id,
    assetId: typeof value.assetId === 'string' ? value.assetId : null,
    kind: kind as CanvasCard['kind'],
    type: type as CanvasCard['type'],
    generationMode:
      value.generationMode === 'analysis' ||
      value.generationMode === 'image' ||
      value.generationMode === 'video'
        ? value.generationMode
        : undefined,
    analysisDepth:
      value.analysisDepth === 'deep' || value.analysisDepth === 'standard'
        ? value.analysisDepth
        : undefined,
    name,
    url:
      typeof value.url === 'string' && value.url.length <= MAX_URL_CHARS
        ? value.url
        : null,
    resultText:
      typeof value.resultText === 'string'
        ? value.resultText.slice(0, MAX_RESULT_TEXT_CHARS)
        : null,
    prompt: normalizeString(value.prompt, MAX_PROMPT_CHARS),
    referenceCardIds,
    workflowTemplateId,
    status:
      typeof value.status === 'string'
        ? (value.status as CanvasCard['status'])
        : 'idle',
    error: typeof value.error === 'string' ? value.error : null,
    modelId,
    connectionId:typeof value.connectionId==='string'?value.connectionId:undefined,
    sourceTextCardId:typeof value.sourceTextCardId==='string'?value.sourceTextCardId.slice(0,MAX_ID_CHARS):null,
    ...(kind==='text'?{textInstruction:normalizeString(value.textInstruction,3000),textCandidate:textCandidateSchema.safeParse(value.textCandidate).data??null,textHistory:Array.isArray(value.textHistory)?value.textHistory.slice(0,TEXT_HISTORY_LIMIT).flatMap(item=>{const parsed=textVersionSchema.safeParse(item);return parsed.success?[parsed.data]:[];}):[]}:{}),
    seedanceSettings: seedanceSettingsSchema.safeParse(value.seedanceSettings).data,
    aspectRatio:
      typeof value.aspectRatio === 'string'
        ? (value.aspectRatio as CanvasCard['aspectRatio'])
        : '1:1',
    outputQuality:
      typeof value.outputQuality === 'string'
        ? (value.outputQuality as CanvasCard['outputQuality'])
        : '1k',
    duration:
      typeof value.duration === 'string'
        ? (value.duration as CanvasCard['duration'])
        : '5s',
    language:
      typeof value.language === 'string'
        ? (value.language as CanvasCard['language'])
        : undefined,
    mode:
      typeof value.mode === 'string'
        ? (value.mode as CanvasCard['mode'])
        : 'quality',
    variant:
      typeof value.variant === 'string'
        ? (value.variant as CanvasCard['variant'])
        : 'standard',
    quality:
      typeof value.quality === 'string'
        ? (value.quality as CanvasCard['quality'])
        : 'standard',
    characterOrientation:
      value.characterOrientation === 'image' ||
      value.characterOrientation === 'video'
        ? value.characterOrientation
        : undefined,
    backgroundSource:
      value.backgroundSource === 'input_image' ||
      value.backgroundSource === 'input_video'
        ? value.backgroundSource
        : undefined,
    sourceGenerationId:
      typeof value.sourceGenerationId === 'string'
        ? value.sourceGenerationId
        : null,
    sourceConfigCardId,
    generationRunId,
    generationSnapshot,
    pinnedOutputId:
      typeof value.pinnedOutputId === 'string' ? value.pinnedOutputId : null,
    audioRole:
      value.audioRole === 'music' ||
      value.audioRole === 'voice' ||
      value.audioRole === 'sound_effect' ||
      value.audioRole === 'source_audio' ||
      value.audioRole === 'reference'
        ? value.audioRole
        : undefined,
    durationSec: isFiniteNumber(value.durationSec)
      ? Math.max(0, value.durationSec)
      : null,
    waveformPeaks: Array.isArray(value.waveformPeaks)
      ? value.waveformPeaks
          .filter(isFiniteNumber)
          .slice(0, 256)
          .map((peak) => Math.max(0, Math.min(1, peak)))
      : undefined,
    timelineId:
      typeof value.timelineId === 'string'
        ? value.timelineId.slice(0, MAX_ID_CHARS)
        : null,
    clipCount: isFiniteNumber(value.clipCount)
      ? Math.max(0, Math.floor(value.clipCount))
      : null,
    lastRenderAssetId:
      typeof value.lastRenderAssetId === 'string'
        ? value.lastRenderAssetId.slice(0, MAX_ID_CHARS)
        : null,
    // Director-only fields: adding them to every card would break the strict
    // public card contract used by commands/MCP.
    ...(kind === 'director'
      ? {
          lastExportAssetId:
            typeof value.lastExportAssetId === 'string'
              ? value.lastExportAssetId.slice(0, MAX_ID_CHARS)
              : null,
          lastExportUrl:
            typeof value.lastExportUrl === 'string' &&
            value.lastExportUrl.length <= MAX_URL_CHARS
              ? value.lastExportUrl
              : null,
        }
      : {}),
    // Upscale-only fields: same rule as the director node, the strict public
    // card contract rejects these keys on any other kind.
    ...(kind === 'upscale'
      ? {
          upscaleJobId:
            typeof value.upscaleJobId === 'string'
              ? value.upscaleJobId.slice(0, MAX_ID_CHARS)
              : null,
          upscaleSourceAssetId:
            typeof value.upscaleSourceAssetId === 'string'
              ? value.upscaleSourceAssetId.slice(0, MAX_ID_CHARS)
              : null,
          upscaleSourceUrl:
            typeof value.upscaleSourceUrl === 'string' &&
            value.upscaleSourceUrl.length <= MAX_URL_CHARS
              ? value.upscaleSourceUrl
              : null,
          upscaleScale: isFiniteNumber(value.upscaleScale)
            ? Math.max(1, Math.min(16, value.upscaleScale))
            : null,
          upscaleBackend:
            typeof value.upscaleBackend === 'string'
              ? value.upscaleBackend.slice(0, 32)
              : null,
          upscaleOptions:
            value.upscaleOptions &&
            typeof value.upscaleOptions === 'object' &&
            !Array.isArray(value.upscaleOptions)
              ? normalizeUpscaleOptions(
                  value.upscaleOptions,
                  value.type === 'image' ? 'image' : 'video'
                )
              : null,
          upscaleProgress: isFiniteNumber(value.upscaleProgress)
            ? Math.max(0, Math.min(1, value.upscaleProgress))
            : null,
          upscaleStage:
            typeof value.upscaleStage === 'string'
              ? value.upscaleStage.slice(0, 64)
              : null,
          upscaleSpeedFps: isFiniteNumber(value.upscaleSpeedFps)
            ? Math.max(0, value.upscaleSpeedFps)
            : null,
          upscaleEtaSeconds: isFiniteNumber(value.upscaleEtaSeconds)
            ? Math.max(0, value.upscaleEtaSeconds)
            : null,
        }
      : {}),
    // Must survive normalization, otherwise a renamed node reverts to the
    // default <project>-<timestamp> name after the next save or refresh.
    customFilename:
      typeof value.customFilename === 'string' && value.customFilename.trim()
        ? value.customFilename.trim().slice(0, MAX_CUSTOM_FILENAME_CHARS)
        : null,
    // Folder membership is a property of every kind of card, so it is stored
    // (and normalized) unconditionally. A folder's own `folderId` is the level
    // its icon lives on; nesting depth is validated once per document.
    folderId:
      typeof value.folderId === 'string' && value.folderId.length <= MAX_ID_CHARS
        ? value.folderId
        : null,
  } as CanvasCard;
};

/**
 * Level hygiene, applied once the whole project is known.
 *
 * A membership that points at something that is not a folder, a chain that
 * loops, or a third level of nesting all produce cards that would be drawn on a
 * level no breadcrumb can reach. Repairing them here keeps the canvas total:
 * the card survives, it just moves up to the top level.
 */
const enforceCanvasLevels = (cards: CanvasCard[]): CanvasCard[] => {
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  const repaired = cards.map((card) => {
    const folderId = card.folderId;
    if (!folderId) return card;
    const parent = byId.get(folderId);
    if (!isCanvasFolderCard(parent)) return { ...card, folderId: null };
    return card;
  });
  return repaired.map((card) => {
    const folderId = card.folderId;
    if (!folderId) return card;
    const chain = inspectFolderChain(repaired, folderId);
    if (chain.dangling || chain.cyclic) return { ...card, folderId: null };
    // The card sits on the level owned by `folderId`; a folder card would then
    // be one level deeper than its parent allows.
    if (
      isCanvasFolderCard(card) &&
      chain.depth >= MAX_CANVAS_FOLDER_DEPTH
    ) {
      return { ...card, folderId: null };
    }
    return card;
  });
};

export const normalizeProjectSnapshotCard = (value: unknown) =>
  normalizeCard(value);

export const createEmptyProjectSnapshot = (): ProjectSnapshotDocument => ({
  version: 3,
  cards: [],
  frames: {},
});

export const isDestructiveEmptyProjectSnapshot = ({
  previous,
  next,
}: {
  previous: ProjectSnapshotDocument;
  next: ProjectSnapshotDocument;
}) => previous.cards.length > 0 && next.cards.length === 0;

export const normalizeProjectSnapshotDocument = (
  value: unknown
): ProjectSnapshotDocument => {
  if (!isRecord(value)) {
    return createEmptyProjectSnapshot();
  }

  if (
    Array.isArray(value.cards) &&
    value.cards.length > MAX_PROJECT_SNAPSHOT_CARDS
  ) {
    throw new ProjectSnapshotValidationError(
      `A project can contain at most ${MAX_PROJECT_SNAPSHOT_CARDS} cards.`
    );
  }

  const cards = enforceCanvasLevels(
    Array.isArray(value.cards)
      ? value.cards
          .map(normalizeCard)
          .filter((item): item is CanvasCard => item !== null)
      : []
  );

  const framesRecord = isRecord(value.frames) ? value.frames : {};
  if (Object.keys(framesRecord).length > MAX_PROJECT_SNAPSHOT_CARDS) {
    throw new ProjectSnapshotValidationError(
      `A project can contain at most ${MAX_PROJECT_SNAPSHOT_CARDS} frames.`
    );
  }
  const cardIds = new Set(cards.map((card) => card.id));
  const frames = Object.entries(framesRecord).reduce<
    Record<string, ProjectSnapshotShapeFrame>
  >((accumulator, [cardId, frame]) => {
    const normalizedFrame = normalizeFrame(frame);
    if (normalizedFrame && cardIds.has(cardId)) {
      accumulator[cardId] = normalizedFrame;
    }
    return accumulator;
  }, {});

  const workflows = isRecord(value.workflows) ? value.workflows : {};
  const activeTemplate = normalizeActiveTemplateWorkflow(
    workflows.activeTemplate
  );
  const normalizedWorkflows = {
    ...(activeTemplate ? { activeTemplate } : {}),
  };
  const camera = normalizeCamera(value.camera);

  return {
    version: 3,
    cards,
    frames,
    ...(camera ? { camera } : {}),
    ...(Object.keys(normalizedWorkflows).length > 0
      ? {
          workflows: normalizedWorkflows,
        }
      : {}),
  };
};
