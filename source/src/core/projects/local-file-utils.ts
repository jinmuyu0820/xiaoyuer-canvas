import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * File helpers for locally imported media.
 *
 * Local imports can be gigabytes, so nothing here loads a whole file into
 * memory: hashing streams, and magic-byte sniffing reads a small header.
 */

export const hashFileSha256 = async (filePath: string) => {
  const hash = createHash('sha256');
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash());
  });
  return hash.digest('hex');
};

/** Reads at most `maxBytes` from the start of a file; used for format sniffing. */
export const readFileHeader = async (filePath: string, maxBytes = 65_536) => {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};
