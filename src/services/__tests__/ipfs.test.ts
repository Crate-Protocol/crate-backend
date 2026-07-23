import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("axios", () => ({
  default: {
    delete: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

describe("unpinFromIPFS", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PINATA_JWT = "test-jwt";
    vi.mocked(axios.delete).mockReset();
    vi.mocked(axios.isAxiosError).mockReset();
    // ipfs.ts reads PINATA_JWT into a module-level const at import time, so
    // the module has to be re-evaluated fresh after each env change.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when PINATA_JWT isn't configured", async () => {
    delete process.env.PINATA_JWT;
    const { unpinFromIPFS } = await import("../ipfs.js");
    await expect(unpinFromIPFS("QmSomeCid")).rejects.toThrow("PINATA_JWT not configured");
  });

  it("calls the Pinata unpin endpoint with the CID and bearer token", async () => {
    vi.mocked(axios.delete).mockResolvedValue({ status: 200 });
    const { unpinFromIPFS } = await import("../ipfs.js");

    await unpinFromIPFS("QmSomeCid");

    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining("/pinning/unpin/QmSomeCid"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-jwt" } }),
    );
  });

  it("treats an already-unpinned CID (404) as success", async () => {
    vi.mocked(axios.delete).mockRejectedValue({ response: { status: 404 } });
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    const { unpinFromIPFS } = await import("../ipfs.js");

    await expect(unpinFromIPFS("QmAlreadyGone")).resolves.toBeUndefined();
  });

  it("rethrows on a non-404 failure", async () => {
    vi.mocked(axios.delete).mockRejectedValue({ response: { status: 500 } });
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    const { unpinFromIPFS } = await import("../ipfs.js");

    await expect(unpinFromIPFS("QmBroken")).rejects.toBeDefined();
  });
});
