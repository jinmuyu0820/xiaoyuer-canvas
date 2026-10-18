import {useState} from 'react';
import {toast} from 'sonner';
import {useQueryClient} from '@tanstack/react-query';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {libraryCategories,libraryCategoryKeys as labels,categoryAcceptsMedia,type LibraryCategory} from '@/core/projects/library-contract';
import {apiJsonPost} from '@/lib/api-client';
export function AddToLibraryDialog({projectId,assetId,type,onClose}:{projectId:string;assetId:string;type:'image'|'video'|'audio';onClose:()=>void}){
  const t=useTranslations('Library'),client=useQueryClient(),[busy,setBusy]=useState(false);
  const add=async(category:LibraryCategory)=>{if(busy)return;setBusy(true);try{await apiJsonPost(`/api/app/projects/${projectId}/library`,{action:'add',assetId,category});await client.invalidateQueries({queryKey:['local-library',projectId]});toast.success(t('addedToLibrary'));onClose();}catch(error){toast.error(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="beat-product-shell rounded-2xl border border-white/10 bg-[#111214] text-white"><DialogHeader><DialogTitle>{t('addToLibrary')}</DialogTitle><DialogDescription className="text-white/45">{t('copyHint')}</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-2">{libraryCategories.filter(category=>categoryAcceptsMedia(category,type)).map(category=><button key={category} type="button" disabled={busy} className="rounded-xl border border-white/15 px-3 py-4 text-sm hover:bg-white/5 disabled:opacity-40" onClick={()=>void add(category)}>{t(labels[category])}</button>)}</div></DialogContent></Dialog>;
}
