import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchUpscaleEngine } from '@/core/upscale/upscale-client';
import {
  DEFAULT_UPSCALE_OPTIONS,
  normalizeUpscaleOptions,
  type UpscaleEngineStatus,
  type UpscaleMediaType,
  type UpscaleOptions,
} from '@/core/upscale/upscale-contract';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

import { UpscaleOptionsForm } from './upscale-options-form';

const chip =
  'inline-flex items-center justify-center rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5 disabled:opacity-40';

const emptySetup = () => ({
  guiAvailable: false,
  guiRoot: null,
  guiLastLaunchedAt: null,
  manualUpscaleAt: null,
  manualInterpolateAt: null,
  confirmedAt: null,
});

const unavailableEngine = (error: string): UpscaleEngineStatus => ({
  available: false,
  root: null,
  engineVersion: null,
  productName: 'Local engine',
  gpu: null,
  gpus: [],
  encoders: [],
  paths: null,
  setup: emptySetup(),
  error,
});

/**
 * Options for one local processing job.
 *
 * The dialog only collects parameters: the job itself is bound to a canvas node
 * so progress keeps running (and stays visible) after this closes. Video jobs
 * routinely take minutes, so nothing here blocks on completion.
 */
export function UpscaleDialog({
  projectId,
  mediaType,
  sourceName,
  initialOptions,
  onClose,
  onStart,
}: {
  projectId: string;
  mediaType: UpscaleMediaType;
  sourceName: string;
  initialOptions?: UpscaleOptions | null;
  onClose: () => void;
  onStart: (options: UpscaleOptions) => void;
}) {
  const t = useTranslations('CanvasTools');
  const [options, setOptions] = useState<UpscaleOptions>(() =>
    normalizeUpscaleOptions(
      initialOptions ?? DEFAULT_UPSCALE_OPTIONS,
      mediaType
    )
  );
  const [engine, setEngine] = useState<UpscaleEngineStatus | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(true);
  const [optionsInvalid, setOptionsInvalid] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchUpscaleEngine({ projectId })
      .then((result) => {
        if (active) setEngine(result.engine);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEngine(
          unavailableEngine(
            error instanceof Error ? error.message : String(error)
          )
        );
      })
      .finally(() => {
        if (active) setLoadingEngine(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const start = () => {
    onStart(options);
    onClose();
  };

  const unavailable = !loadingEngine && !engine?.available;
  const canStart =
    !loadingEngine && Boolean(engine?.available) && !optionsInvalid;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="beat-product-shell grid-cols-1 max-h-[88vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#111214] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('upscaleDialogTitle')}</DialogTitle>
          <DialogDescription className="text-white/45">
            {t('upscaleDialogHint')}
          </DialogDescription>
        </DialogHeader>

        <p className="truncate rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/55">
          {sourceName}
        </p>

        <div aria-live="polite" className="text-[11px] leading-5">
          {loadingEngine ? (
            <span className="inline-flex items-center gap-1.5 text-white/45">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              {t('upscaleEngineChecking')}
            </span>
          ) : unavailable ? (
            <span className="text-red-300">
              {t('upscaleEngineMissing')}
              {engine?.error ? ` ${engine.error}` : ''}
            </span>
          ) : (
            <span className="text-white/45">
              {t('upscaleEngineReady')}
              {engine?.gpu ? ` · ${engine.gpu}` : ''}
            </span>
          )}
        </div>

        <UpscaleOptionsForm
          value={options}
          onChange={setOptions}
          mediaType={mediaType}
          engine={engine}
          onValidationChange={setOptionsInvalid}
        />

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-white/10 bg-[#111214] px-4 py-3">
          <button type="button" className={chip} onClick={onClose}>
            {t('upscaleCancelAction')}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-orange-400/60 bg-orange-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
            disabled={!canStart}
            onClick={start}
          >
            {t('upscaleStart')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
