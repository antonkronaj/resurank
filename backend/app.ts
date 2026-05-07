import express, { type Express } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import './store.js';
import { resumeRouter } from './routes/resume.js';
import { settingsRouter } from './routes/settings.js';
import { matchRouter } from './routes/match.js';
import { embeddingClient } from './services/embeddingClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconSvgPath = resolve(__dirname, '../../../resources/icon.svg');

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.use((req, _res, next) => {
    console.log(`[api] ${req.method} ${req.url}`);
    next();
  });

  app.get('/api/health', (_req, res) => {
    const status = embeddingClient.getStatus();
    console.log('[api] Health check, status:', JSON.stringify(status));
    res.json({ ok: true, model: status });
  });

  app.get('/favicon', (_req, res) => {
    res.sendFile(iconSvgPath, { headers: { 'Content-Type': 'image/svg+xml' } });
  });

  app.use('/api/resume', resumeRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/match', matchRouter);

  app.use((req, res) => {
    console.warn(`[api] 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: `Not Found: ${req.method} ${req.url}` });
  });

  return app;
}
