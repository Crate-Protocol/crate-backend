import { Router } from "express";
import multer    from "multer";
import { uploadToIPFS } from "../services/ipfs";

const router  = Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file provided" });
  try {
    const result = await uploadToIPFS(req.file.buffer, req.file.originalname);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export { router as ipfsRouter };
