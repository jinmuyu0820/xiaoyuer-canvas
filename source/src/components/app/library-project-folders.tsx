import {FolderOpen} from 'lucide-react';
import {Link} from '@/core/i18n/navigation';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import {ProductPageShell} from './product-page-shell';
import type {WorkspaceProjectCardItem} from '@/core/workspace-lib/app/workspace-client-api';
export function LibraryProjectFolders({projects}:{projects:WorkspaceProjectCardItem[]}){
  const t=useTranslations('Library');
  return <ProductPageShell workspaceName={t('title')}><section className="flex-1 overflow-y-auto bg-[#08090A] p-6 text-white"><div className="mx-auto max-w-6xl"><div className="mb-6 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{t('projectFolders')}</h1><p className="mt-2 text-sm text-white/45">{t('projectFoldersHint')}</p></div><Link href="/projects" className="rounded-lg border border-white/15 px-3 py-2 text-sm">{t('manageProjects')}</Link></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map(project=><Link key={project.id} href={`/library/${project.id}`} className="rounded-2xl border border-white/10 bg-[#17181B] p-5 hover:border-orange-400/35"><FolderOpen className="mb-4 size-8 text-orange-300"/><p className="truncate font-semibold">{project.name}</p><p className="mt-2 text-xs text-white/45">{t('fiveCategories')}</p></Link>)}</div>{!projects.length?<p className="py-12 text-center text-white/40">{t('noProjects')}</p>:null}</div></section></ProductPageShell>;
}
