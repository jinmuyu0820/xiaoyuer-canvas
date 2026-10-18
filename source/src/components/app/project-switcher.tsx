import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { buildLocalizedProjectDetailPath } from '@/core/projects/project-entry';
import type { WorkspaceProjectCardItem } from '@/core/workspace-lib/app/workspace-client-api';
import type {WorkspaceMode} from '@/config/workspace-modes';

export async function flushProjectBeforeNavigation(projectId: string) {
  const promises: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent('seedance:flush-project', { detail: { projectId, promises } }));
  await Promise.all(promises);
}
export function ProjectSwitcher({ projectId,workspaceMode='canvas' }: { projectId: string;workspaceMode?:WorkspaceMode }) {
  const t = useTranslations('LocalWorkspace');
  const locale = useLocale();
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false);
  const [projects,setProjects] = useState<WorkspaceProjectCardItem[]>([]);
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const close=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[]);
  const load = async () => {
    const next = !open; setOpen(next);
    if (!next) return;
    try { const result = await apiJsonGet<{projects:WorkspaceProjectCardItem[]}>('/api/app/projects'); setProjects(result.projects); }
    catch(error) { toast.error(String(error)); }
  };
  const navigate = async (id?: string) => {
    if (busy) return;
    if(id===projectId){setOpen(false);return;}
    setBusy(true);
    try {
      await flushProjectBeforeNavigation(projectId);
      const selected = id || (await apiJsonPost<{id:string}>('/api/app/projects', { name: t('newProject'), workspaceMode:'canvas' })).id;
      window.location.assign(buildLocalizedProjectDetailPath({projectId:selected,locale,mode:workspaceMode}));
    } catch(error) { toast.error(error instanceof Error ? error.message : String(error)); setBusy(false); }
  };
  return <div ref={container} className="relative shrink-0">
    <button type="button" aria-label={t('switchProject')} aria-expanded={open} disabled={busy} onClick={()=>void load()} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-white/75 hover:bg-white/5"><FolderOpen className="size-4"/><span>{t('projects')}</span><ChevronDown className="size-3"/></button>
    {open ? <div className="absolute left-0 top-11 z-50 w-64 rounded-xl border border-white/15 bg-[#17181b] p-2 shadow-2xl">
      <div className="mb-1 max-h-72 overflow-y-auto">{projects.map(p=><button key={p.id} type="button" aria-current={p.id===projectId?'page':undefined} disabled={busy} onClick={()=>void navigate(p.id)} className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5 ${p.id===projectId?'bg-white/10 text-orange-300':'text-white/75'}`}>{p.name === 'Untitled project' ? t('newProject') : p.name}</button>)}</div>
      <button type="button" disabled={busy} onClick={()=>void navigate()} className="flex w-full items-center gap-2 rounded-lg border-t border-white/10 px-3 py-2 text-sm text-orange-300"><Plus className="size-4"/>{t('newProject')}</button>
    </div> : null}
  </div>;
}
