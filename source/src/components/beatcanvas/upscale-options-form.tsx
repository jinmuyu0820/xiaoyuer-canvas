import { useEffect, useMemo, useState } from 'react';

import {
  UPSCALE_ANIME4K_PRESETS,
  UPSCALE_BACKENDS,
  UPSCALE_BIT_DEPTHS,
  UPSCALE_DEDUP_MODES,
  UPSCALE_ENCODER_BACKENDS,
  UPSCALE_FPS_MODES,
  UPSCALE_INTERP_ALGORITHMS,
  UPSCALE_OUTPUT_PRESETS,
  UPSCALE_PERFORMANCE_PRESETS,
  UPSCALE_REALESRGAN_MODELS,
  UPSCALE_REALCUGAN_MODELS,
  UPSCALE_REALCUGAN_NOISE,
  UPSCALE_RIFE_MODELS,
  UPSCALE_SCALES,
  UPSCALE_SIZE_AXES,
  UPSCALE_TRANSITION_THRESHOLDS,
  UPSCALE_VIDEO_CODECS,
  normalizeUpscaleOptions,
  type UpscaleEngineStatus,
  type UpscaleMediaType,
  type UpscaleOptions,
} from '@/core/upscale/upscale-contract';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

const chip =
  'inline-flex items-center justify-center rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5 disabled:opacity-40';
const chipOn = 'border-orange-400/60 bg-orange-400/10 text-orange-200';
const select =
  'h-9 w-full min-w-0 rounded-lg border border-white/15 bg-[#17181b] px-2 text-xs text-white outline-none focus:border-orange-400/60 disabled:opacity-50';
const label = 'block text-[11px] text-white/55';
const group = 'min-w-0 space-y-1.5';
const note = 'text-[10px] leading-4 text-white/40';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

const outputPresetLabel = (
  preset: UpscaleOptions['outputPreset'],
  t: (key: string) => string
) =>
  preset === 'quality'
    ? t('upscalePresetQuality')
    : preset === 'balanced'
      ? t('upscalePresetBalanced')
      : t('upscalePresetSpeed');

/**
 * Number inputs keep a draft string so typing "640" is possible: clamping on
 * every keystroke would turn "6" into the minimum mid-entry.
 */
function NumberField({
  value,
  min,
  max,
  step,
  labelText,
  rangeMessage,
  disabled,
  onValidityChange,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  labelText: string;
  rangeMessage?: string;
  disabled?: boolean;
  onValidityChange?: (invalid: boolean) => void;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const setValidity = (next: boolean) => {
    setInvalid(next);
    onValidityChange?.(next);
  };

  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
    onValidityChange?.(false);
  }, [value]);

  return (
    <div className="min-w-0">
      <input
        type="number"
        aria-label={labelText}
        aria-invalid={invalid || undefined}
        className={`${select} ${invalid ? 'border-red-400/60 focus:border-red-400' : ''}`}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = Number(raw);
          const inRange =
            Number.isFinite(parsed) && parsed >= min && parsed <= max;
          setValidity(!inRange);
          if (inRange) {
            onChange(Math.round(parsed));
          }
        }}
        onBlur={() => {
          const parsed = Number(draft);
          const next = Number.isFinite(parsed)
            ? clamp(parsed, min, max)
            : value;
          setDraft(String(next));
          setValidity(false);
          onChange(next);
        }}
      />
      {invalid && rangeMessage ? (
        <p role="alert" className="mt-1 text-[10px] leading-4 text-red-300">
          {rangeMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * All local processing options, rendered identically in the pre-flight dialog
 * and in the node settings dialog. Keeping one form means a setting can never
 * exist in one place but be forgotten in the other.
 */
export function UpscaleOptionsForm({
  value,
  onChange,
  mediaType,
  engine,
  disabled = false,
  onValidationChange,
}: {
  value: UpscaleOptions;
  onChange: (next: UpscaleOptions) => void;
  mediaType: UpscaleMediaType;
  engine: UpscaleEngineStatus | null;
  disabled?: boolean;
  onValidationChange?: (invalid: boolean) => void;
}) {
  const t = useTranslations('CanvasTools');
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [customSizeInvalid, setCustomSizeInvalid] = useState(false);
  const options = normalizeUpscaleOptions(value, mediaType);
  const isVideo = mediaType === 'video';
  const isInterpolate = isVideo && options.task === 'interpolate';

  useEffect(() => {
    const invalid = options.sizeMode === 'custom' && customSizeInvalid;
    onValidationChange?.(invalid);
  }, [customSizeInvalid, onValidationChange, options.sizeMode]);

  const patch = (next: Partial<UpscaleOptions>) =>
    onChange(normalizeUpscaleOptions({ ...options, ...next }, mediaType));

  const modelOptions = useMemo(
    () =>
      UPSCALE_REALESRGAN_MODELS.filter((model) =>
        model.scales.includes(options.scale)
      ),
    [options.scale]
  );

  const firstModelForScale = (scale: UpscaleOptions['scale']) =>
    UPSCALE_REALESRGAN_MODELS.find((model) => model.scales.includes(scale))?.id;

  const gpuOptions = engine?.gpus ?? [];
  const encoderOptions = engine?.encoders ?? [];

  const tabButton = (key: 'basic' | 'advanced', text: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
        tab === key
          ? 'bg-white/10 font-semibold text-white'
          : 'text-white/55 hover:text-white/80'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="min-w-0 space-y-3">
      {isVideo ? (
        <div className="space-y-1.5">
          <span className={label}>{t('upscaleTask')}</span>
          <div
            className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
            role="radiogroup"
            aria-label={t('upscaleTask')}
          >
            {(['upscale', 'interpolate'] as const).map((task) => (
              <button
                key={task}
                type="button"
                role="radio"
                aria-checked={options.task === task}
                disabled={disabled}
                onClick={() => patch({ task })}
                className={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  options.task === task
                    ? 'bg-orange-400/15 font-semibold text-orange-200'
                    : 'text-white/60 hover:bg-white/5'
                }`}
              >
                {task === 'upscale'
                  ? t('upscaleTaskUpscale')
                  : t('upscaleTaskInterpolate')}
              </button>
            ))}
          </div>
          <p className={note}>
            {isInterpolate
              ? t('upscaleInterpolateHint')
              : t('upscaleTaskHint')}
          </p>
        </div>
      ) : null}

      <div
        className="inline-flex gap-1 rounded-lg bg-white/[0.04] p-1"
        role="tablist"
      >
        {tabButton('basic', t('upscaleBasicTab'))}
        {tabButton('advanced', t('upscaleAdvancedTab'))}
      </div>

      {tab === 'basic' ? (
        <div className="space-y-3">
          {isInterpolate ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className={group}>
                  <span className={label}>{t('upscaleFrameRate')}</span>
                  <select
                    aria-label={t('upscaleFrameRate')}
                    className={select}
                    disabled={disabled}
                    value={options.fpsMode}
                    onChange={(event) =>
                      patch({
                        fpsMode: event.target
                          .value as UpscaleOptions['fpsMode'],
                      })
                    }
                  >
                    {UPSCALE_FPS_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === '48' || mode === '60'
                          ? `${mode} FPS`
                          : mode === 'custom'
                            ? t('upscaleFrameRateCustom')
                            : mode.replace('x', '×')}
                      </option>
                    ))}
                  </select>
                </div>
                {options.fpsMode === 'custom' ? (
                  <div className={group}>
                    <span className={label}>{t('upscaleTargetFps')}</span>
                    <NumberField
                      value={options.targetFps}
                      min={1}
                      max={240}
                      step={1}
                      labelText={t('upscaleTargetFps')}
                      disabled={disabled}
                      onChange={(targetFps) => patch({ targetFps })}
                    />
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={group}>
                  <span className={label}>{t('upscaleInterpAlgorithm')}</span>
                  <select
                    aria-label={t('upscaleInterpAlgorithm')}
                    className={select}
                    disabled={disabled}
                    value={options.interpAlgorithm}
                    onChange={(event) =>
                      patch({
                        interpAlgorithm: event.target
                          .value as UpscaleOptions['interpAlgorithm'],
                      })
                    }
                  >
                    {UPSCALE_INTERP_ALGORITHMS.map((algorithm) => (
                      <option key={algorithm} value={algorithm}>
                        {algorithm === 'AUTO'
                          ? t('upscaleAlgorithmAuto')
                          : algorithm === 'ncnn_rife'
                            ? 'RIFE'
                            : 'ffmpeg minterpolate'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={group}>
                  <span className={label}>{t('upscaleRifeModel')}</span>
                  <select
                    aria-label={t('upscaleRifeModel')}
                    className={select}
                    disabled={
                      disabled || options.interpAlgorithm === 'ffmpeg_minterpolate'
                    }
                    value={options.rifeModel}
                    onChange={(event) =>
                      patch({
                        rifeModel: event.target
                          .value as UpscaleOptions['rifeModel'],
                      })
                    }
                  >
                    {UPSCALE_RIFE_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model === 'AUTO' ? t('upscaleAuto') : model}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={group}>
                  <span className={label}>{t('upscaleOutputPreset')}</span>
                  <select
                    aria-label={t('upscaleOutputPreset')}
                    className={select}
                    disabled={disabled}
                    value={options.outputPreset}
                    onChange={(event) =>
                      patch({
                        outputPreset: event.target
                          .value as UpscaleOptions['outputPreset'],
                      })
                    }
                  >
                    {UPSCALE_OUTPUT_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {outputPresetLabel(preset, t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={group}>
                  <span className={label}>{t('upscaleCodec')}</span>
                  <select
                    aria-label={t('upscaleCodec')}
                    className={select}
                    disabled={disabled}
                    value={options.videoCodec}
                    onChange={(event) =>
                      patch({
                        videoCodec: event.target
                          .value as UpscaleOptions['videoCodec'],
                      })
                    }
                  >
                    {UPSCALE_VIDEO_CODECS.map((codec) => (
                      <option key={codec} value={codec}>
                        {codec === 'h264' ? 'H.264' : 'H.265'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-white/65">
                <input
                  type="checkbox"
                  className="size-3.5 accent-orange-400"
                  disabled={disabled}
                  checked={options.keepAudio}
                  onChange={(event) =>
                    patch({ keepAudio: event.target.checked })
                  }
                />
                {t('upscaleKeepAudio')}
              </label>
            </>
          ) : (
            <>
              <div className={group}>
                <span className={label}>{t('upscaleBackend')}</span>
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label={t('upscaleBackend')}
                >
                  {UPSCALE_BACKENDS.map((backend) => (
                    <button
                      key={backend}
                      type="button"
                      role="radio"
                      aria-checked={options.backend === backend}
                      disabled={disabled}
                      onClick={() =>
                        patch({
                          backend,
                          ...(backend === 'realesrgan'
                            ? {
                                model:
                                  firstModelForScale(options.scale) ??
                                  options.model,
                              }
                            : {}),
                        })
                      }
                      className={`${chip} ${options.backend === backend ? chipOn : ''}`}
                    >
                      {backend === 'realesrgan'
                        ? 'Real-ESRGAN'
                        : backend === 'realcugan'
                          ? 'Real-CUGAN'
                          : 'Anime4K'}
                    </button>
                  ))}
                </div>
              </div>

              {options.backend === 'realesrgan' ? (
                <div className={group}>
                  <span className={label}>{t('upscaleModel')}</span>
                  <select
                    aria-label={t('upscaleModel')}
                    className={select}
                    disabled={disabled}
                    value={
                      modelOptions.some((model) => model.id === options.model)
                        ? options.model
                        : (modelOptions[0]?.id ?? options.model)
                    }
                    onChange={(event) => patch({ model: event.target.value })}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {options.backend === 'realcugan' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className={group}>
                    <span className={label}>{t('upscaleModel')}</span>
                    <select
                      aria-label={t('upscaleModel')}
                      className={select}
                      disabled={disabled}
                      value={options.realcuganModel}
                      onChange={(event) =>
                        patch({
                          realcuganModel: event.target
                            .value as UpscaleOptions['realcuganModel'],
                        })
                      }
                    >
                      {UPSCALE_REALCUGAN_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={group}>
                    <span className={label}>{t('upscaleDenoise')}</span>
                    <select
                      aria-label={t('upscaleDenoise')}
                      className={select}
                      disabled={disabled}
                      value={String(options.realcuganNoise)}
                      onChange={(event) =>
                        patch({
                          realcuganNoise: Number(event.target
                            .value) as UpscaleOptions['realcuganNoise'],
                        })
                      }
                    >
                      {UPSCALE_REALCUGAN_NOISE.map((noise) => (
                        <option key={noise} value={String(noise)}>
                          {noise === -1 ? t('upscaleDenoiseNone') : String(noise)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}

              {options.backend === 'anime4k' ? (
                <div className={group}>
                  <span className={label}>{t('upscalePreset')}</span>
                  <select
                    aria-label={t('upscalePreset')}
                    className={select}
                    disabled={disabled}
                    value={options.anime4kPreset}
                    onChange={(event) =>
                      patch({
                        anime4kPreset: event.target
                          .value as UpscaleOptions['anime4kPreset'],
                      })
                    }
                  >
                    {UPSCALE_ANIME4K_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className={group}>
                <span className={label}>{t('upscaleSizeMode')}</span>
                <div
                  className="flex gap-2"
                  role="radiogroup"
                  aria-label={t('upscaleSizeMode')}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={options.sizeMode === 'scale'}
                    disabled={disabled}
                    onClick={() => patch({ sizeMode: 'scale' })}
                    className={`${chip} ${options.sizeMode === 'scale' ? chipOn : ''}`}
                  >
                    {t('upscaleSizeScale')}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={options.sizeMode === 'custom'}
                    disabled={disabled}
                    onClick={() => patch({ sizeMode: 'custom' })}
                    className={`${chip} ${options.sizeMode === 'custom' ? chipOn : ''}`}
                  >
                    {t('upscaleSizeCustom')}
                  </button>
                </div>
              </div>

              {options.sizeMode === 'custom' ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className={group}>
                      <span className={label}>{t('upscaleCustomAxis')}</span>
                      <div
                        className="flex gap-2"
                        role="radiogroup"
                        aria-label={t('upscaleCustomAxis')}
                      >
                        {UPSCALE_SIZE_AXES.map((axis) => (
                          <button
                            key={axis}
                            type="button"
                            role="radio"
                            aria-checked={options.customAxis === axis}
                            disabled={disabled}
                            onClick={() => patch({ customAxis: axis })}
                            className={`${chip} ${options.customAxis === axis ? chipOn : ''}`}
                          >
                            {axis === 'width'
                              ? t('upscaleCustomWidth')
                              : t('upscaleCustomHeight')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={group}>
                      <span className={label}>
                        {options.customAxis === 'width'
                          ? t('upscaleCustomWidth')
                          : t('upscaleCustomHeight')}
                      </span>
                      <NumberField
                        value={options.customSize}
                        min={64}
                        max={16384}
                        step={2}
                        labelText={t('upscaleCustomSize')}
                        rangeMessage={t('upscaleCustomRange')}
                        disabled={disabled}
                        onValidityChange={setCustomSizeInvalid}
                        onChange={(customSize) => patch({ customSize })}
                      />
                    </div>
                  </div>
                  <p className={note}>{t('upscaleCustomHint')}</p>
                </div>
              ) : (
                <div className={group}>
                  <span className={label}>{t('upscaleScale')}</span>
                  <div
                    className="flex gap-2"
                    role="radiogroup"
                    aria-label={t('upscaleScale')}
                  >
                    {UPSCALE_SCALES.map((scale) => (
                      <button
                        key={scale}
                        type="button"
                        role="radio"
                        aria-checked={options.scale === scale}
                        disabled={disabled}
                        onClick={() =>
                          patch({
                            scale,
                            ...(options.backend === 'realesrgan'
                              ? {
                                  model:
                                    firstModelForScale(scale) ?? options.model,
                                }
                              : {}),
                          })
                        }
                        className={`${chip} tabular-nums ${options.scale === scale ? chipOn : ''}`}
                      >
                        {scale}×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isVideo ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className={group}>
                    <span className={label}>{t('upscaleOutputPreset')}</span>
                    <select
                      aria-label={t('upscaleOutputPreset')}
                      className={select}
                      disabled={disabled}
                      value={options.outputPreset}
                      onChange={(event) =>
                        patch({
                          outputPreset: event.target
                            .value as UpscaleOptions['outputPreset'],
                        })
                      }
                    >
                      {UPSCALE_OUTPUT_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {outputPresetLabel(preset, t)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={group}>
                    <span className={label}>{t('upscaleCodec')}</span>
                    <select
                      aria-label={t('upscaleCodec')}
                      className={select}
                      disabled={disabled}
                      value={options.videoCodec}
                      onChange={(event) =>
                        patch({
                          videoCodec: event.target
                            .value as UpscaleOptions['videoCodec'],
                        })
                      }
                    >
                      {UPSCALE_VIDEO_CODECS.map((codec) => (
                        <option key={codec} value={codec}>
                          {codec === 'h264' ? 'H.264' : 'H.265'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className={group}>
              <span className={label}>{t('upscalePerformance')}</span>
              <select
                aria-label={t('upscalePerformance')}
                className={select}
                disabled={disabled}
                value={options.performancePreset}
                onChange={(event) =>
                  patch({
                    performancePreset: event.target
                      .value as UpscaleOptions['performancePreset'],
                  })
                }
              >
                {UPSCALE_PERFORMANCE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset === 'performance'
                      ? t('upscalePerformancePerformance')
                      : preset === 'balanced'
                        ? t('upscalePerformanceBalanced')
                        : t('upscalePerformanceQuality')}
                  </option>
                ))}
              </select>
            </div>
            <div className={group}>
              <span className={label}>{t('upscaleEncoder')}</span>
              <select
                aria-label={t('upscaleEncoder')}
                className={select}
                disabled={disabled || !isVideo}
                value={options.encoderBackend}
                onChange={(event) =>
                  patch({
                    encoderBackend: event.target
                      .value as UpscaleOptions['encoderBackend'],
                  })
                }
              >
                {UPSCALE_ENCODER_BACKENDS.map((backend) => (
                  <option key={backend} value={backend}>
                    {backend === 'auto'
                      ? t('upscaleEncoderAuto')
                      : backend === 'cpu'
                        ? t('upscaleEncoderCpu')
                        : backend === 'nvenc'
                          ? 'NVENC'
                          : 'AMF'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className={group}>
              <span className={label}>{t('upscaleAiGpu')}</span>
              <select
                aria-label={t('upscaleAiGpu')}
                className={select}
                disabled={disabled}
                value={options.aiGpuId}
                onChange={(event) => patch({ aiGpuId: event.target.value })}
              >
                <option value="auto">{t('upscaleAuto')}</option>
                {gpuOptions.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.id} · {device.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={group}>
              <span className={label}>{t('upscaleEncoderGpu')}</span>
              <select
                aria-label={t('upscaleEncoderGpu')}
                className={select}
                disabled={disabled || !isVideo}
                value={options.nvencGpuId}
                onChange={(event) => patch({ nvencGpuId: event.target.value })}
              >
                <option value="auto">{t('upscaleAuto')}</option>
                {encoderOptions.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.id} · {device.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-white/65">
            <input
              type="checkbox"
              className="size-3.5 accent-orange-400"
              disabled={disabled}
              checked={options.extremeMode}
              onChange={(event) =>
                patch({ extremeMode: event.target.checked })
              }
            />
            {t('upscaleExtremeMode')}
          </label>

          {isInterpolate ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className={group}>
                  <span className={label}>{t('upscaleDedup')}</span>
                  <select
                    aria-label={t('upscaleDedup')}
                    className={select}
                    disabled={disabled}
                    value={options.dedupMode}
                    onChange={(event) =>
                      patch({
                        dedupMode: event.target
                          .value as UpscaleOptions['dedupMode'],
                      })
                    }
                  >
                    {UPSCALE_DEDUP_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === 'off'
                          ? t('upscaleDedupOff')
                          : mode === 'fixed'
                            ? t('upscaleDedupFixed')
                            : mode === 'temporal_linear'
                              ? t('upscaleDedupTemporal')
                              : mode === 'anime_twos'
                                ? t('upscaleDedupAnimeTwos')
                                : mode === 'anime_twos_threes'
                                  ? t('upscaleDedupAnimeTwosThrees')
                                  : t('upscaleDedupSmooth')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={group}>
                  <span className={label}>{t('upscaleTransitionThreshold')}</span>
                  <select
                    aria-label={t('upscaleTransitionThreshold')}
                    className={select}
                    disabled={disabled || !options.transitionProtection}
                    value={options.transitionThreshold}
                    onChange={(event) =>
                      patch({
                        transitionThreshold: event.target
                          .value as UpscaleOptions['transitionThreshold'],
                      })
                    }
                  >
                    {UPSCALE_TRANSITION_THRESHOLDS.map((threshold) => (
                      <option key={threshold} value={threshold}>
                        {threshold === 'standard'
                          ? t('upscaleTransitionStandard')
                          : threshold === 'high'
                            ? t('upscaleTransitionHigh')
                            : t('upscaleTransitionLow')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-white/65">
                <input
                  type="checkbox"
                  className="size-3.5 accent-orange-400"
                  disabled={disabled}
                  checked={options.transitionProtection}
                  onChange={(event) =>
                    patch({ transitionProtection: event.target.checked })
                  }
                />
                {t('upscaleTransitionProtection')}
              </label>
            </>
          ) : null}

          {isVideo ? (
            <div className="grid grid-cols-2 gap-2">
              <div className={group}>
                <span className={label}>{t('upscaleBitDepth')}</span>
                <select
                  aria-label={t('upscaleBitDepth')}
                  className={select}
                  disabled={disabled}
                  value={String(options.bitDepth)}
                  onChange={(event) =>
                    patch({
                      bitDepth: Number(event.target
                        .value) as UpscaleOptions['bitDepth'],
                    })
                  }
                >
                  {UPSCALE_BIT_DEPTHS.map((depth) => (
                    <option key={depth} value={String(depth)}>
                      {depth}-bit
                    </option>
                  ))}
                </select>
              </div>
              <div className={group}>
                <span className={label}>{t('upscaleTile')}</span>
                <NumberField
                  value={options.tile}
                  min={0}
                  max={4096}
                  step={32}
                  labelText={t('upscaleTile')}
                  disabled={disabled}
                  onChange={(tile) => patch({ tile })}
                />
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-[11px] text-white/65">
            <input
              type="checkbox"
              className="size-3.5 accent-orange-400"
              disabled={disabled || !isVideo}
              checked={options.keepAudio}
              onChange={(event) => patch({ keepAudio: event.target.checked })}
            />
            {t('upscaleKeepAudio')}
          </label>
        </div>
      )}
    </div>
  );
}
