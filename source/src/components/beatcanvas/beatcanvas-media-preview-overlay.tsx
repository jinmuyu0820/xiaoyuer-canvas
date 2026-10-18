'use client';

import { useEffect } from 'react';

import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export type BeatCanvasPreviewMedia = {
  type: 'image' | 'video';
  url: string;
  title: string;
};

export function BeatCanvasMediaPreviewOverlay({
  media,
  closeLabel,
  onClose,
}: {
  media: BeatCanvasPreviewMedia | null;
  closeLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!media) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [media, onClose]);

  if (!media) {
    return null;
  }

  return (
    // Fixed and above every canvas surface: this used to sit inside the canvas
    // pane, so the preview opened behind the toolbar and looked like nothing
    // happened.
    <section
      aria-label={media.title}
      aria-modal="true"
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 py-10 backdrop-blur-sm"
      role="dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-full max-w-[min(1240px,calc(100vw-32px))] flex-col items-center">
        <div className="mb-2 flex w-full items-center justify-between gap-3 px-1">
          <span className="max-w-[70%] truncate rounded-full bg-black/70 px-3 py-1.5 text-[12px] font-medium text-white">
            {media.title}
          </span>
          <button
            type="button"
            aria-label={closeLabel}
            className={cn(
              'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/80 px-3 text-[12px] font-semibold text-white shadow-lg transition hover:bg-black'
            )}
            onClick={onClose}
          >
            <X className="size-4" strokeWidth={2.2} />
            <span>{closeLabel}</span>
          </button>
        </div>
        {media.type === 'video' ? (
          <video
            src={media.url}
            aria-label={media.title}
            controls
            autoPlay
            muted
            playsInline
            preload="metadata"
            className="max-h-[calc(100vh-170px)] max-w-full rounded-[10px] bg-black object-contain shadow-2xl"
          />
        ) : (
          <img
            src={media.url}
            alt={media.title}
            className="max-h-[calc(100vh-170px)] max-w-full rounded-[10px] bg-white object-contain shadow-2xl"
            draggable={false}
          />
        )}
      </div>
    </section>
  );
}
