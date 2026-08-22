import axios from "axios";
import FormData from "form-data";
import type { Readable } from "node:stream";

const PINATA_JWT        = process.env.PINATA_JWT ?? "";
const PINATA_GATEWAY    = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";
const PINATA_ENDPOINT   = process.env.PINATA_ENDPOINT ?? "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_UNPIN_BASE = process.env.PINATA_UNPIN_ENDPOINT ?? "https://api.pinata.cloud/pinning/unpin";

/**
 * Upload a file stream to IPFS via Pinata.
 * Accepts a readable stream instead of a Buffer to avoid OOM on large files.
 */
export async function uploadToIPFS(
  fileStream: Readable,
  filename: string,
  contentLength?: number,
) {
  if (!PINATA_JWT) throw new Error("PINATA_JWT not configured");

  const safeFilename = filename.replace(/[/\\]/g, "_");
  const form = new FormData();
  form.append("file", fileStream, {
    filename: safeFilename,
    ...(contentLength ? { knownLength: contentLength } : {}),
  });

  const res = await axios.post(PINATA_ENDPOINT, form, {
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    // 60s connection timeout, no total timeout (stream can take a while)
    timeout: 60_000,
  });

  const cid = res.data?.IpfsHash as string | undefined;
  if (!cid) throw new Error("Pinata did not return an IpfsHash");

  const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${cid}`;
  return { cid, gatewayUrl };
}

// A CID that's already unpinned (404 from Pinata) counts as success — the
// end state we want is "not pinned", and it already is.
export async function unpinFromIPFS(cid: string): Promise<void> {
  if (!PINATA_JWT) throw new Error("PINATA_JWT not configured");

  try {
    await axios.delete(`${PINATA_UNPIN_BASE}/${cid}`, {
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      timeout: 30_000,
    });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return;
    throw err;
  }
}
