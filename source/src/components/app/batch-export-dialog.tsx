import {useEffect,useRef,useState} from 'react';
import {FolderOpen,Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {apiJsonGet,apiJsonPost} from '@/lib/api-client';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import type {BatchExportResult,ExportItemResult} from '@/core/projects/batch-export';
import {MAX_EXPORT_ASSETS_PER_REQUEST,MAX_ZIP_TOTAL_BYTES} from '@/core/projects/batch-export-limits';

const CHUNK_SIZE=10;
const input='h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 font-mono text-xs text-white outline-none focus:border-orange-400/60 disabled:opacity-50';
const button='inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75 hover:bg-white/5 disabled:opacity-40';

export type ExportableItem={assetId:string;name:string};

export function BatchExportDialog({projectId,items,onClose}:{projectId:string;items:ExportableItem[];onClose:()=>void}){
  const t=useTranslations('BatchExport');
  const [target,setTarget]=useState(''),[includeMetadata,setIncludeMetadata]=useState(false),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'zip'|'folder'>('zip');
  const multi=items.length>1;
  const [done,setDone]=useState(0),[total,setTotal]=useState(0),[results,setResults]=useState<Map<string,ExportItemResult>>(new Map()),[exportedTo,setExportedTo]=useState<string|null>(null),[zipFile,setZipFile]=useState<string|null>(null);
  const busyRef=useRef(false);
  useEffect(()=>{let active=true;void apiJsonGet<{defaultTarget:string}>(`/api/app/projects/${projectId}/export`).then(data=>{if(active)setTarget(current=>current||data.defaultTarget);}).catch(()=>{});return()=>{active=false;};},[projectId]);
  const names=new Map(items.map(item=>[item.assetId,item.name]));
  const failed=[...results.values()].filter((result):result is Extract<ExportItemResult,{ok:false}>=>!result.ok);
  const succeeded=[...results.values()].filter((result):result is Extract<ExportItemResult,{ok:true}>=>result.ok);
  const warnings=succeeded.filter(result=>result.warning);
  const remaining=items.map(item=>item.assetId).filter(id=>!results.get(id)?.ok);
  const selectFolder=async()=>{
    if(busyRef.current)return;
    setBusy(true);
    try{
      const response=await apiJsonPost<{selected:string}>(`/api/app/projects/${projectId}/export`,{action:'select-folder',current:target});
      if(response.selected)setTarget(response.selected);
    }catch(error){
      toast.error(error instanceof Error?error.message:String(error));
    }finally{
      setBusy(false);
    }
  };
  const run=async(assetIds:string[])=>{
    if(busyRef.current||!assetIds.length||!target.trim())return;
    // A zip must be built from one request, otherwise every chunk becomes its own
    // archive. Refuse an over-limit selection up front instead of marking every
    // item failed with a request-level error.
    const zipRun=multi&&mode==='zip';
    if(zipRun&&assetIds.length>MAX_EXPORT_ASSETS_PER_REQUEST){
      toast.error(t('zipTooMany',{max:MAX_EXPORT_ASSETS_PER_REQUEST}));
      return;
    }
    busyRef.current=true;setBusy(true);setDone(0);setTotal(assetIds.length);
    const batches:string[][]=[];
    if(zipRun)batches.push(assetIds);
    else for(let index=0;index<assetIds.length;index+=CHUNK_SIZE)batches.push(assetIds.slice(index,index+CHUNK_SIZE));
    let ok=0,bad=0;
    try{
      for(const chunk of batches){
        try{
          const response=await apiJsonPost<BatchExportResult>(`/api/app/projects/${projectId}/export`,{action:'export',assetIds:chunk,target:target.trim(),includeMetadata, mode: multi?mode:'folder'});
          setExportedTo(response.target);
          if(response.zipFile)setZipFile(response.zipFile);
          setResults(previous=>{const next=new Map(previous);for(const result of response.results)next.set(result.assetId,result);return next;});
          for(const result of response.results)result.ok?ok++:bad++;
        }catch(error){
          // A request-level failure (bad folder, busy folder) applies to the whole chunk.
          const message=error instanceof Error?error.message:String(error);
          setResults(previous=>{const next=new Map(previous);for(const assetId of chunk)next.set(assetId,{assetId,ok:false,error:message});return next;});
          bad+=chunk.length;
        }
        setDone(current=>Math.min(current+chunk.length,assetIds.length));
      }
      if(ok)toast.success(t('exported',{count:ok}));
      if(bad)toast.error(t('failedCount',{count:bad}));
    }finally{busyRef.current=false;setBusy(false);}
  };
  const openTarget=async()=>{try{await apiJsonPost(`/api/app/projects/${projectId}/export`,{action:'open',target:exportedTo||target.trim()});}catch(error){toast.error(error instanceof Error?error.message:String(error));}};
  return <Dialog open onOpenChange={value=>{if(!value&&!busyRef.current)onClose();}}>
    <DialogContent className="beat-product-shell max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#111214] text-white sm:max-w-xl">
      <DialogHeader><DialogTitle>{t('title',{count:items.length})}</DialogTitle><DialogDescription className="text-white/45">{t('description')}</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <label className="block text-xs text-white/60">{t('target')}</label>
        <div className="flex gap-2">
          <input aria-label={t('target')} value={target} disabled={busy} onChange={event=>setTarget(event.target.value)} className={`${input} flex-1`}/>
          <button type="button" disabled={busy} onClick={()=>void selectFolder()} className={button}>{t('browse')}</button>
        </div>
      </div>
      <p className="text-[11px] leading-5 text-white/40">{t('targetHint')}</p>
      {multi?<div className="space-y-2">
        <span className="block text-xs text-white/60">{t('modeLabel')}</span>
        <div className="flex gap-2" role="radiogroup" aria-label={t('modeLabel')}>
          <button type="button" role="radio" aria-checked={mode==='zip'} disabled={busy} onClick={()=>setMode('zip')} className={`${button} ${mode==='zip'?'border-orange-400/60 bg-orange-400/10 text-orange-200':''}`}>{t('modeZip')}</button>
          <button type="button" role="radio" aria-checked={mode==='folder'} disabled={busy} onClick={()=>setMode('folder')} className={`${button} ${mode==='folder'?'border-orange-400/60 bg-orange-400/10 text-orange-200':''}`}>{t('modeFolder')}</button>
        </div>
        <p className="text-[11px] leading-5 text-white/40">{mode==='zip'?t('modeZipHint'):t('modeFolderHint')}</p>
        {mode==='zip'?<p data-zip-limit="true" className={`text-[11px] leading-5 ${items.length>MAX_EXPORT_ASSETS_PER_REQUEST?'text-amber-300':'text-white/35'}`}>{t('zipLimitHint',{count:items.length,max:MAX_EXPORT_ASSETS_PER_REQUEST,gb:Math.round(MAX_ZIP_TOTAL_BYTES/(1024*1024*1024))})}</p>:null}
      </div>:null}
      <label className={`flex items-center gap-2 text-xs ${multi?'text-white/70':'text-white/35'}`}><input type="checkbox" checked={includeMetadata&&multi} disabled={busy||!multi} onChange={event=>setIncludeMetadata(event.target.checked)} className="size-4 accent-orange-500"/>{t('includeMetadata')}</label>
      {!multi?<p className="text-[11px] leading-5 text-white/40">{t('singleMetadataHint')}</p>:null}
      {zipFile?<p className="break-all rounded-lg border border-orange-400/20 bg-orange-400/5 px-2 py-1.5 text-[11px] text-orange-200">{t('zipped')} {zipFile}</p>:null}
      {total?<div className="space-y-2" aria-live="polite"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-orange-500 transition-[width]" style={{width:`${Math.round(done/total*100)}%`}}/></div><p className="text-xs text-white/55">{t('progress',{done,total})} · {t('summary',{ok:succeeded.length,failed:failed.length})}</p></div>:null}
      {failed.length?<div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-[11px] text-red-200">{failed.map(result=><p key={result.assetId} className="break-all">{names.get(result.assetId)||result.assetId}: {result.error}</p>)}</div>:null}
      {warnings.length?<div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 text-[11px] text-amber-200">{warnings.map(result=><p key={result.assetId} className="break-all">{names.get(result.assetId)||result.assetId}: {t('metadataWarning')} {result.warning}</p>)}</div>:null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy||!target.trim()||!remaining.length} onClick={()=>void run(remaining)} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy?<Loader2 className="size-4 animate-spin"/>:null}{t(succeeded.length?'exportRemaining':'start')}</button>
        {failed.length&&!busy?<button type="button" onClick={()=>void run(failed.map(result=>result.assetId))} className={button}>{t('retryFailed',{count:failed.length})}</button>:null}
        {exportedTo&&!busy?<button type="button" onClick={()=>void openTarget()} className={button}><FolderOpen className="size-4"/>{t('openTarget')}</button>:null}
      </div>
    </DialogContent>
  </Dialog>;
}
