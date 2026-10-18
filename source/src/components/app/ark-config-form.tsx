import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { apiGet, apiPost } from '@/lib/api-client';
import { ARK_BASE_URL, ARK_DEFAULT_MODEL } from '@/core/adapters/ark-contract';

const field = 'h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white outline-none focus:border-[#ff7a33]';
type Config = { modelId: string; demo: boolean; apiKeyConfigured: boolean; apiKeyPreview: string };

export function ArkConfigForm() {
  const t = useTranslations('Seedance');
  const [config, setConfig] = useState<Config | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(ARK_DEFAULT_MODEL);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiGet<Config>('/api/config/ark').then((value) => { if (value) { setConfig(value); setModel(value.modelId); setDemo(value.demo); } }).catch((error) => toast.error(String(error)));
  }, []);
  const submit = async (action: 'save' | 'test') => {
    setBusy(true);
    try {
      const result = await apiPost<Config>('/api/config/ark', { action, apiKey: key, modelId: model, demo });
      if (action === 'save' && result) { setConfig(result); setKey(''); window.dispatchEvent(new Event('seedance:config-changed')); }
      toast.success(t(action === 'save' ? 'saved' : 'connected'));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4 p-5">
    <p className="text-sm font-semibold">{t('provider')}</p>
    <p className="break-all font-mono text-[11px] text-white/40">{ARK_BASE_URL}</p>
    <label className="block space-y-2 text-xs text-white/60"><span>API Key</span><input aria-label="Ark API Key" autoComplete="off" type="password" className={field} value={key} placeholder={config?.apiKeyConfigured ? config.apiKeyPreview : 'ark-...'} onChange={(event) => setKey(event.target.value)} /></label>
    <label className="block space-y-2 text-xs text-white/60"><span>{t('modelId')}</span><input aria-label={t('modelId')} className={field} value={model} onChange={(event) => setModel(event.target.value)} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={demo} onChange={(event) => setDemo(event.target.checked)} />{t('demo')}</label>
    <p className="text-xs leading-5 text-white/45">{t(demo ? 'demoHint' : 'realHint')}</p>
    <div className="flex gap-2"><button type="button" className="h-10 flex-1 rounded-xl bg-[#ff7a33] font-semibold text-black disabled:opacity-50" disabled={busy || !config} onClick={() => void submit('save')}>{t('save')}</button><button type="button" className="h-10 flex-1 rounded-xl border border-white/15 text-sm disabled:opacity-50" disabled={busy || (!key && !config?.apiKeyConfigured)} onClick={() => void submit('test')}>{t('test')}</button></div>
    <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noreferrer" className="text-xs text-[#ff9a62]">{t('getKey')}</a>
    <p className="text-xs leading-5 text-white/40">{t('storageHint')}</p>
  </div>;
}
