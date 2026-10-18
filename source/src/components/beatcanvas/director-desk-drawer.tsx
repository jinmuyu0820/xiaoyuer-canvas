'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import {
  uploadLocalProjectAsset,
  type PersistedLocalProjectAsset,
} from '@/core/workspace-lib/app/local-project-asset-client';
import {
  fetchDirectorScene,
  saveDirectorScene,
  type DirectorScene,
} from '@/core/projects/director-scene-client';

const HOST_SOURCE = 'beatdesign';
const APP_SOURCE = 'director-desk';
const SCENE_SAVE_DEBOUNCE_MS = 1200;

type BridgeMessage = {
  source?: string;
  type?: string;
  scene?: unknown;
  name?: string;
  mimeType?: string;
  bytes?: ArrayBuffer;
};

/**
 * Full-screen shell around the vendored DirectorDesk app.
 *
 * Contract: the iframe is same-origin, so every message is checked against
 * `event.origin` and against the iframe's own contentWindow. Exports are POSTed
 * into the project asset store instead of the browser's Downloads folder.
 */
export function DirectorDeskDrawer({
  projectId,
  nodeId,
  open,
  onClose,
  onExported,
}: {
  projectId: string;
  nodeId: string;
  open: boolean;
  onClose: () => void;
  onExported: (asset: PersistedLocalProjectAsset) => void;
}) {
  const t = useTranslations('DirectorDesk');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSceneRef = useRef<DirectorScene | null>(null);
  /** Resolves when the app answers a `request-scene` (or after a short timeout). */
  const sceneRequestRef = useRef<((scene: unknown) => void) | null>(null);
  const closingRef = useRef(false);
  const onExportedRef = useRef(onExported);
  onExportedRef.current = onExported;
  const [isSavingScene, setIsSavingScene] = useState(false);

  const postToDirectorDesk = useCallback((message: Record<string, unknown>) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage({ source: HOST_SOURCE, ...message }, window.location.origin);
  }, []);

  const flushScene = useCallback(async () => {
    const scene = pendingSceneRef.current;
    pendingSceneRef.current = null;
    if (!scene) return;
    setIsSavingScene(true);
    try {
      await saveDirectorScene(projectId, scene, nodeId);
    } catch (error) {
      toast.error(
        t('sceneSaveFailed', {
          message: error instanceof Error ? error.message : '',
        })
      );
    } finally {
      setIsSavingScene(false);
    }
  }, [nodeId, projectId, t]);

  /**
   * Asks the app for its current scene.
   *
   * The app only reports every few seconds, so the very last edit can still be
   * sitting inside the iframe when the user hits close. Closing without this
   * round trip is what lost that edit.
   */
  const requestLatestScene = useCallback(
    (timeoutMs = 1500) =>
      new Promise<unknown>((resolve) => {
        if (!iframeRef.current?.contentWindow) {
          resolve(null);
          return;
        }
        let settled = false;
        const finish = (scene: unknown) => {
          if (settled) return;
          settled = true;
          sceneRequestRef.current = null;
          resolve(scene);
        };
        sceneRequestRef.current = finish;
        window.setTimeout(() => finish(null), timeoutMs);
        postToDirectorDesk({ type: 'request-scene' });
      }),
    [postToDirectorDesk]
  );

  /**
   * Closes the drawer without losing the edit that is still in flight: ask for
   * the latest scene, save it, and only then let the parent unmount the drawer.
   */
  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      const scene = await requestLatestScene();
      if (scene && typeof scene === 'object') {
        pendingSceneRef.current = scene as DirectorScene;
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await flushScene();
    } finally {
      closingRef.current = false;
      onClose();
    }
  }, [flushScene, onClose, requestLatestScene]);

  const handleExport = useCallback(
    async (message: { name?: string; mimeType?: string; bytes?: ArrayBuffer }) => {
      const { bytes, name, mimeType } = message;
      if (!(bytes instanceof ArrayBuffer) || !name) {
        toast.error(t('exportFailed', { message: 'empty export' }));
        return;
      }
      try {
        const file = new File([bytes], name, {
          type: mimeType || 'application/octet-stream',
        });
        const asset = await uploadLocalProjectAsset({
          projectId,
          file,
          assetClass: 'derived',
          metadata: { operation: 'director-desk-export' },
        });
        onExportedRef.current(asset);
        toast.success(t('exportSaved', { name: asset.filename }));
      } catch (error) {
        toast.error(
          t('exportFailed', {
            message: error instanceof Error ? error.message : '',
          })
        );
      }
    },
    [projectId, t]
  );

  useEffect(() => {
    if (!open) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as BridgeMessage | null;
      if (!data || data.source !== APP_SOURCE) return;

      if (data.type === 'ready') {
        void fetchDirectorScene(projectId, nodeId)
          .then((scene) => postToDirectorDesk({ type: 'load-scene', scene }))
          .catch(() => {
            // A missing or unreadable scene must not block the editor; the
            // DirectorDesk app falls back to its own recovered session.
            postToDirectorDesk({ type: 'load-scene', scene: null });
          });
        return;
      }
      if (data.type === 'scene' && data.scene && typeof data.scene === 'object') {
        pendingSceneRef.current = data.scene as DirectorScene;
        // A close that is waiting for the latest scene can continue now.
        sceneRequestRef.current?.(data.scene);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void flushScene(), SCENE_SAVE_DEBOUNCE_MS);
        return;
      }
      if (data.type === 'export') {
        void handleExport({
          name: data.name,
          mimeType: data.mimeType,
          bytes: data.bytes,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [flushScene, handleExport, nodeId, open, postToDirectorDesk, projectId]);

  useEffect(() => {
    if (open) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void flushScene();
  }, [flushScene, open]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // A close that bypasses the button (route change, node switch) must not
      // silently drop a scene that was already reported.
      const scene = pendingSceneRef.current;
      if (scene) {
        pendingSceneRef.current = null;
        void saveDirectorScene(projectId, scene, nodeId).catch(() => undefined);
      }
    },
    [nodeId, projectId]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#08090A]/95 text-white backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{t('title')}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-white/45">{t('hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSavingScene ? (
            <span className="text-[11px] text-white/40">{t('savingScene')}</span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void requestClose();
            }}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
          >
            {t('close')}
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <iframe
          key={nodeId}
          ref={iframeRef}
          title={t('title')}
          src={`/director-desk/?host=beatdesign&projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(nodeId)}`}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          allow="fullscreen"
        />
      </div>
    </div>
  );
}
