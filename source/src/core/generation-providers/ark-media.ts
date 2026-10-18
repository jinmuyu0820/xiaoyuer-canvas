import { readFile, stat } from 'node:fs/promises';
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import { resolveLocalProjectAssetPath } from '@/core/projects/local-project-assets';
import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';
import { isPublicHttpMediaUrl } from '@/core/effects/beatapi-media-url';

export async function resolveArkInputMedia(url: string, kind: 'image' | 'audio' | 'video') {
  // Never fetch localhost HTTP URLs: resolve the project-owned file directly.
  if (!url.startsWith('/api/app/projects/')) {
    if (/^asset:\/\/[\w-]+$/.test(url) || isPublicHttpMediaUrl(url)) return url;
    throw new Error('参考素材必须是本地项目素材、公网 URL 或素材 ID。');
  }
  const parsed = parseLocalProjectAssetUrl(url);
  if (!parsed) throw new Error('本地素材地址无效。');
  const asset = await getProjectAssetById(parsed);
  if (!asset || asset.storageProvider !== 'local' || asset.type !== kind) throw new Error('本地参考素材不存在或类型不匹配。');
  const mime = asset.mimeType?.split(';')[0].toLowerCase() || '';
  if (kind === 'video') throw new Error('参考视频需要公网地址。请在素材传输设置中配置自己的 TOS/S3 存储。');
  if (kind === 'audio' && !['audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mime)) throw new Error('方舟音频参考仅支持 MP3 或 WAV。');
  const maxBytes = (kind === 'image' ? 30 : 15) * 1024 * 1024;
  const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  if ((await stat(path)).size >= maxBytes) throw new Error(`参考${kind === 'image' ? '图片' : '音频'}超过方舟大小限制。`);
  return `data:${kind === 'audio' ? (mime === 'audio/mpeg' ? 'audio/mp3' : 'audio/wav') : mime};base64,${(await readFile(path)).toString('base64')}`;
}
