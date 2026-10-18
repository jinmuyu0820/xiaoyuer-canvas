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
  normalizeUpscaleOptions,
  type UpscaleEngineStatus,
  type UpscaleOptions,
} from '@/core/upscale/upscale-contract';
import type { CanvasUpscaleCard } from '@/core/beatcanvas/canvas-types';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

import { UpscaleOptionsForm } from './upscale-options-form';

const chip =
  'inline-flex items-center justify-center rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5 disabled:opacity-40';
const primary =
  'inline-flex items-center justify-center rounded-lg border border-orange-400/60 bg-orange-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40';

/**
 * Settings for an existing node. Opening this from the gear on the node keeps
 * options editable after the first dialog is gone, and lets a failed job retry
 * with the exact same settings.
 */
export function UpscaleNodeSettings({
  projectId,
  card,
  onClose,
  onSave,
  onRun,
}: {
  projectId: string;
  card: CanvasUpscaleCard;
  onClose: () => void;
  onSave: (options: UpscaleOptions) => void;
  onRun: (options: UpscaleOptions) => void;
}) {
  const t = useTranslations('CanvasTools');
  const [options, setOptions] = useState<UpscaleOptions>(() =>
    normalizeUpscaleOptions(
      card.upscaleOptions ?? {
        backend: card.upscaleBackend ?? undefined,
        scale: card.upscaleScale ?? undefined,
      },
      card.type === 'image' ? 'image' : 'video'
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
      .catch(() => {
        if (active) setEngine(null);
      })
      .finally(() => {
        if (active) setLoadingEngine(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const busy = card.status === 'pending' || card.status === 'processing';
  const succeeded = card.status === 'succeeded';

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="beat-product-shell grid-cols-1 max-h-[88vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#111214] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('upscaleSettingsTitle')}</DialogTitle>
          <DialogDescription className="text-white/45">
            {t('upscaleSettingsHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/55">
            {card.name}
          </p>
          <span className="text-[10px] text-white/40">
            {loadingEngine ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                {t('upscaleEngineChecking')}
              </span>
            ) : engine?.available ? (
              <>
                {t('upscaleEngineReady')}
                {engine.gpu ? ` · ${engine.gpu}` : ''}
              </>
            ) : (
              <span className="text-red-300">{t('upscaleEngineMissing')}</span>
            )}
          </span>
        </div>

        {succeeded ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10px] leading-4 text-white/45">
            {t('upscaleRerunHint')}
          </p>
        ) : null}

        <UpscaleOptionsForm
          value={options}
          onChange={setOptions}
          mediaType={card.type === 'image' ? 'image' : 'video'}
          engine={engine}
          disabled={busy}
          onValidationChange={setOptionsInvalid}
        />

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-white/10 bg-[#111214] px-4 py-3">
          <button type="button" className={chip} onClick={onClose}>
            {t('upscaleCancelAction')}
          </button>
          <button
            type="button"
            className={chip}
            disabled={busy || optionsInvalid}
            onClick={() => {
              onSave(options);
              onClose();
            }}
          >
            {t('upscaleSaveSettings')}
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy || optionsInvalid}
            onClick={() => {
              onRun(options);
              onClose();
            }}
          >
            {succeeded ? t('upscaleRunNewNode') : t('upscaleSaveAndRun')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
