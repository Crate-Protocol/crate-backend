import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Collects a readable stream into a Buffer.
 * Use only for small streams (metadata, config, etc.).
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Wraps a readable stream with size enforcement.
 * Throws if the stream emits more than maxBytes.
 */
export function enforceStreamSize(
  stream: Readable,
  maxBytes: number,
): Readable {
  const passthrough = new PassThrough();
  let totalBytes = 0;

  stream.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const err = new Error(`File size exceeds maximum of ${maxBytes} bytes`);
      err.name = "FileSizeExceeded";
      stream.destroy(err);
      passthrough.destroy(err);
      return;
    }
    passthrough.write(chunk);
  });

  stream.on("end", () => passthrough.end());
  stream.on("error", (err) => passthrough.destroy(err));

  return passthrough;
}

/**
 * Destroys multiple streams safely, ignoring errors.
 */
export function destroyStreams(...streams: (Readable | null | undefined)[]) {
  for (const stream of streams) {
    if (stream && !stream.destroyed) {
      stream.destroy();
    }
  }
}
