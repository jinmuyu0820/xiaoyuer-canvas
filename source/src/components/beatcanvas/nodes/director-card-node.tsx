import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Boxes, Play } from 'lucide-react';

import { getBeatCanvasNodeCopy } from './beatcanvas-node-copy';
import type { BeatCanvasFlowNode } from '../react-flow/beatcanvas-react-flow-types';

const CARD_RADIUS = 12;

const openDirectorDesk = (nodeId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('beatcanvas:open-director-node', {
      detail: { nodeId },
    })
  );
};

/**
 * Canvas node for the embedded 3D director desk.
 *
 * The heavy 3D editor never renders inside the node: like the upstream
 * TapCanvas `directorConsole` node, this card is the entry point and the editor
 * opens as an overlay bound to this node id. Exports land next to the card as a
 * connected video node.
 */
export function DirectorCardNode({ id, data, selected }: NodeProps<BeatCanvasFlowNode>) {
  const props = data.props;
  if (!('directorNode' in props)) return null;

  const { w, h, label, lastExportUrl } = props;
  const copy = getBeatCanvasNodeCopy();
  const title = label?.trim() || copy.directorTitle;
  const open = () => openDirectorDesk(id);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={150}
        lineClassName="!border-[var(--beat-graph)]"
        handleClassName="!size-2.5 !border-[var(--beat-graph)] !bg-[var(--beat-surface)]"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <div
        data-card-id={id}
        role="button"
        tabIndex={0}
        aria-label={`${copy.directorOpen}：${title}`}
        onDoubleClick={(event) => {
          event.stopPropagation();
          open();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.stopPropagation();
            open();
          }
        }}
        style={{
          width: w,
          height: h,
          borderRadius: CARD_RADIUS,
          border: selected
            ? '2px solid var(--beat-graph)'
            : '1px solid rgba(255,255,255,0.10)',
          boxShadow: selected
            ? '0 0 0 3px rgba(127,176,242,0.18)'
            : '0 10px 30px rgba(0,0,0,0.35)',
          background:
            'linear-gradient(150deg, rgba(31,34,40,0.98) 0%, rgba(20,22,26,0.98) 55%, rgba(16,18,22,0.98) 100%)',
        }}
        className="group relative flex cursor-grab flex-col justify-between overflow-hidden p-3 active:cursor-grabbing"
      >
        <div
          aria-hidden="true"
          style={{
            backgroundImage:
              'linear-gradient(rgba(127,176,242,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(127,176,242,0.10) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
          className="pointer-events-none absolute inset-0 opacity-60"
        />
        <div className="relative flex items-start gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[var(--beat-graph)]">
            <Boxes className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-white/85">{title}</p>
            <p className="truncate text-[10px] text-white/40">{copy.directorHint}</p>
          </div>
        </div>

        <div className="relative mt-2 flex items-center justify-between gap-2">
          <span className="truncate rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/50">
            {lastExportUrl ? copy.directorExported : copy.directorNotExported}
          </span>
          <button
            type="button"
            className="nodrag nopan inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--beat-graph)] px-2.5 py-1 text-[10px] font-semibold text-black transition hover:brightness-110"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            <Play className="size-3" strokeWidth={2.4} />
            {copy.directorOpen}
          </button>
        </div>
      </div>
    </>
  );
}
