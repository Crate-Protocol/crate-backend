import axios from "axios";
import FormData from "form-data";

const PINATA_JWT     = process.env.PINATA_JWT ?? "";
const PINATA_GATEWAY = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";

export async function uploadToIPFS(buffer: Buffer, filename: string) {
  if (!PINATA_JWT) throw new Error("PINATA_JWT not configured");

  const form = new FormData();
  form.append("file", buffer, { filename });

  const res = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", form, {
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...form.getHeaders() },
    maxContentLength: Infinity,
  });

  const cid        = res.data.IpfsHash as string;
  const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${cid}`;
  return { cid, gatewayUrl };
}
