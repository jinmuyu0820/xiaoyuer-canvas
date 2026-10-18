/**
 * Download filename rules for project assets.
 *
 * A card may carry a user-chosen `customFilename`. When it does, downloads use
 * it verbatim (only path separators and control characters are stripped).
 * Otherwise the name falls back to `<project name>-<timestamp><ext>`.
 *
 * Kept free of server imports so both the download route and the batch export
 * can share one rule, and so the rule itself is unit-testable.
 */

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

export const extensionForDownloadMimeType = (mimeType: string) =>
  EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase().split(';')[0].trim()] ?? '';

/** Removes characters that cannot appear in a filename on Windows/macOS. */
export const sanitizeDownloadFilename = (value: string) =>
  value
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();

const formatTimestamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z/, '')
    .replace('T', '');

export const generateDownloadFilename = ({
  customFilename,
  projectName,
  mimeType,
  now = new Date(),
}: {
  customFilename: string | null | undefined;
  projectName: string;
  mimeType: string;
  now?: Date;
}): string => {
  const ext = extensionForDownloadMimeType(mimeType);

  if (customFilename && customFilename.trim()) {
    const safeName = sanitizeDownloadFilename(customFilename);
    if (!safeName) {
      // The name was nothing but separators/control characters; fall through.
    } else if (ext && safeName.toLowerCase().endsWith(ext.toLowerCase())) {
      return safeName;
    } else {
      return safeName + ext;
    }
  }

  const safeProjectName = sanitizeDownloadFilename(projectName) || 'project';
  return `${safeProjectName}-${formatTimestamp(now)}${ext}`;
};

/**
 * Builds a `Content-Disposition` value that is safe for Node's header encoder.
 *
 * HTTP header values are byte strings, so a Chinese filename placed directly in
 * `filename="..."` throws (`Cannot convert argument to a ByteString`). The
 * quoted fallback therefore stays ASCII and the real name travels in the
 * RFC 5987 `filename*` parameter.
 */
export const buildContentDisposition = ({
  filename,
  inline,
}: {
  filename: string;
  inline: boolean;
}) => {
  const asciiFallback =
    filename
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_')
      .trim() || 'asset';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
};
