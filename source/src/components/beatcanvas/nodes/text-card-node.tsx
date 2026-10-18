import {Handle,Position,NodeResizer,type NodeProps} from '@xyflow/react';
import type {KeyboardEvent} from 'react';
import {Type,Sparkles,Image,Video} from 'lucide-react';
import type {BeatCanvasFlowNode} from '../react-flow/beatcanvas-react-flow-types';
import {useCanvasFrontLayer} from '../beatcanvas-front-layer-context';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import {ConnectionPicker} from '../connection-picker';
import {isCanvasTextCard} from '@/core/beatcanvas/canvas-types';
import {canAcceptTextCandidate} from '@/core/beatcanvas/text-contract';
const field='w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-400/70';
const action='rounded-lg border border-white/15 px-2.5 py-2 text-xs text-white/80 hover:bg-white/5 disabled:opacity-40';
export function TextCardNode({id,data,selected}:NodeProps<BeatCanvasFlowNode>){
  const actions=useCanvasFrontLayer(),t=useTranslations('CanvasTools'),card=actions.cards[id];
  if(!isCanvasTextCard(card)||!('textNode' in data.props))return null;
  const busy=actions.optimizingTextIds?.has(id)??false;
  const checkpoint=()=>actions.onTextHistoryCheckpoint?.();
  const stopKeys=(event:KeyboardEvent)=>event.stopPropagation();
  return <div data-card-id={id} style={{width:data.props.w,height:data.props.h}} className="flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#17181B] text-white shadow-xl">
    <Handle type="source" position={Position.Right} className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"/>
    <NodeResizer isVisible={selected} minWidth={360} minHeight={320} lineStyle={{borderColor:'#7fb0f2'}} handleStyle={{background:'#7fb0f2',width:8,height:8}}/>
    <div className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b border-white/10 px-3"><Type className="size-4 text-orange-300"/><input aria-label={t('textName')} maxLength={100} value={card.name} onFocus={checkpoint} onKeyDown={stopKeys} onChange={event=>actions.onTextChange?.(id,{name:event.target.value})} className="nodrag min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"/><span className="text-[10px] text-white/40">{t('localText')}</span></div>
    <div className="nodrag nowheel flex-1 space-y-3 overflow-y-auto p-3" onKeyDown={stopKeys}>
      <textarea aria-label={t('textContent')} placeholder={t('textPlaceholder')} value={card.prompt} disabled={busy} maxLength={20000} onFocus={checkpoint} onChange={event=>actions.onTextChange?.(id,{prompt:event.target.value})} className={`${field} min-h-32 resize-y leading-6`}/>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-white/35">{card.prompt.length}/20000</span><ConnectionPicker category="text" value={card.connectionId} disabled={busy} onChange={connectionId=>{checkpoint();actions.onTextChange?.(id,{connectionId});}}/></div>
      <input aria-label={t('textInstruction')} placeholder={t('instructionPlaceholder')} value={card.textInstruction||''} disabled={busy} maxLength={3000} onFocus={checkpoint} onChange={event=>actions.onTextChange?.(id,{textInstruction:event.target.value})} className={field}/>
      <p className="text-[11px] leading-5 text-white/40">{t('optimizationHint')}</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!card.prompt.trim()} onClick={()=>void actions.onOptimizeText?.(id)} className={`${action} flex items-center gap-1 border-orange-400/30 text-orange-300`}><Sparkles className="size-3.5"/>{t(busy?'optimizing':'optimizeText')}</button><button type="button" disabled={!card.prompt.trim()} onClick={()=>actions.onTextToGeneration?.(id,'image')} className={`${action} flex items-center gap-1`}><Image className="size-3.5"/>{t('textToImage')}</button><button type="button" disabled={!card.prompt.trim()} onClick={()=>actions.onTextToGeneration?.(id,'video')} className={`${action} flex items-center gap-1`}><Video className="size-3.5"/>{t('textToVideo')}</button></div>
      {card.error?<p role="alert" className="break-words text-xs text-red-300">{card.error}</p>:null}
      {card.textCandidate?<section aria-label={t('suggestion')} className="space-y-2 rounded-xl border border-orange-400/25 bg-black/15 p-3"><p className="text-xs text-orange-300">{t('suggestion')} · {card.textCandidate.connection.name} · {card.textCandidate.connection.model}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{card.textCandidate.text}</p>{!canAcceptTextCandidate(card.prompt,card.textCandidate)?<p className="text-xs text-amber-300">{t('textChanged')}</p>:null}<div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!canAcceptTextCandidate(card.prompt,card.textCandidate)} onClick={()=>actions.onAcceptText?.(id)} className={action}>{t('acceptText')}</button><button type="button" onClick={()=>actions.onTextCandidateToNewCard?.(id)} className={action}>{t('saveNewText')}</button><button type="button" onClick={()=>actions.onDiscardText?.(id)} className={action}>{t('discardText')}</button></div></section>:null}
      {card.textHistory?.length?<details><summary className="cursor-pointer text-xs text-white/55">{t('textHistory',{count:card.textHistory.length})}</summary><div className="mt-2 space-y-2">{card.textHistory.map(version=><div key={version.id} className="rounded-lg border border-white/10 p-2"><p className="whitespace-pre-wrap break-words text-xs leading-5 text-white/65">{version.text}</p><button type="button" disabled={busy} className="mt-2 text-xs text-orange-300" onClick={()=>actions.onRestoreTextVersion?.(id,version.id)}>{t('restoreText')}</button></div>)}</div></details>:null}
    </div>
  </div>;
}
