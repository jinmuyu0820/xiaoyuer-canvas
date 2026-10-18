import { m } from '@/paraglide/messages.js';
import { normalizeLocale, type AppLocale } from '@/config/locale';

type BeatCanvasNodeLocale = AppLocale;
type BeatCanvasNodeCopy = {
  imageGeneration: string;
  videoGeneration: string;
  videoAnalysis: string;
  analysisComplete: string;
  analysisReportReady: string;
  image: string;
  video: string;
  previewLoading: string;
  previewUnavailable: string;
  pending: string;
  processing: string;
  generationFailed: string;
  history: string;
  versions: string;
  latestResult: string;
  viewResult: string;
  directorTitle: string;
  directorHint: string;
  directorOpen: string;
  directorExported: string;
  directorNotExported: string;
  upscaleTitle: string;
  upscaleQueued: string;
  upscaleRunning: string;
  upscaleFailed: string;
  upscaleCancel: string;
  upscaleRetry: string;
  upscaleStagePrepare: string;
  upscaleStageUpscale: string;
  upscaleStageInterpolate: string;
  upscaleStageFinalize: string;
  upscaleStageCompleted: string;
  upscaleEta: string;
  upscaleSettings: string;
  upscaleTaskUpscale: string;
  upscaleTaskInterpolate: string;
};

const resolveBeatCanvasNodeLocale = (): BeatCanvasNodeLocale => {
  if (typeof document !== 'undefined') {
    const documentLocale = document.documentElement.lang.trim().toLowerCase();
    if (documentLocale.startsWith('zh')) {
      return 'zh';
    }
    if (documentLocale.startsWith('ja')) {
      return 'ja';
    }
    if (documentLocale.startsWith('en')) {
      return 'en';
    }
  }

  if (typeof navigator !== 'undefined') {
    const browserLocale = navigator.language.trim().toLowerCase();
    if (browserLocale.startsWith('en')) {
      return 'en';
    }
    if (browserLocale.startsWith('zh')) {
      return 'zh';
    }
    if (browserLocale.startsWith('ja')) {
      return 'ja';
    }
  }

  return normalizeLocale('en');
};

const getNodeCopyForLocale = (locale: BeatCanvasNodeLocale): BeatCanvasNodeCopy => ({
  imageGeneration: m['AppShell.studio.canvas.shapes.imageGeneration'](
    {},
    { locale }
  ),
  videoGeneration: m['AppShell.studio.canvas.shapes.videoGeneration'](
    {},
    { locale }
  ),
  videoAnalysis: m['AppShell.studio.canvas.shapes.videoAnalysis'](
    {},
    { locale }
  ),
  analysisComplete: m['AppShell.studio.canvas.shapes.analysisComplete'](
    {},
    { locale }
  ),
  analysisReportReady: m['AppShell.studio.canvas.shapes.analysisReportReady'](
    {},
    { locale }
  ),
  image: m['AppShell.studio.canvas.shapes.image']({}, { locale }),
  video: m['AppShell.studio.canvas.shapes.video']({}, { locale }),
  previewLoading: m['AppShell.studio.canvas.shapes.previewLoading'](
    {},
    { locale }
  ),
  previewUnavailable: m['AppShell.studio.canvas.shapes.previewUnavailable'](
    {},
    { locale }
  ),
  pending: m['AppShell.studio.canvas.shapes.pending']({}, { locale }),
  processing: m['AppShell.studio.canvas.shapes.processing']({}, { locale }),
  generationFailed: m['AppShell.studio.canvas.shapes.generationFailed'](
    {},
    { locale }
  ),
  history: m['AppShell.studio.canvas.shapes.history']({}, { locale }),
  versions: m['AppShell.studio.canvas.shapes.versions']({}, { locale }),
  latestResult: m['AppShell.studio.canvas.shapes.latestResult'](
    {},
    { locale }
  ),
  viewResult: m['AppShell.studio.canvas.shapes.viewResult']({}, { locale }),
  directorTitle: m['AppShell.studio.canvas.shapes.directorTitle']({}, { locale }),
  directorHint: m['AppShell.studio.canvas.shapes.directorHint']({}, { locale }),
  directorOpen: m['AppShell.studio.canvas.shapes.directorOpen']({}, { locale }),
  directorExported: m['AppShell.studio.canvas.shapes.directorExported'](
    {},
    { locale }
  ),
  directorNotExported: m['AppShell.studio.canvas.shapes.directorNotExported'](
    {},
    { locale }
  ),
  upscaleTitle: m['AppShell.studio.canvas.shapes.upscaleTitle']({}, { locale }),
  upscaleQueued: m['AppShell.studio.canvas.shapes.upscaleQueued']({}, { locale }),
  upscaleRunning: m['AppShell.studio.canvas.shapes.upscaleRunning'](
    {},
    { locale }
  ),
  upscaleFailed: m['AppShell.studio.canvas.shapes.upscaleFailed']({}, { locale }),
  upscaleCancel: m['AppShell.studio.canvas.shapes.upscaleCancel']({}, { locale }),
  upscaleRetry: m['AppShell.studio.canvas.shapes.upscaleRetry']({}, { locale }),
  upscaleStagePrepare: m['AppShell.studio.canvas.shapes.upscaleStagePrepare'](
    {},
    { locale }
  ),
  upscaleStageUpscale: m['AppShell.studio.canvas.shapes.upscaleStageUpscale'](
    {},
    { locale }
  ),
  upscaleStageInterpolate:
    m['AppShell.studio.canvas.shapes.upscaleStageInterpolate']({}, { locale }),
  upscaleStageFinalize: m['AppShell.studio.canvas.shapes.upscaleStageFinalize'](
    {},
    { locale }
  ),
  upscaleStageCompleted: m['AppShell.studio.canvas.shapes.upscaleStageCompleted'](
    {},
    { locale }
  ),
  upscaleEta: m['AppShell.studio.canvas.shapes.upscaleEta']({}, { locale }),
  upscaleSettings: m['AppShell.studio.canvas.shapes.upscaleSettings'](
    {},
    { locale }
  ),
  upscaleTaskUpscale: m['AppShell.studio.canvas.shapes.upscaleTaskUpscale'](
    {},
    { locale }
  ),
  upscaleTaskInterpolate:
    m['AppShell.studio.canvas.shapes.upscaleTaskInterpolate']({}, { locale }),
});

export const getBeatCanvasNodeCopy = () =>
  getNodeCopyForLocale(resolveBeatCanvasNodeLocale());
