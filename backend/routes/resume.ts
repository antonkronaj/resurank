import { Router } from 'express';
import multer from 'multer';
import { parseResumePdf, extractTerms } from '../services/resumeParser.js';
import { getResumeInfo, upsertResume } from '../dal.js';

export const resumeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

resumeRouter.get('/', (_req, res) => {
  const info = getResumeInfo();
  if (!info) {
    res.json({ uploaded: false });
    return;
  }
  res.json({ uploaded: true, filename: info.filename, uploadedAt: info.uploadedAt, chars: info.chars });
});

resumeRouter.post('/', upload.single('resume'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded (field name: resume)' });
    return;
  }
  try {
    const text = await parseResumePdf(req.file.buffer);
    const terms = extractTerms(text);
    const uploadedAt = new Date().toISOString();

    upsertResume(req.file.originalname, text, terms, uploadedAt, req.file.buffer);
    res.json({ ok: true, chars: text.length, termCount: terms.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

