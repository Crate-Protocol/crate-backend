import axios from "axios";
import FormData from "form-data";

const PINATA_JWT      = process.env.PINATA_JWT ?? "";
const PINATA_GATEWAY  = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";
const PINATA_ENDPOINT = process.env.PINATA_ENDPOINT ?? "https://api.pinata.cloud/pinning/pinFileToIPFS";

export async function uploadToIPFS(buffer: Buffer, filename: string) {
  if (!PINATA_JWT) throw new Error("PINATA_JWT not configured");
  if (!buffer || buffer.length === 0) throw new Error("Cannot upload empty buffer");

  const form = new FormData();
  form.append("file", buffer, { filename });

  const res = await axios.post(PINATA_ENDPOINT, form, {
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...form.getHeaders() },
    maxContentLength: Infinity,
  });

  const cid = res.data?.IpfsHash as string | undefined;
  if (!cid) throw new Error("Pinata did not return an IpfsHash");

  const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${cid}`;
  return { cid, gatewayUrl };
}
