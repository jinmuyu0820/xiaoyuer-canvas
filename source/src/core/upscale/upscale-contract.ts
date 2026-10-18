/**
 * Local upscale contract shared by the browser and the server.
 *
 * The heavy lifting is done by the bundled SnowLeopard Vision engine
 * (`slv-engine.exe --cli`). This module only describes *what* a user may ask
 * for; it must stay free of Node-only imports so canvas components can use the
 * same option metadata as the API route.
 *
 * One node runs exactly one task: `upscale` or `interpolate`. The engine also
 * has a combined `upscale-interpolate` task, but doing both at once on a laptop
 * GPU takes far longer and makes a failure impossible to attribute, so the UI
 * keeps the two jobs separate.
 */

export const UPSCALE_TASKS = ['upscale', 'interpolate'] as const;
export type UpscaleTask = (typeof UPSCALE_TASKS)[number];

export const UPSCALE_BACKENDS = ['realesrgan', 'realcugan', 'anime4k'] as const;
export type UpscaleBackend = (typeof UPSCALE_BACKENDS)[number];

export const UPSCALE_SCALES = [2, 3, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

export type UpscaleMediaType = 'image' | 'video';

export const UPSCALE_SIZE_MODES = ['scale', 'custom'] as const;
export type UpscaleSizeMode = (typeof UPSCALE_SIZE_MODES)[number];

/**
 * The engine accepts exactly one custom dimension and derives the other from
 * the source aspect ratio. The UI therefore asks for one side only.
 */
export const UPSCALE_SIZE_AXES = ['width', 'height'] as const;
export type UpscaleSizeAxis = (typeof UPSCALE_SIZE_AXES)[number];

export const UPSCALE_FPS_MODES = [
  '2x',
  '3x',
  '4x',
  '5x',
  '48',
  '60',
  'custom',
] as const;
export type UpscaleFpsMode = (typeof UPSCALE_FPS_MODES)[number];

export const UPSCALE_INTERP_ALGORITHMS = [
  'AUTO',
  'ncnn_rife',
  'ffmpeg_minterpolate',
] as const;
export type UpscaleInterpAlgorithm =
  (typeof UPSCALE_INTERP_ALGORITHMS)[number];

export const UPSCALE_RIFE_MODELS = [
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
] as const;
export type UpscaleRifeModel = (typeof UPSCALE_RIFE_MODELS)[number];

export const UPSCALE_DEDUP_MODES = [
  'off',
  'fixed',
  'temporal_linear',
  'anime_twos',
  'anime_twos_threes',
  'smooth_difference',
] as const;
export type UpscaleDedupMode = (typeof UPSCALE_DEDUP_MODES)[number];

export const UPSCALE_TRANSITION_THRESHOLDS = [
  'standard',
  'high',
  'low',
] as const;
export type UpscaleTransitionThreshold =
  (typeof UPSCALE_TRANSITION_THRESHOLDS)[number];

export const UPSCALE_PERFORMANCE_PRESETS = [
  'performance',
  'balanced',
  'quality',
] as const;
export type UpscalePerformancePreset =
  (typeof UPSCALE_PERFORMANCE_PRESETS)[number];

export const UPSCALE_ENCODER_BACKENDS = ['auto', 'cpu', 'nvenc', 'amf'] as const;
export type UpscaleEncoderBackend =
  (typeof UPSCALE_ENCODER_BACKENDS)[number];

export const UPSCALE_AUDIO_MODES = ['auto', 'copy', 'aac'] as const;
export type UpscaleAudioMode = (typeof UPSCALE_AUDIO_MODES)[number];

export const UPSCALE_BIT_DEPTHS = [8, 10] as const;
export type UpscaleBitDepth = (typeof UPSCALE_BIT_DEPTHS)[number];

export type UpscaleRealesrganModel = {
  id: string;
  /** Scales the model checkpoint actually ships with. */
  scales: readonly UpscaleScale[];
  /** Short English label; the UI translates the surrounding wording. */
  label: string;
};

export const UPSCALE_REALESRGAN_MODELS: readonly UpscaleRealesrganModel[] = [
  { id: 'realesr-animevideov3', scales: [2, 3, 4], label: 'Real-ESRGAN anime video' },
  { id: 'realesrgan-x4plus', scales: [4], label: 'Real-ESRGAN x4plus' },
  { id: 'realesrgan-x4plus-anime', scales: [4], label: 'Real-ESRGAN x4plus anime' },
];

export const UPSCALE_REALCUGAN_MODELS = [
  'models-se',
  'models-pro',
  'models-nose',
] as const;
export type UpscaleRealcuganModel = (typeof UPSCALE_REALCUGAN_MODELS)[number];

export const UPSCALE_REALCUGAN_NOISE = [-1, 0, 1, 2, 3] as const;
export type UpscaleRealcuganNoise = (typeof UPSCALE_REALCUGAN_NOISE)[number];

/** Checkpoints each Real-CUGAN model directory actually ships. */
export const UPSCALE_REALCUGAN_MODEL_SCALES: Record<
  UpscaleRealcuganModel,
  readonly UpscaleScale[]
> = {
  'models-se': [2, 3, 4],
  'models-pro': [2, 3],
  'models-nose': [2],
};

/** The `models-se` set carries every scale, so it is the safe fallback. */
export const resolveRealcuganModel = ({
  model,
  scale,
}: {
  model: UpscaleRealcuganModel;
  scale: UpscaleScale;
}) =>
  UPSCALE_REALCUGAN_MODEL_SCALES[model].includes(scale) ? model : 'models-se';

/** Anime4K is a pure shader chain and supports every scale the engine exposes. */
export const UPSCALE_SCALES_BY_BACKEND: Record<
  UpscaleBackend,
  readonly UpscaleScale[]
> = {
  realesrgan: [2, 3, 4],
  realcugan: [2, 3, 4],
  anime4k: [2, 3, 4],
};

export const UPSCALE_ANIME4K_PRESETS = ['fast', 'balanced', 'quality'] as const;
export type UpscaleAnime4kPreset = (typeof UPSCALE_ANIME4K_PRESETS)[number];

export const UPSCALE_OUTPUT_PRESETS = ['quality', 'balanced', 'speed'] as const;
export type UpscaleOutputPreset = (typeof UPSCALE_OUTPUT_PRESETS)[number];

export const UPSCALE_VIDEO_CODECS = ['h264', 'hevc'] as const;
export type UpscaleVideoCodec = (typeof UPSCALE_VIDEO_CODECS)[number];

export type UpscaleOptions = {
  task: UpscaleTask;
  backend: UpscaleBackend;
  scale: UpscaleScale;
  /** Real-ESRGAN checkpoint id; ignored by the other backends. */
  model: string;
  realcuganModel: UpscaleRealcuganModel;
  realcuganNoise: UpscaleRealcuganNoise;
  anime4kPreset: UpscaleAnime4kPreset;
  sizeMode: UpscaleSizeMode;
  customAxis: UpscaleSizeAxis;
  /** Target width or height in pixels; only one side is used. */
  customSize: number;
  fpsMode: UpscaleFpsMode;
  /** Used when `fpsMode` is `custom`. */
  targetFps: number;
  interpAlgorithm: UpscaleInterpAlgorithm;
  rifeModel: UpscaleRifeModel;
  dedupMode: UpscaleDedupMode;
  transitionProtection: boolean;
  transitionThreshold: UpscaleTransitionThreshold;
  performancePreset: UpscalePerformancePreset;
  extremeMode: boolean;
  keepAudio: boolean;
  audioMode: UpscaleAudioMode;
  encoderBackend: UpscaleEncoderBackend;
  outputPreset: UpscaleOutputPreset;
  videoCodec: UpscaleVideoCodec;
  bitDepth: UpscaleBitDepth;
  /** `auto` or a Vulkan device index as a string. */
  aiGpuId: string;
  /** `auto` or an NVENC device index as a string. */
  nvencGpuId: string;
  /** 0 lets the engine pick a tile size. */
  tile: number;
};

export const DEFAULT_UPSCALE_OPTIONS: UpscaleOptions = {
  task: 'upscale',
  backend: 'realesrgan',
  scale: 4,
  // Ships x2/x3/x4 checkpoints and is by far the fastest, which matters for
  // video. Users who want a better still image can switch models.
  model: 'realesr-animevideov3',
  realcuganModel: 'models-se',
  realcuganNoise: 0,
  anime4kPreset: 'balanced',
  sizeMode: 'scale',
  customAxis: 'width',
  customSize: 1920,
  fpsMode: '60',
  targetFps: 60,
  interpAlgorithm: 'AUTO',
  rifeModel: 'AUTO',
  dedupMode: 'off',
  transitionProtection: true,
  transitionThreshold: 'standard',
  performancePreset: 'balanced',
  extremeMode: false,
  keepAudio: true,
  audioMode: 'auto',
  encoderBackend: 'auto',
  outputPreset: 'balanced',
  videoCodec: 'h264',
  bitDepth: 8,
  aiGpuId: 'auto',
  nvencGpuId: 'auto',
  tile: 0,
};

export const UPSCALE_CUSTOM_SIZE_MIN = 64;
export const UPSCALE_CUSTOM_SIZE_MAX = 16_384;
export const UPSCALE_TARGET_FPS_MIN = 1;
export const UPSCALE_TARGET_FPS_MAX = 240;

/**
 * A model may only be used at a scale its checkpoint actually supports. Rather
 * than failing the job, fall back to the fastest model that supports the
 * requested scale.
 */
export const resolveRealesrganModel = ({
  model,
  scale,
}: {
  model: string;
  scale: UpscaleScale;
}) => {
  const requested = UPSCALE_REALESRGAN_MODELS.find((item) => item.id === model);
  if (requested && requested.scales.includes(scale)) return requested.id;
  return (
    UPSCALE_REALESRGAN_MODELS.find((item) => item.scales.includes(scale))?.id ??
    'realesr-animevideov3'
  );
};

const asOneOf = <T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T => (allowed.includes(value as T) ? (value as T) : fallback);

const asBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const asIntegerInRange = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const asGpuId = (value: unknown) => {
  if (typeof value !== 'string') return 'auto';
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'auto') return 'auto';
  return /^\d{1,2}$/.test(trimmed) ? String(Number(trimmed)) : 'auto';
};

/**
 * Coerce arbitrary input (query strings, MCP payloads, stale cards) into a
 * valid option set. Never throws: an unknown value degrades to the default.
 */
export const normalizeUpscaleOptions = (
  value: unknown,
  mediaType: UpscaleMediaType = 'video'
): UpscaleOptions => {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const task: UpscaleTask =
    mediaType === 'image'
      ? 'upscale'
      : asOneOf(source.task, UPSCALE_TASKS, DEFAULT_UPSCALE_OPTIONS.task);
  return {
    task,
    backend: asOneOf(
      source.backend,
      UPSCALE_BACKENDS,
      DEFAULT_UPSCALE_OPTIONS.backend
    ),
    scale: asOneOf(
      Number(source.scale),
      UPSCALE_SCALES,
      DEFAULT_UPSCALE_OPTIONS.scale
    ) as UpscaleScale,
    model:
      typeof source.model === 'string' && source.model.trim()
        ? source.model.trim().slice(0, 64)
        : DEFAULT_UPSCALE_OPTIONS.model,
    realcuganModel: asOneOf(
      source.realcuganModel,
      UPSCALE_REALCUGAN_MODELS,
      DEFAULT_UPSCALE_OPTIONS.realcuganModel
    ),
    realcuganNoise: asOneOf(
      Number(source.realcuganNoise),
      UPSCALE_REALCUGAN_NOISE,
      DEFAULT_UPSCALE_OPTIONS.realcuganNoise
    ) as UpscaleRealcuganNoise,
    anime4kPreset: asOneOf(
      source.anime4kPreset,
      UPSCALE_ANIME4K_PRESETS,
      DEFAULT_UPSCALE_OPTIONS.anime4kPreset
    ),
    sizeMode: asOneOf(
      source.sizeMode,
      UPSCALE_SIZE_MODES,
      DEFAULT_UPSCALE_OPTIONS.sizeMode
    ),
    customAxis: asOneOf(
      source.customAxis,
      UPSCALE_SIZE_AXES,
      DEFAULT_UPSCALE_OPTIONS.customAxis
    ),
    customSize: asIntegerInRange(
      source.customSize,
      UPSCALE_CUSTOM_SIZE_MIN,
      UPSCALE_CUSTOM_SIZE_MAX,
      DEFAULT_UPSCALE_OPTIONS.customSize
    ),
    fpsMode: asOneOf(
      source.fpsMode,
      UPSCALE_FPS_MODES,
      DEFAULT_UPSCALE_OPTIONS.fpsMode
    ),
    targetFps: asIntegerInRange(
      source.targetFps,
      UPSCALE_TARGET_FPS_MIN,
      UPSCALE_TARGET_FPS_MAX,
      DEFAULT_UPSCALE_OPTIONS.targetFps
    ),
    interpAlgorithm: asOneOf(
      source.interpAlgorithm,
      UPSCALE_INTERP_ALGORITHMS,
      DEFAULT_UPSCALE_OPTIONS.interpAlgorithm
    ),
    rifeModel: asOneOf(
      source.rifeModel,
      UPSCALE_RIFE_MODELS,
      DEFAULT_UPSCALE_OPTIONS.rifeModel
    ),
    dedupMode: asOneOf(
      source.dedupMode,
      UPSCALE_DEDUP_MODES,
      DEFAULT_UPSCALE_OPTIONS.dedupMode
    ),
    transitionProtection: asBoolean(
      source.transitionProtection,
      DEFAULT_UPSCALE_OPTIONS.transitionProtection
    ),
    transitionThreshold: asOneOf(
      source.transitionThreshold,
      UPSCALE_TRANSITION_THRESHOLDS,
      DEFAULT_UPSCALE_OPTIONS.transitionThreshold
    ),
    performancePreset: asOneOf(
      source.performancePreset,
      UPSCALE_PERFORMANCE_PRESETS,
      DEFAULT_UPSCALE_OPTIONS.performancePreset
    ),
    extremeMode: asBoolean(
      source.extremeMode,
      DEFAULT_UPSCALE_OPTIONS.extremeMode
    ),
    keepAudio: asBoolean(source.keepAudio, DEFAULT_UPSCALE_OPTIONS.keepAudio),
    audioMode: asOneOf(
      source.audioMode,
      UPSCALE_AUDIO_MODES,
      DEFAULT_UPSCALE_OPTIONS.audioMode
    ),
    encoderBackend: asOneOf(
      source.encoderBackend,
      UPSCALE_ENCODER_BACKENDS,
      DEFAULT_UPSCALE_OPTIONS.encoderBackend
    ),
    outputPreset: asOneOf(
      source.outputPreset,
      UPSCALE_OUTPUT_PRESETS,
      DEFAULT_UPSCALE_OPTIONS.outputPreset
    ),
    videoCodec: asOneOf(
      source.videoCodec,
      UPSCALE_VIDEO_CODECS,
      DEFAULT_UPSCALE_OPTIONS.videoCodec
    ),
    bitDepth: asOneOf(
      Number(source.bitDepth),
      UPSCALE_BIT_DEPTHS,
      DEFAULT_UPSCALE_OPTIONS.bitDepth
    ) as UpscaleBitDepth,
    aiGpuId: asGpuId(source.aiGpuId),
    nvencGpuId: asGpuId(source.nvencGpuId),
    tile: asIntegerInRange(source.tile, 0, 4096, DEFAULT_UPSCALE_OPTIONS.tile),
  };
};

/** Images can only be upscaled; the task switch exists for video only. */
export const resolveUpscaleTask = (
  options: Pick<UpscaleOptions, 'task'>,
  mediaType: UpscaleMediaType
): 'image-upscale' | 'upscale' | 'interpolate' =>
  mediaType === 'image'
    ? 'image-upscale'
    : options.task === 'interpolate'
      ? 'interpolate'
      : 'upscale';

/**
 * Short, self-describing label shown on the node and in the options panel.
 * Symbols only: the surrounding UI is already localized.
 */
export const formatUpscaleSummary = (options: UpscaleOptions) => {
  if (options.task === 'interpolate') {
    if (options.fpsMode === 'custom') return `${options.targetFps} FPS`;
    if (options.fpsMode === '48' || options.fpsMode === '60') {
      return `${options.fpsMode} FPS`;
    }
    return `${options.fpsMode.replace('x', '×')} FPS`;
  }
  if (options.sizeMode === 'custom') {
    return `${options.customSize}${options.customAxis === 'height' ? 'h' : 'w'}`;
  }
  return `${options.scale}×`;
};

export const UPSCALE_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type UpscaleJobStatus = (typeof UPSCALE_JOB_STATUSES)[number];

/**
 * The node status a job state maps to.
 *
 * `cancelled` is terminal for the job but a failure for the node: nothing was
 * produced. Shared by the poller and by cancel, because a cancel request can
 * return a job that already succeeded or that is still shutting down — the UI
 * has to follow what the server reports, never assume the cancel won.
 */
export const resolveUpscaleCardStatus = (
  status: UpscaleJobStatus
): 'succeeded' | 'processing' | 'pending' | 'failed' =>
  status === 'succeeded'
    ? 'succeeded'
    : status === 'running'
      ? 'processing'
      : status === 'queued'
        ? 'pending'
        : 'failed';

export type UpscaleJobOutput = {
  assetId: string;
  publicUrl: string;
  filename: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type UpscaleJob = {
  id: string;
  projectId: string;
  sourceAssetId: string;
  sourceFilename: string;
  mediaType: UpscaleMediaType;
  options: UpscaleOptions;
  status: UpscaleJobStatus;
  /** 0..1, monotonic within a job. */
  progress: number;
  stage: string;
  message: string;
  /** Frames per second reported by the engine while processing video. */
  speedFps: number | null;
  etaSeconds: number | null;
  error: string | null;
  output: UpscaleJobOutput | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export const isUpscaleJobTerminal = (status: UpscaleJobStatus) =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled';

/** Progress is reported as a 0..1 fraction; labels show whole percents. */
export const formatUpscaleProgress = (progress: number) =>
  `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;

export type UpscaleGpuDevice = {
  /** Device index as the engine expects it, or `auto`. */
  id: string;
  name: string;
};

export type UpscaleEnginePaths = {
  root: string;
  engine: string;
  ffmpeg: string;
  realesrgan: string;
  realcugan: string;
  anime4k: string;
  rife: string | null;
  rifeModern: string | null;
};

export type UpscaleSetupState = {
  /** A GUI executable was found for the first-run walkthrough. */
  guiAvailable: boolean;
  guiRoot: string | null;
  guiLastLaunchedAt: string | null;
  manualUpscaleAt: string | null;
  manualInterpolateAt: string | null;
  /** The first-run checklist was completed or explicitly skipped. */
  confirmedAt: string | null;
};

export type UpscaleEngineStatus = {
  available: boolean;
  /** Absolute install directory, already sanitized for display. */
  root: string | null;
  engineVersion: string | null;
  productName: string | null;
  /** First Vulkan device the engine reported, when known. */
  gpu: string | null;
  gpus: UpscaleGpuDevice[];
  encoders: UpscaleGpuDevice[];
  paths: UpscaleEnginePaths | null;
  setup: UpscaleSetupState;
  error: string | null;
};

export type UpscaleLaunchResult = {
  ok: boolean;
  path: string | null;
  reason: 'missing' | 'exited' | 'spawn' | null;
  error: string | null;
  setup: UpscaleSetupState;
};
