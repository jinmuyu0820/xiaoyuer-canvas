import {useEffect,useRef} from 'react';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import type {CanvasContextMenuTarget} from '@/core/beatcanvas/context-menu';
import {useCanvasFrontLayer} from './beatcanvas-front-layer-context';
export type CanvasContextMenuState={target:CanvasContextMenuTarget;shapeIds:string[];pagePoint:{x:number;y:number};screenPoint:{x:number;y:number}};
export function CanvasContextMenu({menu,onClose}:{menu:CanvasContextMenuState;onClose:()=>void}){
  const t=useTranslations('CanvasTools'),actions=useCanvasFrontLayer(),ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{ref.current?.querySelector<HTMLButtonElement>('button')?.focus();const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))onClose();};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();}};document.addEventListener('pointerdown',close,true);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('pointerdown',close,true);document.removeEventListener('keydown',key,true);};},[onClose]);
  const click=(action:()=>void)=>{action();onClose();};
  const item='block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5 focus:bg-white/5 focus:outline-none';
  const hint='px-3 py-2 text-[11px] leading-4 text-white/40';
  const node=menu.target.kind==='node';
  const targetCard=menu.shapeIds.length===1?actions.cards[menu.shapeIds[0]??'']:undefined;
  // A subproject icon has its own three actions: enter, rename, delete. The
  // double-click means "enter", so renaming lives here.
  const folderCard=node&&targetCard?.kind==='folder'?targetCard:undefined;
  // Local upscale is a per-asset action: exactly one selected image or video
  // that already has a stored project asset to read from disk.
  const canUpscale=Boolean(targetCard&&targetCard.assetId&&(targetCard.type==='image'||targetCard.type==='video')&&(targetCard.kind==='asset'||targetCard.kind==='generation'||targetCard.kind==='upscale'));
  const canCreateFolder=actions.canCreateFolder!==false;
  const height=folderCard?218:node?286:menu.shapeIds.length?510:388;
  return <div ref={ref} role="menu" aria-label={t(node?'nodeMenu':'newMenu')} style={{left:Math.max(8,Math.min(menu.screenPoint.x,window.innerWidth-244)),top:Math.max(8,Math.min(menu.screenPoint.y,window.innerHeight-height))}} className="pointer-events-auto fixed z-[100] w-60 rounded-xl border border-white/15 bg-[#17181B] p-2 text-white shadow-2xl" onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
    {folderCard?<>
      <button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onEnterFolder?.(folderCard.id))}>{t('folderEnter')}</button>
      <button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onRenameFolder?.(folderCard.id))}>{t('folderRename')}</button>
      <div className="my-1 border-t border-white/10"/>
      <button type="button" role="menuitem" className={`${item} text-red-300`} onClick={()=>click(()=>actions.onDeleteFolder?.(folderCard.id))}>{t('folderDelete')}</button>
      <p className={hint}>{t('folderDeleteHint')}</p>
    </>:node?<>
      {canUpscale?<><button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onUpscaleCanvasSelection?.(menu.shapeIds[0]??''))}>{t('upscaleNode')}</button><div className="my-1 border-t border-white/10"/></>:null}
      {canCreateFolder?<><button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onCreateFolder?.(menu.shapeIds))}>{t('newFolder')}</button><p className={hint}>{t('newFolderHint')}</p><div className="my-1 border-t border-white/10"/></>:null}
      <button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onDuplicateCanvasSelection?.(menu.shapeIds))}>{t('duplicateNodes',{count:menu.shapeIds.length})}</button>
      <button type="button" role="menuitem" className={`${item} text-red-300`} onClick={()=>click(()=>actions.onDeleteCanvasSelection?.(menu.shapeIds))}>{t('deleteNodes',{count:menu.shapeIds.length})}</button>
      <p className={hint}>{t('deleteNodeHint')}</p>
    </>:<>
      {menu.shapeIds.length?<p className="px-3 pb-1 pt-2 text-[11px] text-white/40">{t('selectionCount',{count:menu.shapeIds.length})}</p>:null}
      {canCreateFolder?<><button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onCreateFolder?.(menu.shapeIds,menu.pagePoint))}>{t('newFolder')}</button><p className={hint}>{t('newFolderHint')}</p></>:<p className={hint}>{t('folderDepthLimit')}</p>}
      <div className="my-1 border-t border-white/10"/>
      <button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onCreateTextCard?.(menu.pagePoint))}>{t('newText')}</button>
      {(['image','video'] as const).map(taskType=><button key={taskType} type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onCreateGenerationAtPoint({taskType,pagePoint:menu.pagePoint}))}>{t(taskType==='image'?'newImage':'newVideo')}</button>)}
      <div className="my-1 border-t border-white/10"/>
      <button type="button" role="menuitem" className={item} onClick={()=>click(()=>actions.onCreateDirectorCard?.(menu.pagePoint))}>{t('newDirector')}</button>
    </>}
  </div>;
}
