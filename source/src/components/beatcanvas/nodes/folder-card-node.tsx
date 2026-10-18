import { ChevronRight, FolderOpen, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';

import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import type { BeatCanvasFlowNode } from '../react-flow/beatcanvas-react-flow-types';

/**
 * A canvas folder, drawn as a subproject icon.
 *
 * Double-clicking opens the folder's own canvas (its own level); renaming moved
 * to the context menu, because the double-click gesture now means "enter". The
 * icon itself never contains anything: membership is `card.folderId`, so the
 * folder is just an entry point.
 */
export function FolderCardNode({ id, data, selected }: NodeProps<BeatCanvasFlowNode>) {
  const t = useTranslations('CanvasTools');
  const props = data.props;
  if (!('folderNode' in props)) return null;

  const { w, h, label, memberCount, subfolderCount } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(label);
  }, [label]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // The context menu asks a node to start renaming instead of editing in place
  // from a double-click.
  useEffect(() => {
    const begin = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: string }>).detail?.cardId;
      if (cardId && cardId === id) setRenaming(true);
    };
    window.addEventListener('beatcanvas:begin-rename-folder', begin);
    return () => window.removeEventListener('beatcanvas:begin-rename-folder', begin);
  }, [id]);

  const commit = () => {
    setRenaming(false);
    const name = draft.trim();
    if (!name || name === label) {
      setDraft(label);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('beatcanvas:rename-folder', { detail: { cardId: id, name } })
    );
  };

  const enter = () => {
    window.dispatchEvent(
      new CustomEvent('beatcanvas:enter-folder', { detail: { folderId: id } })
    );
  };

  return (
    <div
      data-card-id={id}
      data-folder-card="true"
      data-folder-name={label}
      title={label}
      style={{
        width: w,
        height: h,
        borderRadius: 14,
        border: selected
          ? '1.5px solid rgba(251,146,60,0.9)'
          : '1px solid rgba(251,146,60,0.34)',
        background:
          'linear-gradient(160deg, rgba(251,146,60,0.16) 0%, rgba(251,146,60,0.05) 46%, rgba(24,24,27,0.86) 100%)',
        boxShadow: selected
          ? '0 0 0 3px rgba(251,146,60,0.14)'
          : '0 6px 18px rgba(0,0,0,0.28)',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 12,
        cursor: 'pointer',
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        enter();
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: 'rgba(251,146,60,0.18)', color: 'rgba(253,186,116,1)' }}
        >
          <FolderOpen className="size-4" aria-hidden="true" />
        </span>
        {renaming ? (
          <input
            ref={inputRef}
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(label);
                setRenaming(false);
              }
            }}
            className="nodrag nopan min-w-0 flex-1 rounded border border-orange-400/40 bg-black/40 px-1.5 py-0.5 text-[13px] font-semibold text-white outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-orange-50">
            {label}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-orange-200/75">
        <span className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono tabular-nums">
            {t('folderItems', { count: memberCount })}
          </span>
          {subfolderCount > 0 ? (
            <span className="flex items-center gap-1">
              <Layers className="size-3" aria-hidden="true" />
              {t('folderSubfolders', { count: subfolderCount })}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-orange-300/80">
          {t('folderEnterHint')}
          <ChevronRight className="size-3" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
