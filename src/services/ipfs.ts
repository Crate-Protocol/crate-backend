/**
 * ipfs.ts
 * ────────
 * Pinata IPFS upload service.
 */

import axios from "axios";
import FormData from "form-data";

const PINATA_JWT = process.env.PINATA_JWT ?? "";
const PINATA_GATEWAY =
  process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";

export interface PinataUploadResult {
  cid: string;
  size: number;
  url: string;
}

/**
 * Upload a file buffer to IPFS via Pinata.
 */
export async function uploadFileToPinata(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  metadata?: Record<string, string>
): Promise<PinataUploadResult> {
  if (!PINATA_JWT) {
    throw new Error("PINATA_JWT not configured");
  }

  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType: mimeType,
  });

  if (metadata) {
    form.append(
      "pinataMetadata",
      JSON.stringify({ name: filename, keyvalues: metadata })
    );
  }

  form.append(
    "pinataOptions",
    JSON.stringify({ cidVersion: 1, wrapWithDirectory: false })
  );

  const response = await axios.post<{
    IpfsHash: string;
    PinSize: number;
  }>("https://api.pinata.cloud/pinning/pinFileToIPFS", form, {
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const cid = response.data.IpfsHash;
  return {
    cid,
    size: response.data.PinSize,
    url: `${PINATA_GATEWAY}/ipfs/${cid}`,
  };
}

/**
 * Upload JSON metadata to IPFS.
 */
export async function uploadJsonToPinata(
  data: Record<string, unknown>,
  name: string
): Promise<PinataUploadResult> {
  if (!PINATA_JWT) {
    throw new Error("PINATA_JWT not configured");
  }

  const response = await axios.post<{
    IpfsHash: string;
    PinSize: number;
  }>(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      pinataMetadata: { name },
      pinataContent: data,
      pinataOptions: { cidVersion: 1 },
    },
    {
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        "Content-Type": "application/json",
      },
    }
  );

  const cid = response.data.IpfsHash;
  return {
    cid,
    size: response.data.PinSize,
    url: `${PINATA_GATEWAY}/ipfs/${cid}`,
  };
}

/**
 * Test Pinata connectivity.
 */
export async function testPinataConnection(): Promise<boolean> {
  if (!PINATA_JWT) return false;
  try {
    await axios.get("https://api.pinata.cloud/data/testAuthentication", {
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
    });
    return true;
  } catch {
    return false;
  }
}

export function getCidUrl(cid: string): string {
  return `${PINATA_GATEWAY}/ipfs/${cid}`;
}
