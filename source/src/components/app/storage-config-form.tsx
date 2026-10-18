import {Cloud,Database} from 'lucide-react';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {apiGet,apiPost} from '@/lib/api-client';
import {useTranslations} from '@/core/workspace-lib/shims/next-intl';
import {ACTIVE_GENERATION_PROVIDER_ID} from '@/config/generation-providers';
const inputClassName='h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3 font-mono text-xs text-white outline-none';
const saveButtonClassName='h-11 w-full rounded-xl bg-[#ff7a33] text-sm font-semibold text-black disabled:opacity-50';
type StorageConfigState={mode:'beatapi'|'s3';managedEligible:boolean;custom:{region:string;endpoint:string;bucketName:string;publicUrl:string;forcePathStyle:boolean;accessKeyConfigured:boolean;secretKeyConfigured:boolean}};
export function StorageConfigForm({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('AppShell.header.apiConfig.storage');
  const arkT = useTranslations('Seedance');
  const isArk = ACTIVE_GENERATION_PROVIDER_ID === 'ark';
  const [state, setState] = useState<StorageConfigState | null>(null);
  const [mode, setMode] = useState<'beatapi' | 's3'>('beatapi');
  const [region, setRegion] = useState('auto');
  const [endpoint, setEndpoint] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<StorageConfigState>('/api/config/storage')
      .then((config) => {
        if (cancelled || !config) return;
        setState(config);
        setMode(config.mode);
        setRegion(config.custom.region || 'auto');
        setEndpoint(config.custom.endpoint);
        setBucketName(config.custom.bucketName);
        setPublicUrl(config.custom.publicUrl);
        setForcePathStyle(config.custom.forcePathStyle);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await apiPost('/api/config/storage', {
        mode,
        ...(mode === 's3'
          ? {
              region: region.trim() || 'auto',
              endpoint: endpoint.trim(),
              bucketName: bucketName.trim(),
              publicUrl: publicUrl.trim(),
              accessKeyId: accessKeyId.trim(),
              secretAccessKey: secretAccessKey.trim(),
              forcePathStyle,
            }
          : {}),
      });
      toast.success(t('saved'));
      setState((previous) =>
        previous
          ? {
              mode,
              managedEligible: previous.managedEligible,
              custom: {
                ...previous.custom,
                region,
                endpoint,
                bucketName,
                publicUrl,
                forcePathStyle,
                accessKeyConfigured: Boolean(
                  accessKeyId || previous.custom.accessKeyConfigured
                ),
                secretKeyConfigured: Boolean(
                  secretAccessKey || previous.custom.secretKeyConfigured
                ),
              },
            }
          : previous
      );
      setAccessKeyId('');
      setSecretAccessKey('');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-white/[0.08] bg-black/20 p-1">
        <button
          type="button"
          disabled={!state?.managedEligible}
          onClick={() => {
            if (state?.managedEligible) setMode('beatapi');
          }}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition ${
            mode === 'beatapi'
              ? 'bg-white/[0.08] text-white'
              : 'text-white/40 hover:text-white/70'
          } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-white/40`}
        >
          <Cloud
            className={`size-3.5 ${mode === 'beatapi' ? 'text-[#ff8b4d]' : ''}`}
          />
          {isArk ? arkT('directMedia') : t('managedTitle')}
        </button>
        <button
          type="button"
          onClick={() => setMode('s3')}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition ${
            mode === 's3'
              ? 'bg-white/[0.08] text-white'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          <Database
            className={`size-3.5 ${mode === 's3' ? 'text-[#ff8b4d]' : ''}`}
          />
          {t('customTitle')}
        </button>
      </div>

      {mode === 'beatapi' ? (
        <p className="text-[12px] leading-5 text-white/40">{isArk ? arkT('storageHint') : t('managedHint')}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder={t('regionPlaceholder')}
              aria-label={t('regionLabel')}
              className={inputClassName}
            />
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={t('endpointPlaceholder')}
              aria-label={t('endpointLabel')}
              className={inputClassName}
            />
          </div>
          <input
            value={bucketName}
            onChange={(event) => setBucketName(event.target.value)}
            placeholder={t('bucketPlaceholder')}
            aria-label={t('bucketLabel')}
            className={inputClassName}
          />
          <input
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            placeholder={t('publicUrlPlaceholder')}
            aria-label={t('publicUrlLabel')}
            className={inputClassName}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="password"
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)}
              placeholder={
                state?.custom?.accessKeyConfigured
                  ? t('configuredPlaceholder')
                  : t('accessKeyPlaceholder')
              }
              aria-label={t('accessKeyLabel')}
              autoComplete="off"
              className={inputClassName}
            />
            <input
              type="password"
              value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)}
              placeholder={
                state?.custom?.secretKeyConfigured
                  ? t('configuredPlaceholder')
                  : t('secretKeyPlaceholder')
              }
              aria-label={t('secretKeyLabel')}
              autoComplete="off"
              className={inputClassName}
            />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-white/45">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(event) => setForcePathStyle(event.target.checked)}
              className="accent-[#ff7a33]"
            />
            {t('forcePathStyle')}
          </label>
        </div>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className={saveButtonClassName}
      >
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  );
}
