import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

export function ArkRuntimeBadge() {
  const t = useTranslations('ModelConnections');
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () => { void apiGet<{ demo: boolean }>('/api/config/ark').then((config) => { if (config) setDemo(config.demo); }).catch(() => {}); };
    load();
    window.addEventListener('seedance:config-changed', load);
    return () => window.removeEventListener('seedance:config-changed', load);
  }, []);
  if (demo === null) return null;
  return <span className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60" title={t('defaultVideoHint')}>{t(demo ? 'defaultVideoDemo' : 'defaultVideoReal')}</span>;
}
