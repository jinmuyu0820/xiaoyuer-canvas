import { useQuery } from '@tanstack/react-query';
import {
  AudioLines,
  ExternalLink,
  FolderOpen,
  Images,
  Loader2,
  MousePointer2,
  Plus,
  Video,
} from 'lucide-react';
import { useState } from 'react';
import {AssetDetailsDialog} from './asset-details-dialog';
import {AddToLibraryDialog} from './add-to-library-dialog';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  fetchRecentAssets,
  type RecentAsset,
  type RecentAssetsResponse,
} from '@/core/workspace-lib/app/workspace-client-api';
import { recentAssetsKeys } from '@/core/workspace-lib/app/workspace-query-keys';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { beatPanelLabelClassName } from '@/components/app/composer-styles';
import {
  PROJECT_ASSET_DRAG_MIME,
  PROJECT_ASSET_INSERT_EVENT,
  type ProjectAssetInsertDetail,
  type ProjectAssetTransfer,
} from '@/core/beatcanvas/project-asset-transfer';

const assetOperation = (asset: RecentAsset) => {
  if (!asset.metadata || typeof asset.metadata !== 'object') return '';
  const operation = (asset.metadata as { operation?: unknown }).operation;
  return typeof operation === 'string' ? operation : '';
};

export type ProjectAssetMediaType='image'|'video'|'audio';
export type ProjectAssetTypeFilter='all'|ProjectAssetMediaType;

export function useProjectAssetsQuery(projectId:string,limit?:number){
  return useQuery({
    queryKey:[...recentAssetsKeys.lists(projectId),limit??'default'],
    queryFn:()=>fetchRecentAssets(projectId,limit),
    staleTime:30*1000,
    // Keep the current list while loading more, but never show another project's assets.
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[2]===projectId?previous:undefined,
  });
}

export function filterProjectAssets(data:RecentAssetsResponse|undefined,search:string,typeFilter:ProjectAssetTypeFilter,onlyAssetIds?:ReadonlySet<string>|null){
  const needle=search.toLocaleLowerCase();
  const matches=(asset:RecentAsset)=>(asset.filename||asset.id).toLocaleLowerCase().includes(needle)&&(!onlyAssetIds||onlyAssetIds.has(asset.id));
  const pick=(type:ProjectAssetMediaType,list:RecentAsset[]|undefined)=>typeFilter==='all'||typeFilter===type?(list??[]).filter(matches):[];
  return {images:pick('image',data?.images),videos:pick('video',data?.videos),audios:pick('audio',data?.audios)};
}

function AssetTile({asset,mediaType,projectId,canAddToCanvas,onAdded,addLabel,badgeLabel,openLabel,selected,onToggleSelected}:{
  asset:RecentAsset;mediaType:ProjectAssetMediaType;projectId:string;canAddToCanvas:boolean;onAdded:()=>void;addLabel:string;badgeLabel:string|null;openLabel:string;selected?:boolean;onToggleSelected?:(assetId:string)=>void;
}){
  const t=useTranslations('Library'),[details,setDetails]=useState(false),[adding,setAdding]=useState(false);
  const transfer:ProjectAssetTransfer={...asset,projectId,mediaType};
  const addToCanvas=()=>{if(!canAddToCanvas)return;window.dispatchEvent(new CustomEvent<ProjectAssetInsertDetail>(PROJECT_ASSET_INSERT_EVENT,{detail:{asset:transfer}}));onAdded();};
  return <div draggable={canAddToCanvas} onDragStart={event=>{if(!canAddToCanvas){event.preventDefault();return;}event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(PROJECT_ASSET_DRAG_MIME,JSON.stringify(transfer));}} onDragEnd={event=>{if(event.dataTransfer.dropEffect==='copy')onAdded();}} className={`group w-64 overflow-hidden rounded-xl border bg-white/[0.025] ${selected?'border-orange-400/60 ring-1 ring-orange-400/40':'border-white/10'}`}>
    <div className="relative flex h-40 items-center justify-center bg-black/15">
      {onToggleSelected?<label className="absolute bottom-2 left-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-md bg-black/65"><input type="checkbox" checked={Boolean(selected)} onChange={()=>onToggleSelected(asset.id)} aria-label={`${t('selectItem')}: ${asset.filename||asset.id}`} className="size-4 accent-orange-500"/></label>:null}
      {mediaType==='audio'?<div className="w-full space-y-3 px-3"><AudioLines className="mx-auto size-7 text-blue-300/70"/><audio src={asset.publicUrl} controls preload="metadata" className="h-8 w-full" onPointerDown={event=>event.stopPropagation()}/></div>:<button type="button" aria-label={`${t('details')}: ${asset.filename||asset.id}`} className="size-full" onClick={()=>setDetails(true)}>{mediaType==='video'?<video src={asset.publicUrl} muted playsInline preload="metadata" className="size-full object-contain"/>:<img src={asset.publicUrl} alt={asset.filename||''} loading="lazy" className="size-full object-contain"/>}</button>}
      {badgeLabel?<span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[10px] text-orange-300">{badgeLabel}</span>:null}
      <a href={asset.publicUrl} target="_blank" rel="noreferrer" aria-label={`${openLabel}: ${asset.filename||asset.id}`} title={openLabel} className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/65 p-1.5 text-white/65"><ExternalLink className="size-3.5"/></a>
    </div>
    <div className="space-y-2 p-3"><p className="truncate text-xs font-medium text-white/75" title={asset.filename||asset.id}>{asset.filename||asset.id}</p><div className="flex flex-wrap gap-3"><button type="button" className="text-xs text-white/60" onClick={()=>setDetails(true)}>{t('details')}</button><button type="button" className="text-xs text-orange-300" onClick={()=>setAdding(true)}>{t('addToLibrary')}</button>{canAddToCanvas?<button type="button" className="text-xs text-white/70" onClick={addToCanvas} aria-label={`${addLabel}: ${asset.filename||asset.id}`}>{addLabel}</button>:null}</div></div>
    {details?<AssetDetailsDialog projectId={projectId} assetId={asset.id} onClose={()=>setDetails(false)}/>:null}
    {adding?<AddToLibraryDialog projectId={projectId} assetId={asset.id} type={mediaType} onClose={()=>setAdding(false)}/>:null}
  </div>;
}

export function ProjectAssetsLibrary({
  projectId,
  canAddToCanvas = false,
  onAdded,
  search='',
  typeFilter='all',
  limit,
  selectedIds,
  onToggleSelected,
  onlyAssetIds,
}: {
  projectId: string;
  canAddToCanvas?: boolean;
  onAdded?: () => void;
  search?:string;
  typeFilter?:ProjectAssetTypeFilter;
  limit?:number;
  selectedIds?:ReadonlySet<string>;
  onToggleSelected?:(assetId:string)=>void;
  /** Restrict the list to the assets of one canvas folder. */
  onlyAssetIds?:ReadonlySet<string>|null;
}) {
  const t = useTranslations('AppShell.header.projectAssets');
  const assetsQuery = useProjectAssetsQuery(projectId,limit);
  const {images,videos,audios}=filterProjectAssets(assetsQuery.data,search,typeFilter,onlyAssetIds);
  const total = images.length + videos.length + audios.length;
  const badgeFor = (asset: RecentAsset) => {
    const operation = assetOperation(asset);
    if (operation === 'video_tail_frame') return t('tailFrame');
    if (asset.assetClass === 'derived') return t('derivedClip');
    return null;
  };

  return (
    <>
      {assetsQuery.isLoading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 text-[13px] text-white/45">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : null}

      {assetsQuery.isError ? (
        <div className="flex min-h-52 items-center justify-center text-[13px] text-[#ff8a8d]">
          {t('loadFailed')}
        </div>
      ) : null}

      {!assetsQuery.isLoading && !assetsQuery.isError && total === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center text-center">
          <span className="grid size-12 place-items-center rounded-[15px] border border-white/[0.08] bg-white/[0.035] text-white/28">
            <Images className="size-5" />
          </span>
          <p className="mt-4 text-[14px] font-medium text-white/72">
            {t('empty')}
          </p>
        </div>
      ) : null}

      {!assetsQuery.isLoading && !assetsQuery.isError && total > 0 ? (
        <div className="space-y-6">
          {([['image',images,'images'],['video',videos,'videos'],['audio',audios,'audios']] as const).map(([mediaType,list,label])=>list.length>0?(
            <section key={mediaType}>
              <h3 className={`mb-3 ${beatPanelLabelClassName}`}>
                {t(label)}
              </h3>
              <div className="flex flex-wrap gap-3">
                {list.map((asset) => (
                  <AssetTile
                    key={asset.id}
                    asset={asset}
                    mediaType={mediaType}
                    projectId={projectId}
                    canAddToCanvas={canAddToCanvas}
                    onAdded={() => onAdded?.()}
                    addLabel={t('addToCanvas')}
                    badgeLabel={badgeFor(asset)}
                    openLabel={t('openOriginal')}
                    selected={selectedIds?.has(asset.id)}
                    onToggleSelected={onToggleSelected}
                  />
                ))}
              </div>
            </section>
          ):null)}
        </div>
      ) : null}
    </>
  );
}

export function ProjectAssetsDialog({
  projectId,
  canAddToCanvas = false,
}: {
  projectId: string;
  canAddToCanvas?: boolean;
}) {
  const t = useTranslations('AppShell.header.projectAssets');
  const [open, setOpen] = useState(false);

  return (
    <Dialog modal={false} open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={t('triggerLabel')}
        title={t('triggerLabel')}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 text-[#a0a1a8] transition hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a33]/45 sm:px-3"
      >
        <Images className="size-[16px]" />
        <span className="hidden text-xs font-medium sm:inline">
          {t('triggerLabel')}
        </span>
      </DialogTrigger>

      <DialogContent
        showOverlay={false}
        className="max-h-[82vh] overflow-hidden rounded-[28px] border border-white/10 bg-[#111214] p-0 text-[#f5f5f7] shadow-[0_34px_110px_rgba(0,0,0,0.62)] ring-0 sm:max-w-[760px] [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:text-white/45 [&_[data-slot=dialog-close]]:hover:bg-white/[0.07] [&_[data-slot=dialog-close]]:hover:text-white"
      >
        <DialogHeader className="border-b border-white/[0.08] px-6 pb-5 pt-6 text-left">
          <span className="mb-2 grid size-10 place-items-center rounded-[13px] border border-[#ff7a33]/25 bg-[#ff7a33]/10 text-[#ff8b4d]">
            <FolderOpen className="size-[18px]" />
          </span>
          <DialogTitle className="text-[21px] font-semibold tracking-[-0.03em] text-white">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="max-w-xl text-[13px] leading-5 text-white/48">
            {t('description')}
          </DialogDescription>
          {canAddToCanvas ? (
            <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-[#ff7a33]/18 bg-[#ff7a33]/[0.07] px-3 py-1.5 text-[11px] font-medium text-[#ffad7e]">
              <MousePointer2 className="size-3.5" />
              {t('canvasHint')}
            </div>
          ) : null}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-5 sm:px-6">
          <ProjectAssetsLibrary
            projectId={projectId}
            canAddToCanvas={canAddToCanvas}
            onAdded={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
