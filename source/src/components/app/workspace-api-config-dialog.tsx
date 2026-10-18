import {useState} from 'react';
import {Settings} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import {LocalDirectoryForm} from './local-directory-form';
import {StorageConfigForm} from './storage-config-form';
import {ModelConnectionsForm} from './model-connections-form';
type Section='video'|'image'|'text'|'storage'|'directories';
export function WorkspaceApiConfigDialog({providerId:_provider}: {providerId?:string|null}){
  const t=useTranslations('ModelConnections');
  const [section,setSection]=useState<Section>('video');
  return <Dialog><DialogTrigger aria-label={t('settings')} title={t('settings')} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2 text-white/65 hover:bg-white/5"><Settings className="size-4"/><span className="hidden text-xs sm:inline">{t('settings')}</span></DialogTrigger>
    <DialogContent className="beat-product-shell max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#111214] p-0 text-white sm:max-w-[620px]">
      <DialogHeader className="border-b border-white/10 px-5 py-5"><DialogTitle>{t('settings')}</DialogTitle><DialogDescription className="text-xs text-white/45">{t('description')}</DialogDescription></DialogHeader>
      <div className="grid grid-cols-5 gap-1 border-b border-white/10 p-1">{(['video','image','text','storage','directories'] as const).map(item=><button key={item} type="button" onClick={()=>setSection(item)} className={`h-10 rounded-lg text-xs transition ${section===item?'bg-white/10 text-white':'text-white/45 hover:bg-white/5'}`}>{t(item)}</button>)}</div>
      {section==='directories'?<LocalDirectoryForm/>:section==='storage'?<StorageConfigForm onSaved={()=>window.dispatchEvent(new Event('model-connections:changed'))}/>:<ModelConnectionsForm key={section} category={section}/>}
    </DialogContent>
  </Dialog>;
}
