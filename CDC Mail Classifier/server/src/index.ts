import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { config } from './config.js';
import emailsRouter, { reclassifyEmailById } from './routes/emails.js';
import statsRouter from './routes/stats.js';
import inboxesRouter from './routes/inboxes.js';
import authRouter from './routes/auth.js';
import { startPollJob } from './jobs/poll.js';

const app = express();

app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/emails', emailsRouter);
app.post('/api/reclassify/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid email id' });
      return;
    }
    const updated = await reclassifyEmailById(id);
    if (!updated) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error('[API] POST /api/reclassify/:id error', err);
    res.status(500).json({ error: 'Failed to reclassify email' });
  }
});
app.use('/api/stats', statsRouter);
app.use('/api/inboxes', inboxesRouter);
app.use('/api/auth', authRouter);

async function main() {
  await connectDb();
  startPollJob();

  app.listen(config.port, () => {
    console.log(`[Server] Listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[Server] Failed to start', err);
  process.exit(1);
});
