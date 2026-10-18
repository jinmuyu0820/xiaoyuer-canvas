import type { SlvInstall } from './slv-install';
import {
  resolveRealcuganModel,
  resolveRealesrganModel,
  resolveUpscaleTask,
  type UpscaleMediaType,
  type UpscaleOptions,
} from './upscale-contract';

/**
 * Translating canvas options into `slv-engine.exe --cli` arguments.
 *
 * Kept pure (no child process, no filesystem) so the mapping can be asserted in
 * unit tests without a GPU.
 */

export type UpscaleCommandInput = {
  options: UpscaleOptions;
  mediaType: UpscaleMediaType;
  inputPath: string;
  outputPath: string;
  install: SlvInstall;
};

export const buildUpscaleArgs = ({
  options,
  mediaType,
  inputPath,
  outputPath,
  install,
}: UpscaleCommandInput): string[] => {
  const task = resolveUpscaleTask(options, mediaType);
  const args = [
    '--cli',
    '--task',
    task,
    '--input',
    inputPath,
    '--output-path',
    outputPath,
    '--ffmpeg',
    install.ffmpeg,
    '--realesrgan',
    install.realesrgan,
    '--realcugan',
    install.realcugan,
    '--anime4k',
    install.anime4k,
  ];

  if (task !== 'interpolate') {
    args.push('--upscale-backend', options.backend);
    if (options.backend === 'realesrgan') {
      args.push(
        '--model',
        resolveRealesrganModel({ model: options.model, scale: options.scale })
      );
    } else if (options.backend === 'realcugan') {
      args.push(
        '--realcugan-model',
        resolveRealcuganModel({
          model: options.realcuganModel,
          scale: options.scale,
        }),
        '--realcugan-noise',
        String(options.realcuganNoise)
      );
    } else {
      args.push('--anime4k-preset', options.anime4kPreset);
    }

    if (options.sizeMode === 'custom') {
      // The engine derives the other side from the source aspect ratio and
      // rejects a request that supplies both.
      args.push(
        '--upscale-size-mode',
        'custom',
        options.customAxis === 'height' ? '--target-height' : '--target-width',
        String(options.customSize)
      );
    } else {
      args.push(
        '--upscale-size-mode',
        'scale',
        '--scale',
        String(options.scale)
      );
    }
  } else {
    args.push(
      '--fps-mode',
      options.fpsMode,
      '--interp-algorithm',
      options.interpAlgorithm,
      '--rife-model-name',
      options.rifeModel,
      '--dedup-mode',
      options.dedupMode
    );
    if (options.fpsMode === 'custom') {
      args.push('--target-fps', String(options.targetFps));
    }
    if (options.transitionProtection) {
      args.push(
        '--transition-protection',
        '--transition-threshold',
        options.transitionThreshold
      );
    } else {
      args.push('--no-transition-protection');
    }
  }

  // The RIFE runtimes are irrelevant for a pure upscale, but pass them when the
  // install provides them so the engine never has to guess a path.
  if (install.rife) args.push('--rife', install.rife);
  if (install.rifeModern) args.push('--rife-modern', install.rifeModern);

  if (mediaType === 'video') {
    args.push(
      '--output-preset',
      options.outputPreset,
      '--video-codec',
      options.videoCodec,
      '--encoder-backend',
      options.encoderBackend,
      '--bit-depth',
      String(options.bitDepth),
      options.keepAudio ? '--audio' : '--no-audio',
      '--audio-mode',
      options.audioMode
    );
    if (options.nvencGpuId !== 'auto') {
      args.push('--nvenc-gpu-id', options.nvencGpuId);
    }
  }

  args.push(
    '--performance-preset',
    options.performancePreset,
    options.extremeMode ? '--extreme-mode' : '--no-extreme-mode'
  );
  if (options.aiGpuId !== 'auto') args.push('--ai-gpu-id', options.aiGpuId);
  if (options.tile > 0) args.push('--tile', String(options.tile));

  // Every job writes into its own directory, so overwriting only ever replaces
  // a leftover file from a crashed attempt on the very same job.
  args.push('--overwrite');
  return args;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

export const inferUpscaleMediaType = (
  filename: string,
  fallback: UpscaleMediaType = 'video'
): UpscaleMediaType => {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return fallback;
  const extension = filename.slice(dot).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? 'image' : fallback;
};

/**
 * `<name>-<result>.<ext>` keeps the processed file self-describing in the
 * canvas, in the asset library and in an export folder — the only provenance a
 * user sees once the card is on the canvas.
 *
 * The extension comes from the produced file, not from the source name: the
 * engine always writes PNG for images and the requested container for video, so
 * a `.webm` source still yields an honest `.mp4` name.
 */
export const buildUpscaledFileName = ({
  sourceFilename,
  options,
  extension,
}: {
  sourceFilename: string;
  options: UpscaleOptions;
  extension: string;
}) => {
  const safe = (sourceFilename || 'media')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .trim();
  const dot = safe.lastIndexOf('.');
  const base = (dot > 0 ? safe.slice(0, dot) : safe) || 'media';

  let suffix: string;
  if (options.task === 'interpolate') {
    suffix =
      options.fpsMode === 'custom'
        ? `fps${options.targetFps}`
        : options.fpsMode === '48' || options.fpsMode === '60'
          ? `fps${options.fpsMode}`
          : options.fpsMode;
  } else if (options.sizeMode === 'custom') {
    suffix = `${options.customSize}${options.customAxis === 'height' ? 'h' : 'w'}`;
  } else {
    suffix = `${options.scale}x`;
  }
  return `${base}-${suffix}${extension}`;
};
