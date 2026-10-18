import { useEffect,useState } from 'react';
import { Plus,Pencil,Check,Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet,apiPost } from '@/lib/api-client';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import type { ConnectionCategory,ConnectionProfile,PublicConnectionProfile,PublicConnections } from '@/core/generation-providers/connection-contract';
import { protocolsForCategory,PROTOCOLS } from '@/core/generation-providers/connection-contract';
import { ARK_BASE_URL,ARK_DEFAULT_MODEL } from '@/core/adapters/ark-contract';
const field='h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none focus:border-[#ff7a33]';
type Draft=Omit<ConnectionProfile,'id'|'revision'>&{id?:string;revision?:number};
const emptyDraft=(category:ConnectionCategory):Draft=>({name:'',category,protocol:category==='video'?'ark-video':category==='image'?'compatible-images':'chat-completions',baseUrl:'',model:'',apiKey:'',demo:false,imageSize:''});
export function ModelConnectionsForm({category}:{category:ConnectionCategory}){
  const t=useTranslations('ModelConnections');
  const [document,setDocument]=useState<PublicConnections|null>(null),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false);
  const [preview,setPreview]=useState('');
  const [testText,setTestText]=useState(''),[testResult,setTestResult]=useState('');
  useEffect(()=>{let cancelled=false;void apiGet<PublicConnections>('/api/config/connections').then(value=>{if(!cancelled)setDocument(value);}).catch(error=>toast.error(String(error)));return()=>{cancelled=true;};},[category]);
  const change=(next:Partial<Draft>)=>setDraft(previous=>previous?{...previous,...next}:null);
  const edited=(profile:PublicConnectionProfile)=>{const {apiKeyConfigured:_configured,apiKeyPreview,isDefault:_default,...values}=profile;setDraft({...values,apiKey:''});setPreview(apiKeyPreview);};
  const notify=()=>{window.dispatchEvent(new Event('model-connections:changed'));window.dispatchEvent(new Event('seedance:config-changed'));};
  const mutate=async(body:Record<string,unknown>)=>{
    setBusy(true);try{const next=await apiPost<PublicConnections>('/api/config/connections',body);if(next){setDocument(next);notify();}setDraft(null);setPreview('');toast.success(t('saved'));}catch(error){toast.error(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  const test=async(profile:PublicConnectionProfile)=>{
    setBusy(true);try{const response=await apiPost<{connected:boolean;demo:boolean}>('/api/config/connections',{action:'test',id:profile.id,category});toast.success(t(response?.demo?'demoTested':response?.connected?'connected':'configurationChecked'));}catch(error){toast.error(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  const runTextTest=async()=>{if(!document?.defaults.text||!testText.trim())return;setBusy(true);setTestResult('');try{const result=await apiPost<{text:string}>('/api/config/connections',{action:'test-text',id:document.defaults.text,text:testText});setTestResult(result?.text||'');}catch(error){toast.error(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const remove=(profile:PublicConnectionProfile)=>{if(window.confirm(t('deleteConfirm',{name:profile.name})))void mutate({action:'delete',id:profile.id});};
  return <div className="space-y-4 p-5">
    <p className="text-xs leading-5 text-white/45">{t(category==='video'?'videoHint':category==='image'?'imageHint':'textHint')}</p>
    <div className="space-y-2">{document?.profiles.filter(profile=>profile.category===category).map(profile=><div key={profile.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">{profile.name}<span className="ml-2 text-[10px] text-orange-300">{profile.isDefault?t('default'):''}</span></p><p className="mt-1 truncate font-mono text-xs text-white/45">{profile.model}</p></div><div className="flex gap-1"><button type="button" aria-label={t('edit',{name:profile.name})} disabled={busy} onClick={()=>edited(profile)} className="rounded-lg p-2 hover:bg-white/5"><Pencil className="size-3.5"/></button>{profile.id!=='seedance-official'?<button type="button" aria-label={t('delete',{name:profile.name})} disabled={busy} onClick={()=>remove(profile)} className="rounded-lg p-2 text-white/45 hover:bg-white/5"><Trash2 className="size-3.5"/></button>:null}</div></div>
      <div className="mt-3 flex items-center gap-3 text-xs"><span className="text-white/45">{profile.demo?t('demo'):profile.apiKeyConfigured?t('keySet'):t('keyMissing')}</span>{!profile.isDefault?<button type="button" disabled={busy} className="ml-auto text-orange-300" onClick={()=>void mutate({action:'default',id:profile.id,category})}>{t('setDefault')}</button>:<Check className="ml-auto size-3.5 text-orange-300"/>}<button type="button" disabled={busy||!profile.demo&&!profile.apiKeyConfigured} className="text-white/65 disabled:opacity-35" onClick={()=>void test(profile)}>{t('test')}</button></div>
    </div>)}</div>
    {!document?<p className="text-xs text-white/40">{t('loading')}</p>:null}
    {!draft?<div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!document} onClick={()=>{setDraft(emptyDraft(category));setPreview('');}} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs"><Plus className="size-3.5"/>{t('add')}</button>{category==='video'?<button type="button" disabled={busy||!document} onClick={()=>{setDraft({...emptyDraft('video'),name:'Seedance 2.5',baseUrl:ARK_BASE_URL,model:ARK_DEFAULT_MODEL});setPreview('');}} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-orange-300">{t('seedancePreset')}</button>:null}</div>:null}
    {draft?<div className="space-y-3 rounded-xl border border-orange-400/20 p-4">
      <p className="text-sm font-semibold">{t(draft.id?'editing':'adding')}</p>
      <label className="block space-y-1.5 text-xs text-white/60"><span>{t('name')}</span><input aria-label={t('name')} className={field} value={draft.name} onChange={event=>change({name:event.target.value})}/></label>
      <label className="block space-y-1.5 text-xs text-white/60"><span>{t('protocol')}</span><select aria-label={t('protocol')} className={`${field} bg-[#202126]`} value={draft.protocol} onChange={event=>change({protocol:event.target.value as Draft['protocol'],demo:false,imageSize:''})}>{protocolsForCategory(category).map(protocol=><option key={protocol} value={protocol}>{t(protocol)}</option>)}</select></label>
      <p className="break-all text-[11px] leading-4 text-white/40">{t('endpointHint',{path:PROTOCOLS[draft.protocol].path})}</p>
      <label className="block space-y-1.5 text-xs text-white/60"><span>{t('baseUrl')}</span><input aria-label={t('baseUrl')} className={field} value={draft.baseUrl} onChange={event=>change({baseUrl:event.target.value})}/></label>
      <p className="text-[11px] leading-4 text-white/40">{t('baseUrlHint')}</p>
      <label className="block space-y-1.5 text-xs text-white/60"><span>{t('model')}</span><input aria-label={t('model')} className={field} value={draft.model} onChange={event=>change({model:event.target.value})}/></label>
      <label className="block space-y-1.5 text-xs text-white/60"><span>API Key</span><input aria-label="Model API Key" type="password" autoComplete="off" className={field} value={draft.apiKey} placeholder={preview?t('keepKey',{preview}):''} onChange={event=>change({apiKey:event.target.value})}/></label>
      {category==='image'?<label className="block space-y-1.5 text-xs text-white/60"><span>{t('imageSize')}</span><input aria-label={t('imageSize')} className={field} value={draft.imageSize} onChange={event=>change({imageSize:event.target.value})}/></label>:null}
      {draft.protocol==='ark-video'?<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.demo} onChange={event=>change({demo:event.target.checked})}/>{t('demo')}</label>:null}
      <div className="flex gap-2"><button type="button" disabled={busy||!draft.name.trim()||!draft.baseUrl.trim()||!draft.model.trim()} onClick={()=>void mutate({action:'save',profile:draft})} className="h-10 flex-1 rounded-lg bg-[#ff7a33] text-sm font-semibold text-black disabled:opacity-40">{t(busy?'saving':'save')}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)} className="h-10 rounded-lg border border-white/15 px-4 text-sm">{t('cancel')}</button></div>
    </div>:null}
    {category==='text'&&document?.defaults.text&&!draft?<div className="space-y-2 rounded-xl border border-white/10 p-3"><p className="text-xs text-white/60">{t('textTestHint')}</p><textarea aria-label={t('testText')} value={testText} maxLength={500} onChange={event=>setTestText(event.target.value)} className={`${field} h-20 py-2`}/><button type="button" disabled={busy||!testText.trim()} onClick={()=>void runTextTest()} className="rounded-lg border border-orange-400/30 px-3 py-2 text-xs text-orange-300 disabled:opacity-40">{t('testOptimize')}</button>{testResult?<p className="whitespace-pre-wrap break-words text-sm text-white/80" role="status">{testResult}</p>:null}</div>:null}
    <p className="text-[11px] leading-5 text-white/35">{t('testHint')}</p>
  </div>;
}
