import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';
import { Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { seekStaticVideoPreview } from '@/core/media/video-preview';

import { getBeatCanvasNodeCopy } from './beatcanvas-node-copy';
import type { BeatCanvasFlowNode } from '../react-flow/beatcanvas-react-flow-types';

/**
 * A local upscale job drawn as a canvas node.
 *
 * The node exists from the moment the job is queued, so the canvas itself is the
 * progress surface: the source media dims behind a percentage, and the node
 * turns into the finished media card in place. Video jobs can run for minutes,
 * which is why progress is never hidden behind a modal.
 */

const CARD_RADIUS = 8;

const dispatchCardAction = (name: string, cardId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail: { cardId } }));
};

const formatEta = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

export function UpscaleCardNode({
  id,
  data,
  selected,
}: NodeProps<BeatCanvasFlowNode>) {
  const props = data.props;
  if (!('upscaleNode' in props)) return null;

  const {
    w,
    h,
    title,
    cardMediaType,
    status,
    thumbnailUrl,
    sourceUrl,
    summary,
    task,
    progress,
    stage,
    speedFps,
    etaSeconds,
    errorMessage,
  } = props;

  const copy = getBeatCanvasNodeCopy();
  const isBusy = status === 'pending' || status === 'processing';
  const isFailed = status === 'failed';
  const [mediaStatus, setMediaStatus] = useState<'idle' | 'ready' | 'error'>(
    'idle'
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setMediaStatus('idle');
  }, [thumbnailUrl]);

  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const stageLabel = useMemo(() => {
    switch (stage) {
      case 'prepare':
        return copy.upscaleStagePrepare;
      case 'upscale':
        return copy.upscaleStageUpscale;
      case 'interpolate':
        return copy.upscaleStageInterpolate;
      case 'finalize':
        return copy.upscaleStageFinalize;
      case 'completed':
        return copy.upscaleStageCompleted;
      default:
        return copy.upscaleTitle;
    }
  }, [copy, stage]);

  const eta = formatEta(etaSeconds);
  const poster = thumbnailUrl ?? sourceUrl;
  const canPreview = Boolean(thumbnailUrl) && !isBusy && !isFailed;

  const openPreview = () => {
    if (!canPreview || !thumbnailUrl || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('beatcanvas:preview-media', {
        detail: { type: cardMediaType, url: thumbnailUrl, title },
      })
    );
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={120}
        lineClassName="!border-[var(--beat-graph)]"
        handleClassName="!size-2.5 !border-[var(--beat-graph)] !bg-[var(--beat-surface)]"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <div
        data-card-id={id}
        data-upscale-status={status}
        data-upscale-task={task}
        className="group cursor-grab active:cursor-grabbing"
        style={{
          width: w,
          height: h,
          borderRadius: CARD_RADIUS,
          background: 'var(--beat-surface)',
          border: selected
            ? '2px solid var(--beat-graph)'
            : isBusy
              ? '1px solid rgba(127,176,242,0.45)'
              : isFailed
                ? '1px solid rgba(248,113,113,0.45)'
                : '1px solid rgba(255,255,255,0.10)',
          boxShadow: selected
            ? '0 0 0 3px rgba(127,176,242,0.18)'
            : '0 14px 34px rgba(0,0,0,0.34)',
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {poster ? (
          cardMediaType === 'video' ? (
            // A video source must be drawn with a video element even while the
            // job runs: an <img> pointed at an .mp4 renders nothing.
            <video
              ref={videoRef}
              src={poster}
              aria-label={title}
              muted
              playsInline
              preload="metadata"
              draggable={false}
              onLoadedMetadata={(event) => {
                seekStaticVideoPreview(event.currentTarget);
                setMediaStatus('ready');
              }}
              onLoadedData={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
              onDoubleClick={openPreview}
              className="nowheel"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                cursor: canPreview ? 'zoom-in' : 'default',
                borderRadius: CARD_RADIUS - 1,
                opacity: isBusy || isFailed ? 0.35 : 1,
                filter: isBusy ? 'grayscale(0.5)' : undefined,
              }}
            />
          ) : (
            <img
              src={poster}
              alt={title}
              draggable={false}
              onLoad={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
              onDoubleClick={openPreview}
              className="nowheel"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                cursor: canPreview ? 'zoom-in' : 'default',
                borderRadius: CARD_RADIUS - 1,
                opacity: isBusy || isFailed ? 0.35 : 1,
                filter: isBusy ? 'grayscale(0.5)' : undefined,
              }}
            />
          )
        ) : null}

        {mediaStatus === 'error' && !isBusy ? (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-[var(--beat-text-3)]">
            {copy.previewUnavailable}
          </div>
        ) : null}

        {/* Node-bound settings: the options live with the card, not in a global panel. */}
        <button
          type="button"
          aria-label={copy.upscaleSettings}
          title={copy.upscaleSettings}
          data-upscale-settings="true"
          className="nodrag nopan nowheel absolute left-2 top-2 z-10 grid size-7 place-items-center rounded-md border border-white/15 bg-black/55 text-white/80 opacity-55 shadow-md backdrop-blur transition-opacity hover:bg-black/75 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => dispatchCardAction('beatcanvas:upscale-settings', id)}
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
        </button>

        <span
          className="pointer-events-none absolute left-11 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white/85"
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {task === 'interpolate'
            ? copy.upscaleTaskInterpolate
            : copy.upscaleTaskUpscale}
        </span>

        {/* Result badge keeps the output self-describing on the canvas. */}
        <span
          className="pointer-events-none absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
          style={{
            background: isFailed
              ? 'rgba(248,113,113,0.85)'
              : 'rgba(0,0,0,0.62)',
            border: '1px solid rgba(255,255,255,0.16)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {summary}
        </span>

        {isBusy ? (
          <div
            className="nodrag nopan nowheel absolute inset-0 flex flex-col justify-end gap-2 p-3"
            role="status"
            aria-live="polite"
          >
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-white">
                {stageLabel}
              </p>
              <p className="mt-0.5 text-[10px] text-white/60">
                {status === 'pending' ? copy.upscaleQueued : copy.upscaleRunning}
                {typeof speedFps === 'number' && speedFps > 0
                  ? ` · ${speedFps.toFixed(1)} fps`
                  : ''}
                {eta ? ` · ${copy.upscaleEta} ${eta}` : ''}
              </p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[var(--beat-graph)] transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums text-white/80">
                {percent}%
              </span>
              <button
                type="button"
                className="rounded-md border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] text-white/80 hover:bg-black/60"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => dispatchCardAction('beatcanvas:upscale-cancel', id)}
              >
                {copy.upscaleCancel}
              </button>
            </div>
          </div>
        ) : null}

        {isFailed ? (
          <div className="nodrag nopan nowheel absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 p-3 text-center">
            <p className="text-[11px] font-semibold text-red-300">
              {copy.upscaleFailed}
            </p>
            <p className="line-clamp-3 text-[10px] leading-4 text-white/65">
              {errorMessage || copy.generationFailed}
            </p>
            <button
              type="button"
              className="rounded-md border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] text-white/85 hover:bg-black/60"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => dispatchCardAction('beatcanvas:upscale-retry', id)}
            >
              {copy.upscaleRetry}
            </button>
          </div>
        ) : null}

        {canPreview && mediaStatus === 'ready' ? (
          <button
            type="button"
            aria-label={`${copy.viewResult}: ${title}`}
            className="nodrag nopan nowheel absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/65 text-lg text-white opacity-70 shadow-lg transition-[opacity,transform] hover:scale-105 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--beat-graph)] group-hover:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openPreview}
          >
            <span aria-hidden="true" className={cardMediaType === 'video' ? 'ml-0.5' : ''}>
              {cardMediaType === 'video' ? '▶' : '⤢'}
            </span>
          </button>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
    </>
  );
}
