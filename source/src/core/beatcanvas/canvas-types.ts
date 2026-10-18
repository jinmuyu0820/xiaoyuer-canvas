import type {
  WorkspaceAspectRatio,
  WorkspaceBackgroundSource,
  WorkspaceCharacterOrientation,
  WorkspaceDuration,
  WorkspaceLanguage,
  WorkspaceModelMode,
  WorkspaceModelVariant,
  WorkspaceOutputQuality,
  WorkspaceQualityOption,
} from '@/core/effects/workspace-models';
import type { VideoAnalysisDepth } from '@/core/effects/video-analysis';
import type { SeedanceSettings } from '@/core/adapters/ark-contract';
import type { UpscaleOptions } from '@/core/upscale/upscale-contract';
import type {TextCandidate,TextVersion} from './text-contract';

export type CanvasCardMediaType = 'image' | 'video';
export type CanvasAssetMediaType = CanvasCardMediaType | 'audio' | 'timeline';
export type CanvasGenerationMode = CanvasCardMediaType | 'analysis';
export type CanvasCardKind =
  | 'asset'
  | 'generation'
  | 'output'
  | 'text'
  | 'director'
  | 'upscale'
  | 'folder';

export type CanvasCardStatus =
  | 'idle'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed';

type CanvasCardBase = {
  id: string;
  assetId?: string | null;
  kind: CanvasCardKind;
  type: CanvasAssetMediaType | 'text' | 'director' | 'folder';
  generationMode?: CanvasGenerationMode;
  analysisDepth?: VideoAnalysisDepth;
  name: string;
  url: string | null;
  resultText?: string | null;
  prompt: string;
  referenceCardIds: string[];
  workflowTemplateId: string | null;
  status: CanvasCardStatus;
  error: string | null;
  modelId: string;
  connectionId?:string;
  sourceTextCardId?:string|null;
  textInstruction?:string;
  textCandidate?:TextCandidate|null;
  textHistory?:TextVersion[];
  aspectRatio: WorkspaceAspectRatio;
  outputQuality: WorkspaceOutputQuality;
  duration: WorkspaceDuration;
  language?: WorkspaceLanguage;
  mode: WorkspaceModelMode;
  variant: WorkspaceModelVariant;
  quality: WorkspaceQualityOption;
  seedanceSettings?: SeedanceSettings;
  characterOrientation?: WorkspaceCharacterOrientation;
  backgroundSource?: WorkspaceBackgroundSource;
  sourceGenerationId: string | null;
  sourceConfigCardId?: string | null;
  generationRunId?: string | null;
  generationSnapshot?: CanvasGenerationSnapshot | null;
  /** Generation card: output card id whose result is pinned on the node. */
  pinnedOutputId?: string | null;
  audioRole?: 'music' | 'voice' | 'sound_effect' | 'source_audio' | 'reference';
  durationSec?: number | null;
  waveformPeaks?: number[];
  timelineId?: string | null;
  clipCount?: number | null;
  lastRenderAssetId?: string | null;
  /** User-specified filename for single-asset download; falls back to "project-timestamp" if unset. */
  customFilename?: string | null;
  /**
   * Canvas folder this card belongs to (the folder card's id). Assets produced by
   * a card inside a folder are grouped under it in the project asset view.
   */
  folderId?: string | null;
};

export type CanvasGenerationSnapshot = Pick<
  CanvasCardBase,
  | 'type'
  | 'generationMode'
  | 'analysisDepth'
  | 'prompt'
  | 'referenceCardIds'
  | 'workflowTemplateId'
  | 'modelId'
  | 'connectionId'
  | 'aspectRatio'
  | 'outputQuality'
  | 'duration'
  | 'language'
  | 'mode'
  | 'variant'
  | 'quality'
  | 'seedanceSettings'
  | 'characterOrientation'
  | 'backgroundSource'
  | 'resultText'
> & {
  type: CanvasCardMediaType;
  capturedAt: string;
};

export type CanvasAssetCard = CanvasCardBase & {
  kind: 'asset';
  type: CanvasAssetMediaType;
};

export type CanvasGenerationCard = CanvasCardBase & {
  kind: 'generation';
  type: CanvasCardMediaType;
};

export type CanvasOutputCard = CanvasCardBase & {
  kind: 'output';
  type: CanvasCardMediaType;
  sourceConfigCardId: string;
  generationRunId: string;
  generationSnapshot: CanvasGenerationSnapshot;
};

export type CanvasTextCard=CanvasCardBase&{kind:'text';type:'text';url:null};

/**
 * 3D 导演台节点。
 *
 * The 3D scene itself lives in the embedded DirectorDesk app and is mirrored
 * into the project store under the card id, so the card only keeps what the
 * canvas needs to draw the launcher and to find its last export.
 */
export type CanvasDirectorCard = CanvasCardBase & {
  kind: 'director';
  type: 'director';
  url: null;
  /** Asset produced by the most recent export, shown as the card poster. */
  lastExportAssetId?: string | null;
  lastExportUrl?: string | null;
};

export type CanvasUpscaleCard = CanvasCardBase & {
  kind: 'upscale';
  type: CanvasCardMediaType;
  url: string | null;
  /** Local upscale job driving this node; polled until it reaches a terminal state. */
  upscaleJobId?: string | null;
  /** Project asset the job reads from, kept so a retry survives a source deletion. */
  upscaleSourceAssetId?: string | null;
  /** Poster shown while the job runs (the untouched source media). */
  upscaleSourceUrl?: string | null;
  upscaleScale?: number | null;
  upscaleBackend?: string | null;
  /** Full option set, so a retry or a node settings edit starts from it. */
  upscaleOptions?: UpscaleOptions | null;
  /** 0..1 as reported by the engine. */
  upscaleProgress?: number | null;
  upscaleStage?: string | null;
  upscaleSpeedFps?: number | null;
  upscaleEtaSeconds?: number | null;
};

/**
 * A canvas folder, drawn as an icon that opens its own canvas level.
 *
 * The folder is a card so its name is persisted (shape props are not part of the
 * snapshot). Cards that live inside it point back with `folderId`; a folder
 * points at the level it lives on the same way, which is what makes one level of
 * nesting a plain parent chain.
 */
export type CanvasFolderCard = CanvasCardBase & {
  kind: 'folder';
  type: 'folder';
  url: null;
};

export type CanvasCard =
  | CanvasAssetCard
  | CanvasGenerationCard
  | CanvasOutputCard
  | CanvasDirectorCard
  | CanvasUpscaleCard
  | CanvasFolderCard
  | CanvasTextCard;

export const isCanvasFolderCard = (
  card: CanvasCard | null | undefined
): card is CanvasFolderCard => card?.kind === 'folder';

export const isCanvasUpscaleCard = (
  card: CanvasCard | null | undefined
): card is CanvasUpscaleCard => card?.kind === 'upscale';

export const isCanvasDirectorCard = (
  card: CanvasCard | null | undefined
): card is CanvasDirectorCard => card?.kind === 'director';
export const isCanvasTextCard=(card:CanvasCard|null|undefined):card is CanvasTextCard=>card?.kind==='text';

export const isCanvasGenerationCard = (
  card: CanvasCard | null | undefined
): card is CanvasGenerationCard => card?.kind === 'generation';

export const isCanvasOutputCard = (
  card: CanvasCard | null | undefined
): card is CanvasOutputCard => card?.kind === 'output';

/** @deprecated Use isCanvasGenerationCard */
export const isCanvasDraftCard = isCanvasGenerationCard;

/** @deprecated Use CanvasGenerationCard */
export type CanvasDraftCard = CanvasGenerationCard;

export const getCanvasGenerationMode = (
  card: Pick<CanvasCard, 'type' | 'generationMode'>
): CanvasGenerationMode =>
  card.generationMode ??
  (card.type === 'image' || card.type === 'video' ? card.type : 'video');

export const isCanvasAnalysisCard = (
  card: CanvasCard | null | undefined
) => Boolean(card && getCanvasGenerationMode(card) === 'analysis');
