import { DEFAULT_SEEDANCE_SETTINGS, type SeedanceSettings } from '@/core/adapters/ark-contract';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

export function SeedanceSettingsForm({ value, disabled, onChange }: { value?: SeedanceSettings; disabled: boolean; onChange: (next: SeedanceSettings) => void }) {
  const t = useTranslations('Seedance');
  const settings = value ?? DEFAULT_SEEDANCE_SETTINGS;
  const patch = (change: Partial<SeedanceSettings>) => onChange({ ...settings, ...change });
  return <section className="space-y-3 border-t border-white/10 pt-3 text-xs text-white/75">
    <label className="block space-y-1"><span>{t('taskMode')}</span><select aria-label={t('taskMode')} disabled={disabled} value={settings.taskMode} onChange={(event) => patch({ taskMode: event.target.value as SeedanceSettings['taskMode'] })} className="h-9 w-full rounded-lg border border-white/15 bg-[#202126] px-2">{(['auto', 'reference', 'first_frame', 'first_last_frame', 'edit', 'extend', 'draft_final'] as const).map((mode) => <option key={mode} value={mode}>{t(mode)}</option>)}</select></label>
    <p className="leading-5 text-white/45">{t(settings.taskMode === 'edit' ? 'editHint' : settings.taskMode === 'first_frame' || settings.taskMode === 'first_last_frame' ? 'frameHint' : 'modeHint')}</p>
    {settings.taskMode === 'draft_final' ? <label className="block space-y-1"><span>{t('draftTaskId')}</span><input aria-label={t('draftTaskId')} disabled={disabled} value={settings.draftTaskId} onChange={(event) => patch({ draftTaskId: event.target.value })} className="h-9 w-full rounded-lg border border-white/15 bg-[#202126] px-2" /></label> : null}
    <div className="grid grid-cols-2 gap-2">{(['generateAudio', 'returnLastFrame', 'draft', 'watermark'] as const).map((key) => <label key={key} className="flex items-center gap-2"><input type="checkbox" disabled={disabled} checked={settings[key]} onChange={(event) => patch({ [key]: event.target.checked })} />{t(key)}</label>)}</div>
    <div className="grid grid-cols-2 gap-2"><label className="space-y-1"><span>{t('format')}</span><select aria-label={t('format')} disabled={disabled} value={settings.outputFormat} onChange={(event) => patch({ outputFormat: event.target.value as 'mp4' | 'mov' })} className="h-8 w-full rounded-lg bg-[#202126] px-2"><option value="mp4">MP4</option><option value="mov">MOV</option></select></label><label className="space-y-1"><span>{t('priority')}</span><input aria-label={t('priority')} type="number" min={0} max={9} disabled={disabled} value={settings.priority} onChange={(event) => patch({ priority: Math.max(0, Math.min(9, Number(event.target.value))) })} className="h-8 w-full rounded-lg bg-[#202126] px-2" /></label></div>
  </section>;
}
