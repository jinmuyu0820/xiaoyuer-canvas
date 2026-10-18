/**
 * Batch export limits, shared by the server export path and the browser dialog.
 *
 * They live in their own module because `batch-export.ts` imports Node's fs and
 * JSZip: a client component must be able to read the same numbers without
 * pulling either into the browser bundle.
 */

/**
 * Assets per export request.
 *
 * Folder mode ships them 10 at a time; ZIP mode has to send the whole selection
 * in one request, because one archive cannot be assembled from several. The real
 * safeguard for a ZIP is {@link MAX_ZIP_TOTAL_BYTES}, not the item count, so this
 * is only high enough to stop an absurd request.
 */
export const MAX_EXPORT_ASSETS_PER_REQUEST = 500;

/** The archive is built in memory, so the total byte budget is what bounds it. */
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Count check shared by the server route and the dialog.
 *
 * The server still owns the final word; the dialog calls this first so an
 * over-limit selection is refused with a readable message instead of turning
 * every item into a request-level failure.
 */
export const assertExportAssetCount = (count: number) => {
  if (count < 1 || count > MAX_EXPORT_ASSETS_PER_REQUEST) {
    throw new Error(
      `Select between 1 and ${MAX_EXPORT_ASSETS_PER_REQUEST} assets per export request.`
    );
  }
};
