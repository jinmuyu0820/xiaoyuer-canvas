import { useEffect,useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import type { ConnectionCategory,PublicConnectionProfile,PublicConnections } from '@/core/generation-providers/connection-contract';
export function ConnectionPicker({category,value,disabled,onChange}:{category:ConnectionCategory;value?:string;disabled:boolean;onChange:(id:string)=>void}){
  const t=useTranslations('ModelConnections');
  const [profiles,setProfiles]=useState<PublicConnectionProfile[]>([]);
  useEffect(()=>{const load=()=>{void apiGet<PublicConnections>('/api/config/connections').then(document=>setProfiles(document?.profiles.filter(profile=>profile.category===category)||[])).catch(()=>{});};load();window.addEventListener('model-connections:changed',load);return()=>window.removeEventListener('model-connections:changed',load);},[category]);
  return <select aria-label={t('selectConnection')} disabled={disabled} value={value||''} onChange={event=>onChange(event.target.value)} className="h-8 min-w-0 max-w-40 rounded-full border border-white/10 bg-[#202126] px-2 text-[11px] text-white/75"><option value="">{profiles.length?t('useDefault'):t('notConfigured')}</option>{value&&!profiles.some(profile=>profile.id===value)?<option value={value}>{t('unavailable')}</option>:null}{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select>;
}
