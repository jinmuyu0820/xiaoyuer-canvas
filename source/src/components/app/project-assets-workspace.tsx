import { ProjectAssetsLibrary, filterProjectAssets, useProjectAssetsQuery, type ProjectAssetMediaType, type ProjectAssetTypeFilter } from '@/components/app/project-assets-dialog';
import type { RecentAsset } from '@/core/workspace-lib/app/workspace-client-api';
import { BatchExportDialog } from '@/components/app/batch-export-dialog';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { toast } from 'sonner';
import { Folder, FolderOpen } from 'lucide-react';
import {useState,useEffect,useMemo} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {recentAssetsKeys} from '@/core/workspace-lib/app/workspace-query-keys';
import {summarizeCanvasFolders} from '@/core/beatcanvas/folders';
import type {CanvasCard} from '@/core/beatcanvas/canvas-types';
import {libraryCategories,libraryCategoryKeys,categoryAcceptsMedia,type LibraryCategory,type ScanResult} from '@/core/projects/library-contract';

const PAGE_SIZE=100;
type SelectableAsset={asset:RecentAsset;type:ProjectAssetMediaType};
const flatten=({images,videos,audios}:{images:RecentAsset[];videos:RecentAsset[];audios:RecentAsset[]}):SelectableAsset[]=>[
  ...images.map(asset=>({asset,type:'image' as const})),
  ...videos.map(asset=>({asset,type:'video' as const})),
  ...audios.map(asset=>({asset,type:'audio' as const})),
];
const button='rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40';

export function ProjectAssetsWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations('AppShell.header.projectAssets');
  const localT = useTranslations('LocalWorkspace');
  const libraryT=useTranslations('Library'),batchT=useTranslations('BatchExport'),client=useQueryClient();
  const [search,setSearch]=useState(''),[type,setType]=useState<ProjectAssetTypeFilter>('all'),[busy,setBusy]=useState(false),[folder,setFolder]=useState('');
  const [limit,setLimit]=useState(PAGE_SIZE),[selected,setSelected]=useState<Set<string>>(new Set()),[exporting,setExporting]=useState(false),[category,setCategory]=useState<LibraryCategory|''>('');
  const query=useProjectAssetsQuery(projectId,limit);
  // Folders live on the canvas, so their membership is read from the snapshot.
  const foldersQuery=useQuery({
    queryKey:['project-canvas-folders',projectId],
    queryFn:async()=>{
      const payload=await apiJsonGet<{document?:{cards?:CanvasCard[]}}>(`/api/app/projects/${projectId}/snapshot`);
      return summarizeCanvasFolders(payload.document?.cards??[]);
    },
    staleTime:0,
  });
  const folders=foldersQuery.data?.folders??[];
  const [activeFolderId,setActiveFolderId]=useState<string|null>(null);
  const activeFolder=folders.find(item=>item.id===activeFolderId)??null;
  const onlyAssetIds=useMemo(()=>activeFolder?new Set(activeFolder.assetIds):null,[activeFolder]);
  useEffect(()=>{let active=true;void apiJsonPost<{path:string}>(`/api/app/projects/${projectId}/open-folder`,{kind:'materials',open:false}).then(data=>{if(active)setFolder(data.path);}).catch(()=>{});return()=>{active=false;};},[projectId]);
  useEffect(()=>{setSelected(new Set());setLimit(PAGE_SIZE);},[projectId]);
  const visible=useMemo(()=>flatten(filterProjectAssets(query.data,search,type,onlyAssetIds)),[query.data,search,type,onlyAssetIds]);
  const allLoaded=useMemo(()=>new Map(flatten(filterProjectAssets(query.data,'','all')).map(item=>[item.asset.id,item])),[query.data]);
  // Drop selections for assets that are no longer loaded (deleted or rescanned).
  const selectedItems=[...selected].flatMap(id=>{const item=allLoaded.get(id);return item?[item]:[];});
  const hasMore=Boolean(query.data?.hasMore&&(query.data.hasMore.images||query.data.hasMore.videos||query.data.hasMore.audios));
  const toggle=(assetId:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(assetId))next.delete(assetId);else next.add(assetId);return next;});
  const allVisibleSelected=visible.length>0&&visible.every(item=>selected.has(item.asset.id));
  const selectAll=()=>setSelected(previous=>{const next=new Set(previous);for(const item of visible)next.add(item.asset.id);return next;});
  const scan=async()=>{if(busy)return;setBusy(true);try{const result=await apiJsonPost<ScanResult>(`/api/app/projects/${projectId}/materials`,{action:'scan'});await client.invalidateQueries({queryKey:recentAssetsKeys.lists(projectId)});toast.success(libraryT('scanResult',{added:result.added,updated:result.updated,skipped:result.skipped}));if(result.warnings.length)toast.warning(result.warnings.slice(0,3).join('\n'));}catch(error){toast.error(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const openFolder = async (kind: 'materials'|'library') => {
    try { await apiJsonPost(`/api/app/projects/${projectId}/open-folder`, {kind}); }
    catch(error) {toast.error(error instanceof Error?error.message:String(error));}
  };
  const addSelectedToLibrary=async(target:LibraryCategory)=>{
    if(busy)return;setBusy(true);
    const accepted=selectedItems.filter(item=>categoryAcceptsMedia(target,item.type)),skipped=selectedItems.length-accepted.length;
    let added=0;const errors:string[]=[];
    try{
      for(const item of accepted){try{await apiJsonPost(`/api/app/projects/${projectId}/library`,{action:'add',assetId:item.asset.id,category:target});added++;}catch(error){errors.push(`${item.asset.filename||item.asset.id}: ${error instanceof Error?error.message:String(error)}`);}}
      await client.invalidateQueries({queryKey:['local-library',projectId]});
      if(added)toast.success(batchT('addedToCategory',{count:added,category:libraryT(libraryCategoryKeys[target])}));
      if(skipped)toast.warning(batchT('skippedType',{count:skipped}));
      if(errors.length)toast.error(errors.slice(0,3).join('\n'));
    }finally{setBusy(false);setCategory('');}
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--beat-bg)] text-[var(--beat-text-1)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_112%,rgba(255,122,51,0.12),transparent_34%),linear-gradient(180deg,#08090a_0%,#0b0b0d_48%,#08090a_100%)]" />
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-[1138px]">
          <h1 className="beat-product-display text-[1.35rem] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)]">
            {t('title')}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[var(--beat-text-3)]">
            {t('description')}
          </p>
          <div className="mt-8">
            <div className="mb-5 flex flex-wrap gap-2">{(['materials','library'] as const).map(kind=><button key={kind} type="button" onClick={()=>void openFolder(kind)} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/5"><FolderOpen className="size-4"/>{localT(kind==='materials'?'openMaterials':'openLibrary')}</button>)}</div>
            <div className="mb-4 flex flex-wrap gap-2"><input aria-label={libraryT('searchMaterials')} value={search} onChange={event=>setSearch(event.target.value)} placeholder={libraryT('searchMaterials')} className="h-10 max-w-xs rounded-lg border border-white/15 bg-white/5 px-3 text-sm outline-none"/><select aria-label={libraryT('filterType')} value={type} onChange={event=>setType(event.target.value as ProjectAssetTypeFilter)} className="h-10 rounded-lg border border-white/15 bg-[#202126] px-3 text-xs">{(['all','image','video','audio'] as const).map(value=><option key={value} value={value}>{libraryT(`filter${value}`)}</option>)}</select><button type="button" disabled={busy} onClick={()=>void scan()} className={button}>{libraryT(busy?'scanning':'scanMaterials')}</button></div>
            {folder?<p className="mb-4 break-all text-[11px] leading-5 text-white/35">{libraryT('materialsFolderHint',{path:folder})}</p>:null}
            {folders.length?<div className="mb-4 flex flex-wrap items-center gap-2" aria-label={t('folders')}>
              <span className="text-[11px] uppercase tracking-[0.12em] text-white/35">{t('folders')}</span>
              <button type="button" onClick={()=>setActiveFolderId(null)} aria-pressed={!activeFolder} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${activeFolder?'border-white/15 text-white/60 hover:bg-white/5':'border-orange-400/60 bg-orange-400/10 text-orange-200'}`}>{t('allAssets')}</button>
              {folders.map(item=><button key={item.id} type="button" data-canvas-folder-id={item.id} data-canvas-folder-path={item.trail.join(' / ')} title={item.trail.join(' / ')} onClick={()=>setActiveFolderId(current=>current===item.id?null:item.id)} aria-pressed={activeFolder?.id===item.id} className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${activeFolder?.id===item.id?'border-orange-400/60 bg-orange-400/10 text-orange-200':'border-white/15 text-white/60 hover:bg-white/5'}`}><Folder className="size-3.5 shrink-0"/><span className="truncate">{item.trail.length>1?item.trail.slice(0,-1).join(' / ')+' / '+item.name:item.name}</span><span className="font-mono tabular-nums text-white/40">{item.assetIds.length}</span></button>)}
            </div>:null}
            {activeFolder?<p className="mb-4 text-[11px] leading-5 text-white/40">{t('folderHint',{name:activeFolder.name,count:activeFolder.assetIds.length})}</p>:null}
            <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#111214]/95 p-2 backdrop-blur">
              <span className="px-1 text-xs text-white/60" aria-live="polite">{batchT('selectedCount',{count:selectedItems.length})}</span>
              <button type="button" disabled={!visible.length||allVisibleSelected} onClick={selectAll} className={button}>{batchT('selectAllVisible',{count:visible.length})}</button>
              <button type="button" disabled={!selectedItems.length} onClick={()=>setSelected(new Set())} className={button}>{batchT('clearSelection')}</button>
              <select aria-label={batchT('addToCategory')} disabled={busy||!selectedItems.length} value={category} onChange={event=>{const value=event.target.value as LibraryCategory;setCategory(value);if(value)void addSelectedToLibrary(value);}} className="h-9 rounded-lg border border-white/15 bg-[#202126] px-3 text-xs disabled:opacity-40"><option value="">{batchT('addToCategory')}</option>{libraryCategories.map(item=><option key={item} value={item}>{libraryT(libraryCategoryKeys[item])}</option>)}</select>
              <button type="button" disabled={!selectedItems.length} onClick={()=>setExporting(true)} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">{batchT('exportSelected',{count:selectedItems.length})}</button>
            </div>
            <ProjectAssetsLibrary projectId={projectId} search={search} typeFilter={type} limit={limit} selectedIds={selected} onToggleSelected={toggle} onlyAssetIds={onlyAssetIds}/>
            {hasMore?<div className="mt-6 text-center"><button type="button" disabled={query.isFetching} onClick={()=>setLimit(current=>current+PAGE_SIZE)} className={button}>{batchT(query.isFetching?'loadingMore':'loadMore')}</button></div>:null}
            {exporting?<BatchExportDialog projectId={projectId} items={selectedItems.map(item=>({assetId:item.asset.id,name:item.asset.filename||item.asset.id}))} onClose={()=>setExporting(false)}/>:null}
          </div>
        </div>
      </div>
    </section>
  );
}
