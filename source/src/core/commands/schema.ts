import { z } from 'zod';
import { seedanceSettingsSchema } from '@/core/adapters/ark-contract';
import {textCandidateSchema,textVersionSchema,TEXT_HISTORY_LIMIT} from '@/core/beatcanvas/text-contract';

import type { CanvasCard } from '@/core/beatcanvas/canvas-types';

import { repairCanvasCardInput } from './canvas-card-repair';
import type { BeatDesignCommand } from './executor';

const commandIdSchema = z.string().trim().min(1).max(200);
const finiteTimeSchema = z.number().finite().min(0).max(86_400);
const positiveDurationSchema = z.number().finite().positive().max(86_400);

const frameSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  })
  .strict();

const canvasCardStatusSchema = z.enum([
  'idle',
  'pending',
  'processing',
  'succeeded',
  'failed',
]);
const generationModeSchema = z.enum(['image', 'video', 'analysis']);
const analysisDepthSchema = z.enum(['standard', 'deep']);
const aspectRatioSchema = z.enum([
  '16:9',
  '21:9',
  '4:3',
  '5:4',
  '9:16',
  '9:21',
  '3:4',
  '1:1',
  '1:2',
  '2:1',
  '1:3',
  '3:1',
  '2:3',
  '3:2',
  '4:5',
  'auto',
  'adaptive',
  'landscape',
  'portrait',
]);
const outputQualitySchema = z.enum([
  '1k',
  '2k',
  '480p',
  '720p',
  '768p',
  '1080p',
  '4k',
  'std',
  'pro',
]);
const durationSchema = z
  .string()
  .trim()
  .regex(/^(?:-1|\d+(?:\.\d+)?)s$/, 'Duration must use a value such as 5s, 3.5s or -1s.')
  .max(20);
const languageSchema = z.enum(['zh', 'en']);
const modelModeSchema = z.enum(['quality', 'fast', 'lite']);
const modelVariantSchema = z.enum(['standard', 'pro']);
const qualitySchema = z.enum(['standard', 'high', 'low', 'medium']);
const characterOrientationSchema = z.enum(['image', 'video']);
const backgroundSourceSchema = z.enum(['input_image', 'input_video']);
const audioRoleSchema = z.enum([
  'music',
  'voice',
  'sound_effect',
  'source_audio',
  'reference',
]);

const generationSnapshotSchema = z
  .object({
    type: z.enum(['image', 'video']),
    generationMode: generationModeSchema.optional(),
    analysisDepth: analysisDepthSchema.optional(),
    prompt: z.string().max(20_000).default(''),
    referenceCardIds: z.array(commandIdSchema).max(50).default([]),
    workflowTemplateId: commandIdSchema.nullable().default(null),
    modelId: z.string().trim().max(200).default(''),
    connectionId:z.string().max(100).optional(),
    aspectRatio: aspectRatioSchema.default('1:1'),
    outputQuality: outputQualitySchema.default('1k'),
    duration: durationSchema.default('5s'),
    language: languageSchema.optional(),
    mode: modelModeSchema.default('quality'),
    variant: modelVariantSchema.default('standard'),
    quality: qualitySchema.default('standard'),
    seedanceSettings: seedanceSettingsSchema.optional(),
    characterOrientation: characterOrientationSchema.optional(),
    backgroundSource: backgroundSourceSchema.optional(),
    resultText: z.string().max(100_000).nullable().optional(),
    capturedAt: z.string().trim().min(1).max(80),
  })
  .strict();

const canvasCardCommonShape = {
  id: commandIdSchema,
  assetId: commandIdSchema.nullable().optional(),
  generationMode: generationModeSchema.optional(),
  analysisDepth: analysisDepthSchema.optional(),
  name: z.string().trim().min(1).max(500),
  url: z.string().trim().max(4096).nullable().default(null),
  resultText: z.string().max(100_000).nullable().optional(),
  prompt: z.string().max(20_000).default(''),
  referenceCardIds: z.array(commandIdSchema).max(50).default([]),
  workflowTemplateId: commandIdSchema.nullable().default(null),
  status: canvasCardStatusSchema.default('idle'),
  error: z.string().max(20_000).nullable().default(null),
  modelId: z.string().trim().max(200).default(''),
  connectionId:z.string().max(100).optional(),
  sourceTextCardId:commandIdSchema.nullable().optional(),
  textInstruction:z.string().max(3000).optional(),
  textCandidate:textCandidateSchema.nullable().optional(),
  textHistory:z.array(textVersionSchema).max(TEXT_HISTORY_LIMIT).optional(),
  aspectRatio: aspectRatioSchema.default('1:1'),
  outputQuality: outputQualitySchema.default('1k'),
  duration: durationSchema.default('5s'),
  language: languageSchema.optional(),
  mode: modelModeSchema.default('quality'),
  variant: modelVariantSchema.default('standard'),
  quality: qualitySchema.default('standard'),
  seedanceSettings: seedanceSettingsSchema.optional(),
  characterOrientation: characterOrientationSchema.optional(),
  backgroundSource: backgroundSourceSchema.optional(),
  sourceGenerationId: commandIdSchema.nullable().default(null),
  sourceConfigCardId: commandIdSchema.nullable().optional(),
  generationRunId: commandIdSchema.nullable().optional(),
  generationSnapshot: generationSnapshotSchema.nullable().optional(),
  pinnedOutputId: commandIdSchema.nullable().optional(),
  audioRole: audioRoleSchema.optional(),
  durationSec: finiteTimeSchema.nullable().optional(),
  waveformPeaks: z.array(z.number().finite().min(0).max(1)).max(256).optional(),
  timelineId: commandIdSchema.nullable().optional(),
  clipCount: z.number().int().min(0).max(10_000).nullable().optional(),
  lastRenderAssetId: commandIdSchema.nullable().optional(),
  customFilename: z.string().trim().max(200).nullable().optional(),
  folderId: commandIdSchema.nullable().optional(),
};

const upscaleOptionsSchema = z
  .object({
    task: z.enum(['upscale', 'interpolate']),
    backend: z.enum(['realesrgan', 'realcugan', 'anime4k']),
    scale: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    model: z.string().trim().min(1).max(64),
    realcuganModel: z.enum(['models-se', 'models-pro', 'models-nose']),
    realcuganNoise: z.union([
      z.literal(-1),
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    anime4kPreset: z.enum(['fast', 'balanced', 'quality']),
    sizeMode: z.enum(['scale', 'custom']),
    customAxis: z.enum(['width', 'height']),
    customSize: z.number().int().min(64).max(16_384),
    fpsMode: z.enum(['2x', '3x', '4x', '5x', '48', '60', 'custom']),
    targetFps: z.number().int().min(1).max(240),
    interpAlgorithm: z.enum(['AUTO', 'ncnn_rife', 'ffmpeg_minterpolate']),
    rifeModel: z.enum([
      'AUTO',
      'rife',
      'rife-v2',
      'rife-v2.3',
      'rife-v2.4',
      'rife-v3.0',
      'rife-v3.1',
      'rife-v4',
      'rife-v4.6',
      'rife-HD',
      'rife-UHD',
      'rife-anime',
      'rife-v4.25',
      'rife-v4.26',
    ]),
    dedupMode: z.enum([
      'off',
      'fixed',
      'temporal_linear',
      'anime_twos',
      'anime_twos_threes',
      'smooth_difference',
    ]),
    transitionProtection: z.boolean(),
    transitionThreshold: z.enum(['standard', 'high', 'low']),
    performancePreset: z.enum(['performance', 'balanced', 'quality']),
    extremeMode: z.boolean(),
    keepAudio: z.boolean(),
    audioMode: z.enum(['auto', 'copy', 'aac']),
    encoderBackend: z.enum(['auto', 'cpu', 'nvenc', 'amf']),
    outputPreset: z.enum(['quality', 'balanced', 'speed']),
    videoCodec: z.enum(['h264', 'hevc']),
    bitDepth: z.union([z.literal(8), z.literal(10)]),
    aiGpuId: z.string().regex(/^(?:auto|\d{1,2})$/),
    nvencGpuId: z.string().regex(/^(?:auto|\d{1,2})$/),
    tile: z.number().int().min(0).max(4096),
  })
  .strict();

/**
 * Public Canvas card contract used by UI commands and MCP tool discovery.
 * Keep this explicit: an opaque `unknown` schema makes the tool impossible for
 * an Agent to call reliably even when runtime validation later succeeds.
 */
const canvasCardUnion = z.discriminatedUnion('kind', [
  z.object({...canvasCardCommonShape,kind:z.literal('text'),type:z.literal('text'),url:z.null().default(null),assetId:z.null().optional()}).strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('asset'),
      type: z.enum(['image', 'video', 'audio']),
    })
    .strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('generation'),
      type: z.enum(['image', 'video']),
    })
    .strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('output'),
      type: z.enum(['image', 'video']),
      sourceConfigCardId: commandIdSchema,
      generationRunId: commandIdSchema,
      generationSnapshot: generationSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('director'),
      type: z.literal('director'),
      url: z.null().default(null),
      assetId: z.null().optional(),
      lastExportAssetId: commandIdSchema.nullable().optional(),
      lastExportUrl: z.string().trim().max(4096).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('upscale'),
      type: z.enum(['image', 'video']),
      upscaleJobId: commandIdSchema.nullable().optional(),
      upscaleSourceAssetId: commandIdSchema.nullable().optional(),
      upscaleSourceUrl: z.string().trim().max(4096).nullable().optional(),
      upscaleScale: z.number().int().min(1).max(16).nullable().optional(),
      upscaleBackend: z.string().trim().max(32).nullable().optional(),
      upscaleOptions: upscaleOptionsSchema.nullable().optional(),
      upscaleProgress: z.number().finite().min(0).max(1).nullable().optional(),
      upscaleStage: z.string().trim().max(64).nullable().optional(),
      upscaleSpeedFps: z.number().finite().min(0).nullable().optional(),
      upscaleEtaSeconds: z.number().finite().min(0).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...canvasCardCommonShape,
      kind: z.literal('folder'),
      type: z.literal('folder'),
      url: z.null().default(null),
      assetId: z.null().optional(),
      // The level the icon itself lives on: null = top level. Nesting depth is
      // validated against the whole document, not per card.
      folderId: commandIdSchema.nullable().default(null),
    })
    .strict(),
]);

export const canvasCardSchema = z.preprocess(
  repairCanvasCardInput,
  canvasCardUnion
) as z.ZodType<CanvasCard>;

export const canvasOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_camera'),
    camera: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite().positive() }).strict().nullable(),
  }).strict(),
  z.object({
    type: z.literal('set_workflow'),
    activeTemplate: z.object({
      slug: commandIdSchema,
      title: z.string().max(500),
      source: z.string().max(4096),
      taskType: z.enum(['image', 'video', 'audio']),
      enteredAt: z.string().max(80),
    }).strict().nullable(),
  }).strict(),
  z
    .object({
      type: z.literal('upsert_card'),
      card: canvasCardSchema,
      frame: frameSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove_card'),
      cardId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('move_card'),
      cardId: commandIdSchema,
      frame: frameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('place_card'),
      cardId: commandIdSchema,
      sourceCardIds: z.array(commandIdSchema).max(20).optional(),
      side: z.enum(['left', 'right']).default('right'),
      offsetIndex: z.number().int().min(0).max(499).default(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_references'),
      cardId: commandIdSchema,
      referenceCardIds: z.array(commandIdSchema).max(50),
    })
    .strict(),
]);

export const beatDesignCommandSchema: z.ZodType<BeatDesignCommand> = z.object({ type: z.literal('canvas.apply'), operations: z.array(canvasOperationSchema).min(1).max(500) }).strict();

const commandRequestBaseSchema = z
  .object({
    commandId: commandIdSchema.optional(),
    expectedRevision: z.number().int().min(0).nullable().optional(),
    idempotencyKey: commandIdSchema.nullable().optional(),
    command: beatDesignCommandSchema,
  })
  .strict();

/**
 * Public UI requests never choose their own origin. The transport boundary
 * assigns `ui`, while MCP/CLI callers invoke the kernel through their own
 * trusted entrypoints.
 */
export const uiCommandRequestSchema = commandRequestBaseSchema;

export type ParsedUiCommandRequest = z.infer<typeof uiCommandRequestSchema>;
