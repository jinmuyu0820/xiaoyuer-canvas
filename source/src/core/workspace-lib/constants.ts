export const AVATAR_MAX_FILE_SIZE = 2 * 1024 * 1024;
export const REFERENCE_IMAGE_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const REFERENCE_VIDEO_MAX_FILE_SIZE = 100 * 1024 * 1024;
export const REFERENCE_AUDIO_MAX_FILE_SIZE = 15 * 1024 * 1024;

/**
 * Files that never leave this machine.
 *
 * The `REFERENCE_*` limits above exist because those files may be uploaded to a
 * generation provider: they bound a multipart request that the server buffers in
 * memory. A file imported from a local folder is copied with the filesystem and
 * streamed to disk, so the only real constraint is free space. Upscaling a 4K
 * clip needs sources far beyond 100 MB, which is why local ingestion gets its
 * own, much larger ceiling.
 *
 * The remote-send checks (`managed-generation-input.ts`,
 * `beatapi-input-upload.ts`, `api/storage/upload.ts`) still use the
 * `REFERENCE_*` limits, so raising this never lets a huge file reach a provider.
 */
export const LOCAL_MEDIA_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
