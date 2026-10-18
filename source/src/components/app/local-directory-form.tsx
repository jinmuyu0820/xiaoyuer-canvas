import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api-client';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
type Directories = { projectAssets:string; assetLibrary:string; exports:string; dataRoot:string };
export function LocalDirectoryForm() {
  const t=useTranslations('LocalWorkspace');
  const [state,setState]=useState<Directories|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{void apiGet<Directories>('/api/config/directories').then(x=>setState(x)).catch(e=>toast.error(String(e)));},[]);
  const save=async()=>{if(!state)return;setBusy(true);try{const next=await apiPost<Directories>('/api/config/directories',state);setState(next);toast.success(t('saved'));}catch(e){toast.error(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="space-y-4 p-5"><p className="text-xs leading-5 text-white/50">{t('directoryHint')}</p>{(['projectAssets','assetLibrary','exports'] as const).map(key=><label key={key} className="block space-y-2 text-xs text-white/60"><span>{t(key)}</span><input aria-label={t(key)} disabled={busy||!state} value={state?.[key]||''} onChange={e=>setState(previous=>previous?{...previous,[key]:e.target.value}:null)} className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 font-mono text-xs text-white"/></label>)}<p className="break-all text-[11px] text-white/40">{t('database')}: {state?.dataRoot}</p><button type="button" disabled={busy||!state} onClick={()=>void save()} className="h-10 w-full rounded-xl bg-[#ff7a33] text-sm font-semibold text-black disabled:opacity-50">{busy?t('migrating'):t('save')}</button></div>;
}
